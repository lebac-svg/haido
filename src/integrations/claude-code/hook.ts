import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../core/config.js';
import { openDb } from '../../core/db.js';
import { t } from '../../core/lang.js';
import { toRepoRelative } from '../../core/paths.js';
import { dbPath, haidoDir, workspaceExists } from '../../core/workspace.js';
import { indexRepo } from '../../indexer/indexer.js';
import { reconcileAnchors } from '../../memory/staleness.js';
import { mapOverview } from '../../recall/overview.js';
import { recall } from '../../recall/rank.js';

/**
 * Claude Code hook runner — the "tự nhớ" experience (SPEC §8, contract m_boot_007):
 *   SessionStart          -> project map + standing laws (once per session); after a
 *                            COMPACTION (source: "compact") the injected-set resets and
 *                            the map is re-briefed — compaction erased all of it.
 *   PostToolUse Read/Edit -> memories anchored around the touched file (each injected
 *                            at most once per session); Edit/Write additionally re-index,
 *                            WARN when the edit just made a memory stale, and record the
 *                            touched file for the end-of-session reflection.
 *   Stop                  -> if the session edited files but recorded nothing, block the
 *                            stop ONCE with a reflection prompt ("anything worth
 *                            remembering?"). Never loops: stop_hook_active and the
 *                            once-per-session flag both guard it.
 * A hook must NEVER break the agent: any failure logs to stderr and returns null.
 */
export type HookKind = 'session-start' | 'post-tool' | 'stop';

interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string };
  /** SessionStart: 'startup' | 'resume' | 'clear' | 'compact' */
  source?: string;
  /** Stop: true when the agent is already continuing because a stop hook blocked. */
  stop_hook_active?: boolean;
}

interface SessionState {
  injected: string[];
  overviewDone?: boolean;
  /** Wall-clock of the first hook fire — memories created after this count as "recorded". */
  startedAt?: number;
  /** Repo-relative files Edit/Write-ed this session (feeds the Stop reflection). */
  touched?: string[];
  /** Last Edit/Write per file (ms) — lets the live map color agent edits differently. */
  lastTouch?: Record<string, number>;
  /** The reflection nudge fired — at most once per session. */
  stopNudged?: boolean;
}

/** Edits to fewer files than this never trigger the Stop reflection. */
const STOP_NUDGE_MIN_TOUCHED = 2;

export async function runHook(
  kind: HookKind,
  root: string,
  stdinRaw: string,
): Promise<string | null> {
  try {
    if (!workspaceExists(root)) return null; // not a haido project — stay silent
    const payload = parsePayload(stdinRaw);
    const sessionId = payload.session_id ?? 'no-session';
    const { config } = loadConfig(root);
    const db = openDb(dbPath(root));
    try {
      if (kind === 'session-start') {
        await indexRepo({ root, db });
        reconcileAnchors(db);
        const state = loadState(root, sessionId);
        state.startedAt ??= Date.now();
        const overview = (): string =>
          mapOverview(db, {
            budgetTokens: config.recall.overviewBudgetTokens,
            lang: config.ui.lang,
          });
        if (payload.source === 'compact') {
          // Compaction just erased everything ever injected: reset the dedup set
          // (next touch re-injects) and re-brief the map right now.
          state.injected = [];
          state.overviewDone = true;
          saveState(root, sessionId, state);
          return out('SessionStart', overview());
        }
        if (state.overviewDone) {
          saveState(root, sessionId, state);
          return null;
        }
        state.overviewDone = true;
        saveState(root, sessionId, state);
        return out('SessionStart', overview());
      }

      if (kind === 'stop') {
        if (payload.stop_hook_active === true) return null; // never loop a blocked stop
        const state = loadState(root, sessionId);
        const touched = state.touched ?? [];
        if (state.stopNudged || touched.length < STOP_NUDGE_MIN_TOUCHED) return null;
        const since = state.startedAt ?? Date.now();
        const written = (
          db.prepare(`SELECT count(*) AS c FROM memories WHERE created_at >= ?`).get(since) as {
            c: number;
          }
        ).c;
        if (written > 0) return null; // the session already recorded something
        state.stopNudged = true;
        saveState(root, sessionId, state);
        return JSON.stringify({
          decision: 'block',
          reason: t('stop_reflection', config.ui.lang, {
            n: touched.length,
            files: touched.slice(-5).join(', '),
          }),
        });
      }

      const fileAbs = payload.tool_input?.file_path;
      if (typeof fileAbs !== 'string') return null;
      const rel = toRepoRelative(root, fileAbs);
      if (!rel) return null;

      const state = loadState(root, sessionId);
      let dirty = false;
      if (state.startedAt === undefined) {
        state.startedAt = Date.now();
        dirty = true;
      }

      const warnings: string[] = [];
      if (
        payload.tool_name === 'Edit' ||
        payload.tool_name === 'Write' ||
        payload.tool_name === 'MultiEdit'
      ) {
        state.touched ??= [];
        if (!state.touched.includes(rel)) state.touched.push(rel);
        state.lastTouch ??= {};
        state.lastTouch[rel] = Date.now();
        dirty = true;
        await indexRepo({ root, db });
        const report = reconcileAnchors(db);
        for (const e of report.events) {
          if (e.event === 'drifted' || e.event === 'went_missing') {
            warnings.push(
              t('hook_drift_warning', config.ui.lang, {
                id: e.memoryId,
                qname: e.qname,
                state: e.event === 'drifted' ? 'DRIFT' : 'MISSING',
              }),
            );
          }
        }
      }

      const result = recall(db, {
        file: rel,
        budgetTokens: config.recall.budgetTokens,
        excludeIds: state.injected,
        lang: config.ui.lang,
      });
      if (result.hits.length > 0) {
        state.injected.push(...result.hits.map((h) => h.memory.id));
        dirty = true;
      }
      if (dirty) saveState(root, sessionId, state);
      if (result.hits.length === 0 && warnings.length === 0) return null;
      const text = [result.hits.length > 0 ? result.text : null, ...warnings]
        .filter((s): s is string => s !== null)
        .join('\n');
      return out('PostToolUse', text);
    } finally {
      db.close();
    }
  } catch (e) {
    console.error(`haido hook (${kind}) error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function out(hookEventName: 'SessionStart' | 'PostToolUse', additionalContext: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } });
}

function parsePayload(raw: string): HookPayload {
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return {};
  }
}

function sessionDir(root: string): string {
  return path.join(haidoDir(root), 'session');
}

function loadState(root: string, sessionId: string): SessionState {
  cleanupOldStates(root);
  try {
    const raw = readFileSync(path.join(sessionDir(root), `${sanitize(sessionId)}.json`), 'utf8');
    const parsed = JSON.parse(raw) as SessionState;
    return { ...parsed, injected: Array.isArray(parsed.injected) ? parsed.injected : [] };
  } catch {
    return { injected: [] };
  }
}

function saveState(root: string, sessionId: string, state: SessionState): void {
  const dir = sessionDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${sanitize(sessionId)}.json`), JSON.stringify(state));
}

function sanitize(id: string): string {
  return id.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
}

/** Best-effort: drop session state older than 7 days. Never throws. */
function cleanupOldStates(root: string): void {
  try {
    const dir = sessionDir(root);
    const cutoff = Date.now() - 7 * 86_400_000;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true });
    }
  } catch {
    // directory may not exist yet
  }
}
