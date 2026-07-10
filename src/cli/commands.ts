import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { openDb, type Db } from '../core/db.js';
import { dbPath, ensureWorkspace, workspaceExists } from '../core/workspace.js';
import { indexRepo } from '../indexer/indexer.js';
import { confirmMemory, moveAnchor, retireMemory } from '../memory/reanchor.js';
import { reconcileAnchors, type StalenessReport } from '../memory/staleness.js';
import {
  listNeedsReview,
  parseAnchorSpec,
  remember,
  type MemoryType,
  type RememberResult,
} from '../memory/store.js';
import { mapOverview } from '../recall/overview.js';
import { recall, type RecallResult } from '../recall/rank.js';
import { findRelated } from '../recall/related.js';

export interface IndexSummary {
  filesSeen: number;
  filesIndexed: number;
  filesDeleted: number;
  symbolsChanged: number;
  staleness: StalenessReport;
}

export function requireDb(root: string): Db {
  if (!workspaceExists(root)) {
    throw new Error(`no .haido workspace here — run 'haido init' first (root: ${root})`);
  }
  return openDb(dbPath(root));
}

export async function cmdInit(root: string): Promise<IndexSummary> {
  ensureWorkspace(root);
  const db = openDb(dbPath(root));
  try {
    return await runIndex(root, db);
  } finally {
    db.close();
  }
}

export async function cmdIndex(root: string): Promise<IndexSummary> {
  const db = requireDb(root);
  try {
    return await runIndex(root, db);
  } finally {
    db.close();
  }
}

async function runIndex(root: string, db: Db): Promise<IndexSummary> {
  const result = await indexRepo({ root, db });
  const staleness = reconcileAnchors(db);
  return {
    filesSeen: result.filesSeen,
    filesIndexed: result.filesIndexed,
    filesDeleted: result.filesDeleted,
    symbolsChanged: result.diffs.length,
    staleness,
  };
}

export interface RememberOptions {
  type: MemoryType;
  title: string;
  body: string;
  why: string;
  anchors: string[]; // 'sym:<qname>' | 'file:<path>' | bare (auto-detect by '#')
  author?: string;
}

export function cmdRemember(root: string, opts: RememberOptions): RememberResult {
  const db = requireDb(root);
  try {
    return remember(db, {
      type: opts.type,
      title: opts.title,
      body: opts.body,
      why: opts.why,
      anchors: opts.anchors.map(parseAnchorSpec),
      author: opts.author ?? `human:${os.userInfo().username}`,
    });
  } finally {
    db.close();
  }
}

export function cmdRecall(
  root: string,
  q: { symbol?: string; file?: string; query?: string; budget?: number },
): RecallResult {
  const db = requireDb(root);
  try {
    return recall(db, {
      ...(q.symbol !== undefined ? { symbol: q.symbol } : {}),
      ...(q.file !== undefined ? { file: q.file } : {}),
      ...(q.query !== undefined ? { query: q.query } : {}),
      ...(q.budget !== undefined ? { budgetTokens: q.budget } : {}),
    });
  } finally {
    db.close();
  }
}

export function cmdRelated(root: string, target: string, limit?: number): string {
  const db = requireDb(root);
  try {
    const rows = findRelated(db, {
      ...(target.includes('#') ? { symbol: target } : { file: target }),
      ...(limit !== undefined ? { limit } : {}),
    });
    if (rows.length === 0) return '(no related files found — is the path repo-relative?)';
    return rows.map((r) => `- ${r.path} — ${r.reasons.join(', ')}`).join('\n');
  } finally {
    db.close();
  }
}

export function cmdOverview(root: string, budget?: number): string {
  const db = requireDb(root);
  try {
    return mapOverview(db, budget !== undefined ? { budgetTokens: budget } : {});
  } finally {
    db.close();
  }
}

export function cmdStale(root: string): ReturnType<typeof listNeedsReview> {
  const db = requireDb(root);
  try {
    return listNeedsReview(db);
  } finally {
    db.close();
  }
}

export interface ReanchorOptions {
  confirm?: boolean;
  retire?: boolean;
  move?: number; // anchor id
  to?: string; // anchor spec for --move
}

export function cmdReanchor(root: string, memoryId: string, opts: ReanchorOptions): string {
  const db = requireDb(root);
  try {
    if (opts.confirm) {
      confirmMemory(db, memoryId);
      return `confirmed — anchors re-snapshotted, '${memoryId}' is fresh again`;
    }
    if (opts.retire) {
      retireMemory(db, memoryId);
      return `retired '${memoryId}' — it will no longer be recalled`;
    }
    if (opts.move !== undefined) {
      if (!opts.to) throw new Error('--move needs --to <sym:qname | file:path>');
      moveAnchor(db, memoryId, opts.move, parseAnchorSpec(opts.to));
      return `anchor #${String(opts.move)} moved to ${opts.to}`;
    }
    throw new Error('choose one: --confirm | --retire | --move <anchorId> --to <target>');
  } finally {
    db.close();
  }
}

export interface DoctorReport {
  node: string;
  git: string | null;
  workspace: boolean;
  counts: { files: number; symbols: number; memories: number; needsReview: number } | null;
}

export function cmdDoctor(root: string): DoctorReport {
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  const report: DoctorReport = {
    node: process.versions.node,
    git: git.status === 0 ? git.stdout.trim() : null,
    workspace: workspaceExists(root),
    counts: null,
  };
  if (report.workspace) {
    const db = openDb(dbPath(root));
    try {
      const one = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
      report.counts = {
        files: one(`SELECT count(*) AS c FROM files WHERE deleted_at IS NULL`),
        symbols: one(`SELECT count(*) AS c FROM symbols WHERE deleted_at IS NULL`),
        memories: one(`SELECT count(*) AS c FROM memories WHERE status != 'retired'`),
        needsReview: one(`SELECT count(*) AS c FROM memories WHERE status = 'needs_review'`),
      };
    } finally {
      db.close();
    }
  }
  return report;
}
