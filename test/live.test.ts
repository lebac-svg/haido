import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/core/db.js';
import { dbPath, ensureWorkspace } from '../src/core/workspace.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { remember } from '../src/memory/store.js';
import { buildVizHtml } from '../src/viz/html.js';
import { readAgentTouches, serveLiveViz, type LiveVizHandle } from '../src/viz/live.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

interface MapFrame {
  data: { files: Array<{ path: string }>; memories: Array<{ id: string }> };
  hot: { files: string[]; mems: string[]; agent: string[] };
}

/** Incremental SSE parser: next() resolves with the next `event: map` payload. */
function sseCollector(body: ReadableStream<Uint8Array>): (timeoutMs?: number) => Promise<MapFrame> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return async function next(timeoutMs = 5000): Promise<MapFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const cut = buf.indexOf('\n\n');
      if (cut !== -1) {
        const frame = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (frame.includes('event: map') && dataLine) {
          return JSON.parse(dataLine.slice(6)) as MapFrame;
        }
        continue; // retry hint / heartbeat
      }
      const remain = deadline - Date.now();
      if (remain <= 0) throw new Error('timed out waiting for an SSE map frame');
      const r = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('timed out waiting for an SSE map frame'));
        }, remain);
        reader.read().then(
          (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          (e: unknown) => {
            clearTimeout(timer);
            reject(e instanceof Error ? e : new Error(String(e)));
          },
        );
      });
      if (r.done) throw new Error('SSE stream closed');
      buf += dec.decode(r.value, { stream: true });
    }
  };
}

let tmp: string;
let db: Db;
let handle: LiveVizHandle | null = null;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-live-'));
  cpSync(path.join(FIXTURES, 'ts-mini'), tmp, { recursive: true });
  db = openDb(ensureWorkspace(tmp));
  await indexRepo({ root: tmp, db });
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('haido viz --live', () => {
  it('bakes LIVE on for the served page and off for the static build', async () => {
    handle = await serveLiveViz({ root: tmp, db, port: 0, watch: false, pollMs: 50 });
    const res = await fetch(handle.url);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Hải Đồ');
    expect(html).toContain("('1' === '1')");
    expect(html).not.toContain('__HAIDO_LIVE__');
    expect(html).not.toContain('https://'); // still self-contained

    const staticHtml = buildVizHtml('{"files":[],"memories":[],"edges":[]}', 'x');
    expect(staticHtml).toContain("('0' === '1')");
  });

  it('sends a full snapshot as the first SSE frame', async () => {
    handle = await serveLiveViz({ root: tmp, db, port: 0, watch: false, pollMs: 50 });
    const res = await fetch(new URL('/events', handle.url));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const next = sseCollector(res.body as ReadableStream<Uint8Array>);
    const first = await next();
    expect(first.data.files.map((f) => f.path)).toContain('src/board.ts');
    expect(first.hot.files).toEqual([]);
    expect(first.hot.mems).toEqual([]);
  });

  it('broadcasts memories written by ANOTHER connection (data_version poll) as hot', async () => {
    handle = await serveLiveViz({ root: tmp, db, port: 0, watch: false, pollMs: 40 });
    const res = await fetch(new URL('/events', handle.url));
    const next = sseCollector(res.body as ReadableStream<Uint8Array>);
    await next(); // initial snapshot

    const other = openDb(dbPath(tmp)); // simulates the MCP server process
    const { id } = remember(other, {
      type: 'gotcha',
      title: 'Live probe',
      body: 'Written from a second connection.',
      why: 'the map must see cross-process writes',
      anchors: [{ file: 'src/board.ts' }],
      author: 'test',
    });
    other.close();

    const frame = await next();
    expect(frame.hot.mems).toContain(id);
    expect(frame.data.memories.map((m) => m.id)).toContain(id);
  });

  it('re-broadcasts after refresh() when its own db connection wrote', async () => {
    handle = await serveLiveViz({ root: tmp, db, port: 0, watch: false, pollMs: 60_000 });
    const res = await fetch(new URL('/events', handle.url));
    const next = sseCollector(res.body as ReadableStream<Uint8Array>);
    await next();

    const { id } = remember(db, {
      type: 'todo',
      title: 'Same-connection write',
      body: 'data_version never bumps for our own writes.',
      why: 'refresh() must cover it',
      anchors: [{ file: 'src/board.ts' }],
      author: 'test',
    });
    handle.refresh();
    const frame = await next();
    expect(frame.hot.mems).toContain(id);
  });

  // GitHub windows runners + node 24 crash in libuv fs-event (`Assertion failed:
  // !_wcsnicmp(filename, dir, dirlen)`) when chokidar watches their temp layout;
  // the watcher path stays covered by the ubuntu cells and by real-Windows dogfood.
  it.skipIf(!!process.env['CI'] && process.platform === 'win32')(
    'a file save flows through the watcher into a hot-file frame, attributed to the agent',
    { timeout: 15_000 },
    async () => {
      // a hook-stamped session state marks src/board.ts as an agent edit
      const sessionDir = path.join(tmp, '.haido', 'session');
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        path.join(sessionDir, 'sess-agent.json'),
        JSON.stringify({ injected: [], lastTouch: { 'src/board.ts': Date.now() } }),
      );

      handle = await serveLiveViz({ root: tmp, db, port: 0, debounceMs: 60, pollMs: 60_000 });
      const res = await fetch(new URL('/events', handle.url));
      const next = sseCollector(res.body as ReadableStream<Uint8Array>);
      await next();

      appendFileSync(path.join(tmp, 'src', 'board.ts'), '\nexport const nudge = 1;\n');
      appendFileSync(path.join(tmp, 'src', 'utils.ts'), '\nexport const human = 1;\n');
      const frame = await next(12_000);
      expect(frame.hot.files).toContain('src/board.ts');
      expect(frame.hot.files).toContain('src/utils.ts');
      expect(frame.hot.agent).toContain('src/board.ts'); // hook-stamped → agent
      expect(frame.hot.agent).not.toContain('src/utils.ts'); // unstamped → human/other
    },
  );

  it('readAgentTouches merges session states and keeps the freshest stamp', () => {
    const dir = path.join(tmp, '.haido', 'session');
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + '/a.json', JSON.stringify({ lastTouch: { 'x.ts': 100, 'y.ts': 5 } }));
    writeFileSync(dir + '/b.json', JSON.stringify({ lastTouch: { 'y.ts': 900 } }));
    writeFileSync(dir + '/broken.json', '{oops');
    const touches = readAgentTouches(tmp);
    expect(touches.get('x.ts')).toBe(100);
    expect(touches.get('y.ts')).toBe(900);
  });
});
