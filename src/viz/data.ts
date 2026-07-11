import type { Db } from '../core/db.js';

/**
 * JSON snapshot for the visualization (stable from v0.1 as promised in SPEC §6).
 * Shared by `haido export --viz`, the static `haido viz` page and the
 * `haido viz --live` server — one payload shape everywhere.
 */
export function buildVizJson(db: Db): string {
  const files = db
    .prepare(
      `SELECT f.path, f.lang, count(s.id) AS symbols FROM files f
       LEFT JOIN symbols s ON s.file_id = f.id AND s.deleted_at IS NULL
       WHERE f.deleted_at IS NULL GROUP BY f.id ORDER BY f.path`,
    )
    .all();
  const memories = db
    .prepare(
      `SELECT m.id, m.type, m.status, m.title, m.body, m.why
       FROM memories m WHERE m.status != 'retired'`,
    )
    .all() as Array<Record<string, unknown>>;
  const anchorsFor = db.prepare(
    `SELECT target_kind AS kind, qname, path, status FROM anchors WHERE memory_id = ?`,
  );
  for (const m of memories) m['anchors'] = anchorsFor.all(m['id']);
  const edges = db
    .prepare(
      `SELECT fs.path AS src, fd.path AS dst, e.kind, e.weight FROM edges e
       JOIN files fs ON fs.id = e.src_id JOIN files fd ON fd.id = e.dst_id
       ORDER BY e.kind, src, dst`,
    )
    .all();
  return JSON.stringify({ version: 1, files, memories, edges }, null, 2);
}
