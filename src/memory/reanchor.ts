import type { Db } from '../core/db.js';
import type { AnchorRow } from './store.js';

/**
 * Review-queue resolutions (ARCHITECTURE §5):
 *   confirm — "the note is still true for the new code": snapshot current hashes.
 *   move    — point one anchor at a different symbol/file.
 *   retire  — the memory no longer holds.
 * All of them re-derive the memory status afterwards.
 */
export function confirmMemory(db: Db, memoryId: string, now = Date.now()): void {
  const anchors = db
    .prepare(`SELECT * FROM anchors WHERE memory_id = ?`)
    .all(memoryId) as AnchorRow[];
  if (anchors.length === 0) throw new Error(`memory '${memoryId}' not found or has no anchors`);

  const currentSymbol = db.prepare(
    `SELECT s.body_hash AS hash, f.path AS path FROM symbols s JOIN files f ON f.id = s.file_id
     WHERE s.qname = ? AND s.deleted_at IS NULL`,
  );
  const currentFile = db.prepare(
    `SELECT norm_hash AS hash FROM files WHERE path = ? AND deleted_at IS NULL`,
  );
  const update = db.prepare(
    `UPDATE anchors SET hash_at_link = ?, path = ?, status = 'fresh', stale_since = NULL, meta = NULL
     WHERE id = ?`,
  );

  db.transaction(() => {
    for (const a of anchors) {
      let cur: { hash: string; path: string } | undefined;
      if (a.target_kind === 'symbol') {
        cur = currentSymbol.get(a.qname) as { hash: string; path: string } | undefined;
      } else {
        const f = currentFile.get(a.qname) as { hash: string } | undefined;
        cur = f ? { hash: f.hash, path: a.qname } : undefined;
      }
      if (!cur) {
        throw new Error(
          `anchor #${String(a.id)} (${a.qname}) is missing from the index — ` +
            `use move (--to <qname>) or retire instead of confirm`,
        );
      }
      update.run(cur.hash, cur.path, a.id);
    }
    rollupMemoryStatus(db, memoryId, now);
  })();
}

export function moveAnchor(
  db: Db,
  memoryId: string,
  anchorId: number,
  to: { symbol: string } | { file: string },
  now = Date.now(),
): void {
  const anchor = db
    .prepare(`SELECT * FROM anchors WHERE id = ? AND memory_id = ?`)
    .get(anchorId, memoryId) as AnchorRow | undefined;
  if (!anchor) throw new Error(`anchor #${String(anchorId)} of memory '${memoryId}' not found`);

  if ('symbol' in to) {
    const target = db
      .prepare(
        `SELECT s.qname, s.body_hash, f.path FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.qname = ? AND s.deleted_at IS NULL`,
      )
      .get(to.symbol) as { qname: string; body_hash: string; path: string } | undefined;
    if (!target) throw new Error(`unknown symbol '${to.symbol}'`);
    db.prepare(
      `UPDATE anchors SET target_kind = 'symbol', qname = ?, path = ?, hash_at_link = ?,
         status = 'fresh', stale_since = NULL, meta = ? WHERE id = ?`,
    ).run(
      target.qname,
      target.path,
      target.body_hash,
      JSON.stringify({ moved_from: anchor.qname }),
      anchorId,
    );
  } else {
    const target = db
      .prepare(`SELECT path, norm_hash FROM files WHERE path = ? AND deleted_at IS NULL`)
      .get(to.file) as { path: string; norm_hash: string } | undefined;
    if (!target) throw new Error(`unknown file '${to.file}'`);
    db.prepare(
      `UPDATE anchors SET target_kind = 'file', qname = ?, path = ?, hash_at_link = ?,
         status = 'fresh', stale_since = NULL, meta = ? WHERE id = ?`,
    ).run(
      target.path,
      target.path,
      target.norm_hash,
      JSON.stringify({ moved_from: anchor.qname }),
      anchorId,
    );
  }
  rollupMemoryStatus(db, memoryId, now);
}

export function retireMemory(db: Db, memoryId: string, now = Date.now()): void {
  const changed = db
    .prepare(`UPDATE memories SET status = 'retired', updated_at = ? WHERE id = ?`)
    .run(now, memoryId).changes;
  if (changed === 0) throw new Error(`memory '${memoryId}' not found`);
}

export function updateMemoryBody(
  db: Db,
  memoryId: string,
  fields: { title?: string; body?: string; why?: string },
  now = Date.now(),
): void {
  const memory = db.prepare(`SELECT id FROM memories WHERE id = ?`).get(memoryId);
  if (!memory) throw new Error(`memory '${memoryId}' not found`);
  const sets: string[] = [];
  const args: unknown[] = [];
  if (fields.title !== undefined) {
    sets.push('title = ?');
    args.push(fields.title.trim());
  }
  if (fields.body !== undefined) {
    sets.push('body = ?');
    args.push(fields.body.trim());
  }
  if (fields.why !== undefined) {
    sets.push('why = ?');
    args.push(fields.why.trim());
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  args.push(now, memoryId);
  db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

function rollupMemoryStatus(db: Db, memoryId: string, now: number): void {
  const stale = db
    .prepare(
      `SELECT count(*) AS c FROM anchors WHERE memory_id = ? AND status IN ('drift','missing')`,
    )
    .get(memoryId) as { c: number };
  db.prepare(
    `UPDATE memories SET status = ?, updated_at = ? WHERE id = ? AND status != 'retired'`,
  ).run(stale.c > 0 ? 'needs_review' : 'fresh', now, memoryId);
}
