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
 *   SessionStart          -> project map + standing laws (once per session)
 *   PostToolUse Read/Edit -> memories anchored around the touched file (each injected
 *                            at most once per session); Edit/Write additionally re-index
 *                            and WARN when the edit just made a memory stale.
 * A hook must NEVER break the agent: any failure logs to stderr and returns null.
 */
export type HookKind = 'session-start' | 'post-tool';

interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string };
}

interface SessionState {
  injected: string[];
  overviewDone?: boolean;
}

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
        if (state.overviewDone) return null;
        state.overviewDone = true;
        saveState(root, sessionId, state);
        return out(
          'SessionStart',
          mapOverview(db, {
            budgetTokens: config.recall.overviewBudgetTokens,
            lang: config.ui.lang,
          }),
        );
      }

      const fileAbs = payload.tool_input?.file_path;
      if (typeof fileAbs !== 'string') return null;
      const rel = toRepoRelative(root, fileAbs);
      if (!rel) return null;

      const warnings: string[] = [];
      if (
        payload.tool_name === 'Edit' ||
        payload.tool_name === 'Write' ||
        payload.tool_name === 'MultiEdit'
      ) {
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

      const state = loadState(root, sessionId);
      const result = recall(db, {
        file: rel,
        budgetTokens: config.recall.budgetTokens,
        excludeIds: state.injected,
        lang: config.ui.lang,
      });
      if (result.hits.length === 0 && warnings.length === 0) return null;
      if (result.hits.length > 0) {
        state.injected.push(...result.hits.map((h) => h.memory.id));
        saveState(root, sessionId, state);
      }
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
