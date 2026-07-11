import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../core/db.js';
import { haidoDir } from '../core/workspace.js';

/**
 * `haido stats` — the dogfood mirror for SPEC §11 ("≥30 live memories after
 * two weeks, ≥5 drift catches, 0 silently-wrong notes"). Only numbers that
 * are actually derivable today are reported; historical drift-catch counting
 * needs an event log and is out of scope until it exists.
 */
export interface StatsReport {
  index: { files: number; symbols: number };
  memories: {
    live: number;
    fresh: number;
    needsReview: number;
    retired: number;
    byType: Record<string, number>;
    createdLast7d: number;
    createdLast30d: number;
  };
  anchors: {
    total: number;
    byStatus: Record<string, number>;
    withSnapshot: number;
    renamesSurvived: number; // anchors that auto-followed a move (meta.moved_from)
  };
  sessions: {
    // from .haido/session/*.json — the hook runner's last ~7 days of state
    seen: number;
    notesInjected: number;
    agentEditedFiles: number; // distinct files stamped by the PostToolUse hook
  };
}

export function collectStats(db: Db, root: string, now = Date.now()): StatsReport {
  const one = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { c: number }).c;

  const byType: Record<string, number> = {};
  for (const row of db
    .prepare(
      `SELECT type, count(*) AS c FROM memories WHERE status != 'retired' GROUP BY type ORDER BY c DESC`,
    )
    .all() as Array<{ type: string; c: number }>) {
    byType[row.type] = row.c;
  }

  const anchorsByStatus: Record<string, number> = {};
  for (const row of db
    .prepare(`SELECT status, count(*) AS c FROM anchors GROUP BY status`)
    .all() as Array<{ status: string; c: number }>) {
    anchorsByStatus[row.status] = row.c;
  }

  const sessions = { seen: 0, notesInjected: 0, agentEditedFiles: 0 };
  const agentFiles = new Set<string>();
  try {
    const dir = path.join(haidoDir(root), 'session');
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const state = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as {
          injected?: string[];
          lastTouch?: Record<string, number>;
        };
        sessions.seen += 1;
        sessions.notesInjected += Array.isArray(state.injected) ? state.injected.length : 0;
        for (const p of Object.keys(state.lastTouch ?? {})) agentFiles.add(p);
      } catch {
        // unreadable state files don't void the report
      }
    }
  } catch {
    // no session dir — hooks never ran here
  }
  sessions.agentEditedFiles = agentFiles.size;

  return {
    index: {
      files: one(`SELECT count(*) AS c FROM files WHERE deleted_at IS NULL`),
      symbols: one(`SELECT count(*) AS c FROM symbols WHERE deleted_at IS NULL`),
    },
    memories: {
      live: one(`SELECT count(*) AS c FROM memories WHERE status != 'retired'`),
      fresh: one(`SELECT count(*) AS c FROM memories WHERE status = 'fresh'`),
      needsReview: one(`SELECT count(*) AS c FROM memories WHERE status = 'needs_review'`),
      retired: one(`SELECT count(*) AS c FROM memories WHERE status = 'retired'`),
      byType,
      createdLast7d: one(
        `SELECT count(*) AS c FROM memories WHERE status != 'retired' AND created_at >= ?`,
        now - 7 * 86_400_000,
      ),
      createdLast30d: one(
        `SELECT count(*) AS c FROM memories WHERE status != 'retired' AND created_at >= ?`,
        now - 30 * 86_400_000,
      ),
    },
    anchors: {
      total: one(`SELECT count(*) AS c FROM anchors`),
      byStatus: anchorsByStatus,
      withSnapshot: one(`SELECT count(*) AS c FROM anchors WHERE snapshot IS NOT NULL`),
      renamesSurvived: one(`SELECT count(*) AS c FROM anchors WHERE meta LIKE '%"moved_from"%'`),
    },
    sessions,
  };
}

export function formatStats(s: StatsReport): string {
  const type = Object.entries(s.memories.byType)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(' · ');
  const anchorStatus = Object.entries(s.anchors.byStatus)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(' · ');
  return [
    `index:    ${String(s.index.files)} files · ${String(s.index.symbols)} symbols`,
    `memories: ${String(s.memories.live)} live (${String(s.memories.fresh)} fresh, ${String(
      s.memories.needsReview,
    )} need review) · ${String(s.memories.retired)} retired`,
    `          by type: ${type || '(none)'}`,
    `          new: ${String(s.memories.createdLast7d)} in 7d · ${String(
      s.memories.createdLast30d,
    )} in 30d`,
    `anchors:  ${String(s.anchors.total)} (${anchorStatus || 'none'}) · snapshots ${String(
      s.anchors.withSnapshot,
    )} · renames survived ${String(s.anchors.renamesSurvived)}`,
    `sessions: ${String(s.sessions.seen)} in ~7d · notes injected ${String(
      s.sessions.notesInjected,
    )} · files agent-edited ${String(s.sessions.agentEditedFiles)}`,
  ].join('\n');
}
