import { spawnSync } from 'node:child_process';
import { loadConfig } from '../core/config.js';
import type { Db } from '../core/db.js';

/**
 * Co-change mining (SPEC F3): files that change together in git history become
 * `co_change` edges — a cheap, language-agnostic "related" signal for recall.
 *
 * v0.1 strategy: idempotent full rebuild over a bounded window (default 2000
 * commits) instead of incremental accumulation — simpler, and instant at the
 * repo sizes we target. Assumes the haido root IS the git root.
 */
export interface CoChangeOptions {
  root: string;
  db: Db;
  maxCommits?: number;
  maxFilesPerCommit?: number;
  minTogether?: number;
  minConfidence?: number;
}

export interface CoChangeResult {
  ok: boolean;
  reason?: string;
  commitsScanned: number;
  pairsStored: number;
}

export function mineCoChange(o: CoChangeOptions): CoChangeResult {
  const { db } = o;
  const cfg = loadConfig(o.root).config.cochange;
  const maxCommits = o.maxCommits ?? cfg.maxCommits;
  const maxFiles = o.maxFilesPerCommit ?? cfg.maxFilesPerCommit;
  const minTogether = o.minTogether ?? cfg.minTogether;
  const minConfidence = o.minConfidence ?? cfg.minConfidence;

  const git = spawnSync(
    'git',
    ['log', '--pretty=format:@@%H', '--name-only', '--no-merges', '-n', String(maxCommits)],
    { cwd: o.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (git.error || git.status !== 0) {
    return {
      ok: false,
      reason: 'git log unavailable (not a repo?)',
      commitsScanned: 0,
      pairsStored: 0,
    };
  }

  const alive = new Map(
    (
      db.prepare(`SELECT path, id FROM files WHERE deleted_at IS NULL`).all() as Array<{
        path: string;
        id: number;
      }>
    ).map((r) => [r.path, r.id]),
  );

  const fileCount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  let commits = 0;

  for (const block of git.stdout.split('@@')) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    commits += 1;
    const touched = lines.slice(1); // first line is the commit hash
    if (touched.length > maxFiles) continue; // formatting sweeps / vendored drops
    const paths = [...new Set(touched.filter((p) => alive.has(p)))];
    for (const p of paths) fileCount.set(p, (fileCount.get(p) ?? 0) + 1);
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const a = paths[i] as string;
        const b = paths[j] as string;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  const clear = db.prepare(`DELETE FROM edges WHERE kind = 'co_change'`);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO edges (src_kind, src_id, dst_kind, dst_id, kind, weight, meta)
     VALUES ('file', ?, 'file', ?, 'co_change', ?, ?)`,
  );
  let stored = 0;
  db.transaction(() => {
    clear.run();
    for (const [key, together] of pairCount) {
      if (together < minTogether) continue;
      const [a, b] = key.split('|') as [string, string];
      const confidence =
        together / Math.min(fileCount.get(a) ?? together, fileCount.get(b) ?? together);
      if (confidence < minConfidence) continue;
      insert.run(alive.get(a), alive.get(b), Math.min(1, confidence), JSON.stringify({ together }));
      stored += 1;
    }
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('cochange_last_run', ?)`).run(
      String(Date.now()),
    );
  })();

  return { ok: true, commitsScanned: commits, pairsStored: stored };
}
