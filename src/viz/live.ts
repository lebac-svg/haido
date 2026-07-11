import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { Db } from '../core/db.js';
import type { Lang } from '../core/lang.js';
import { haidoDir } from '../core/workspace.js';
import { watchRepo, type WatchHandle } from '../indexer/watch.js';
import { buildVizJson } from './data.js';
import { buildVizHtml } from './html.js';

/**
 * `haido viz --live` — the map as a living thing: serve the viz page over
 * 127.0.0.1 and stream every change into it via SSE (`GET /events`).
 *
 * Two change sources, because writers live in two different processes:
 *  - code saves: the in-process `watchRepo` (chokidar → incremental re-index →
 *    anchor reconcile). Its raw changed paths become the "hot" file list even
 *    when the payload is structurally identical (a comment-only edit still
 *    deserves its glow), and its staleness events make drifting notes flash.
 *  - memories written by OTHER processes (the MCP server Claude talks to, or a
 *    second terminal): polled cheaply via `PRAGMA data_version`, which bumps
 *    only when a different connection commits — our own index writes don't
 *    re-trigger it. Hot ids are then derived by diffing rows.
 *
 * Protocol: every frame is the FULL snapshot + hot lists. Idempotent by
 * construction — a browser that reconnects just re-applies the truth.
 */
export interface LiveUpdate {
  changedFiles: string[];
  changedMemories: string[];
  clients: number;
}

export interface LiveVizOptions {
  root: string;
  db: Db;
  /** Default 6160; on EADDRINUSE the next 9 ports are tried. 0 = OS-assigned. */
  port?: number;
  lang?: Lang;
  /** Watch the working tree with chokidar (default true; tests turn it off). */
  watch?: boolean;
  debounceMs?: number;
  /** data_version poll interval for cross-process memory writes (default 1000ms). */
  pollMs?: number;
  onUpdate?: (u: LiveUpdate) => void;
  onError?: (e: unknown) => void;
}

export interface LiveVizHandle {
  port: number;
  url: string;
  clients(): number;
  /** Force a rebuild+broadcast now (poll/watch do this on their own). */
  refresh(): void;
  close(): Promise<void>;
}

interface VizFileRow {
  path: string;
  [k: string]: unknown;
}
interface VizMemRow {
  id: string;
  [k: string]: unknown;
}
interface VizData {
  files: VizFileRow[];
  memories: VizMemRow[];
  edges: unknown[];
}

const DEFAULT_PORT = 6160;

/** A hot file counts as agent-edited when a hook touch landed within this window. */
const AGENT_WINDOW_MS = 20_000;
/** Injections older than this never re-announce (fresh page loads stay calm). */
const INJECT_WINDOW_MS = 30_000;

/**
 * Who just edited? The Claude Code PostToolUse hook stamps every Edit/Write
 * into `.haido/session/<id>.json` (`lastTouch`), so agent activity is the set
 * of recently stamped paths; anything else that hits the watcher is a human
 * (or another tool). Best-effort by design: no session files → everything
 * renders as plain (human) activity.
 */
export function readAgentTouches(root: string): Map<string, number> {
  return readSessionStamps(root, 'lastTouch');
}

/** Memory ids the hooks recently injected into the agent's context (id → ms). */
export function readAgentInjects(root: string): Map<string, number> {
  return readSessionStamps(root, 'lastInject');
}

function readSessionStamps(root: string, field: 'lastTouch' | 'lastInject'): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const dir = path.join(haidoDir(root), 'session');
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Record<
          string,
          Record<string, number> | undefined
        >;
        for (const [k, ts] of Object.entries(parsed[field] ?? {})) {
          if (typeof ts === 'number' && ts > (out.get(k) ?? 0)) out.set(k, ts);
        }
      } catch {
        // one unreadable state file must not kill attribution for the rest
      }
    }
  } catch {
    // no session dir yet — hooks never ran here
  }
  return out;
}

