import type { Db } from '../core/db.js';

/**
 * JSON snapshot for the visualization (stable from v0.1 as promised in SPEC §6).
 * Shared by `haido export --viz`, the static `haido viz` page and the
 * `haido viz --live` server — one payload shape everywhere.
 */
export function buildVizJson(db: Db): string {
  const files = db
    .prepare(
      `SELECT f.id AS fid, f.path, f.lang, count(s.id) AS symbols FROM files f
       LEFT JOIN symbols s ON s.file_id = f.id AND s.deleted_at IS NULL
       WHERE f.deleted_at IS NULL GROUP BY f.id ORDER BY f.path`,
    )
    .all() as Array<Record<string, unknown>>;
  // structure per file (inspector panel): compact keys, signatures truncated
  const symRows = db
    .prepare(
      `SELECT file_id, kind, name, start_line, end_line, signature FROM symbols
       WHERE deleted_at IS NULL ORDER BY file_id, start_line`,
    )
    .all() as Array<{
    file_id: number;
    kind: string;
    name: string;
    start_line: number;
    end_line: number;
    signature: string | null;
  }>;
  const symsByFile = new Map<number, Array<Record<string, unknown>>>();
  for (const s of symRows) {
    const list = symsByFile.get(s.file_id) ?? [];
    list.push({
      k: s.kind,
      n: s.name,
      l1: s.start_line,
      l2: s.end_line,
      sig: (s.signature ?? '').slice(0, 90),
    });
    symsByFile.set(s.file_id, list);
  }
  for (const f of files) {
    f['syms'] = symsByFile.get(f['fid'] as number) ?? [];
    delete f['fid'];
  }
  const memories = db
    .prepare(
      `SELECT m.id, m.type, m.status, m.title, m.body, m.why, m.created_at AS created
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