export async function serveLiveViz(opts: LiveVizOptions): Promise<LiveVizHandle> {
  const { root, db } = opts;
  const lang: Lang = opts.lang ?? 'en';
  const repoName = path.basename(root);

  let json = buildVizJson(db);
  let parsed = JSON.parse(json) as VizData;
  let htmlCache: string | null = null;
  const clients = new Set<ServerResponse>();

  const frameFor = (
    data: VizData,
    files: string[],
    mems: string[],
    agent: string[],
    injected: string[],
  ): string =>
    `event: map\ndata: ${JSON.stringify({ data, hot: { files, mems, agent, injected } })}\n\n`;

  const commit = (
    nextJson: string,
    next: VizData,
    hotFiles: string[],
    hotMems: string[],
    injected: string[] = [],
  ): void => {
    const known = new Set(next.files.map((f) => f.path));
    const knownMems = new Set(next.memories.map((m) => m.id));
    const files = [...new Set(hotFiles)].filter((p) => known.has(p));
    const mems = [...new Set(hotMems)].filter((id) => knownMems.has(id));
    const injects = [...new Set(injected)].filter((id) => knownMems.has(id));
    if (nextJson === json && files.length === 0 && mems.length === 0 && injects.length === 0)
      return;
    const touches = files.length > 0 ? readAgentTouches(root) : new Map<string, number>();
    const cutoff = Date.now() - AGENT_WINDOW_MS;
    const agent = files.filter((p) => (touches.get(p) ?? 0) >= cutoff);
    json = nextJson;
    parsed = next;
    htmlCache = null;
    const frame = frameFor(next, files, mems, agent, injects);
    for (const res of clients) res.write(frame);
    opts.onUpdate?.({ changedFiles: files, changedMemories: mems, clients: clients.size });
  };

  const rebuild = (): { nextJson: string; next: VizData } => {
    const nextJson = buildVizJson(db);
    return { nextJson, next: JSON.parse(nextJson) as VizData };
  };

  const refresh = (): void => {
    try {
      const { nextJson, next } = rebuild();
      commit(
        nextJson,
        next,
        changedRows(parsed.files, next.files, 'path'),
        changedRows(parsed.memories, next.memories, 'id'),
      );
    } catch (e) {
      opts.onError?.(e);
    }
  };

  // --- change source 1: the working tree (in-process watcher) ---
  let watchHandle: WatchHandle | null = null;
  if (opts.watch !== false) {
    watchHandle = watchRepo({
      root,
      db,
      ...(opts.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
      onCycle: (c) => {
        const { nextJson, next } = rebuild();
        commit(
          nextJson,
          next,
          c.changedPaths,
          c.staleness.events.map((e) => e.memoryId),
        );
      },
      ...(opts.onError ? { onError: opts.onError } : {}),
    });
    // A save the instant after startup must not be swallowed by the initial scan.
    await watchHandle.ready;
  }

  // --- change source 2: other connections (MCP server, second terminal) ---
  // --- change source 3: recall injections stamped by the hooks (session files) ---
  let dataVersion = db.pragma('data_version', { simple: true }) as number;
  const sentInjects = new Map<string, number>();
  const poll = setInterval(() => {
    try {
      const v = db.pragma('data_version', { simple: true }) as number;
      if (v !== dataVersion) {
        dataVersion = v;
        refresh();
      }
      const injects = readAgentInjects(root);
      const cutoff = Date.now() - INJECT_WINDOW_MS;
      const fresh: string[] = [];
      for (const [id, ts] of injects) {
        if (ts >= cutoff && ts > (sentInjects.get(id) ?? 0)) {
          sentInjects.set(id, ts);
          fresh.push(id);
        }
      }
      if (fresh.length > 0) {
        const { nextJson, next } = rebuild();
        commit(nextJson, next, [], [], fresh);
      }
    } catch (e) {
      opts.onError?.(e);
    }
  }, opts.pollMs ?? 1000);

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': hb\n\n');
  }, 25_000);

  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      htmlCache ??= buildVizHtml(json, repoName, lang, true);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlCache);
      return;
    }
    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write('retry: 1500\n\n');
      res.write(frameFor(parsed, [], [], [], []));
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  const port = await listenWithRetry(server, opts.port ?? DEFAULT_PORT);

  return {
    port,
    url: `http://127.0.0.1:${String(port)}/`,
    clients: () => clients.size,
    refresh,
    close: async () => {
      clearInterval(poll);
      clearInterval(heartbeat);
      if (watchHandle) await watchHandle.close();
      for (const res of clients) res.end();
      clients.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/** Rows whose serialized shape is new or different; removals are not "hot". */
function changedRows(
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>,
  key: string,
): string[] {
  const prev = new Map(before.map((r) => [String(r[key]), JSON.stringify(r)]));
  const out: string[] = [];
  for (const r of after) {
    const k = String(r[key]);
    if (prev.get(k) !== JSON.stringify(r)) out.push(k);
  }
  return out;
}

function listenWithRetry(
  server: ReturnType<typeof createServer>,
  wanted: number,
  attempts = 10,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number, left: number): void => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && wanted !== 0 && left > 0) {
          tryPort(p + 1, left - 1);
        } else {
          reject(err);
        }
      });
      server.listen(p, '127.0.0.1', () => {
        server.removeAllListeners('error');
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : p);
      });
    };
    tryPort(wanted, attempts - 1);
  });
}
