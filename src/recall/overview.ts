import type { Db } from '../core/db.js';
import { estimateTokens } from './rank.js';

/**
 * map_overview (SPEC §7): a warm-start for a fresh session — compressed directory
 * stats + the project's standing invariants/gotchas, within a token budget.
 */
export function mapOverview(db: Db, opts: { budgetTokens?: number } = {}): string {
  const budget = opts.budgetTokens ?? 1500;

  const files = db
    .prepare(
      `SELECT f.path, count(s.id) AS symbols FROM files f
       LEFT JOIN symbols s ON s.file_id = f.id AND s.deleted_at IS NULL
       WHERE f.deleted_at IS NULL GROUP BY f.id`,
    )
    .all() as Array<{ path: string; symbols: number }>;

  const anchorDirs = db
    .prepare(
      `SELECT a.path, a.memory_id, m.status FROM anchors a
       JOIN memories m ON m.id = a.memory_id WHERE m.status != 'retired'`,
    )
    .all() as Array<{ path: string; memory_id: string; status: string }>;

  interface DirStat {
    files: number;
    symbols: number;
    memories: Set<string>;
    review: Set<string>;
  }
  const dirs = new Map<string, DirStat>();
  const dirOf = (p: string): string => {
    const i = p.indexOf('/');
    return i === -1 ? '(gốc)' : p.slice(0, i) + '/';
  };
  for (const f of files) {
    const d = dirOf(f.path);
    const s = dirs.get(d) ?? { files: 0, symbols: 0, memories: new Set(), review: new Set() };
    s.files += 1;
    s.symbols += f.symbols;
    dirs.set(d, s);
  }
  for (const a of anchorDirs) {
    const d = dirOf(a.path);
    const s = dirs.get(d) ?? { files: 0, symbols: 0, memories: new Set(), review: new Set() };
    s.memories.add(a.memory_id);
    if (a.status === 'needs_review') s.review.add(a.memory_id);
    dirs.set(d, s);
  }

  const dirLines = [...dirs.entries()]
    .sort((a, b) => b[1].files - a[1].files)
    .map(([d, s]) => {
      const review = s.review.size > 0 ? ` (⚠ ${String(s.review.size)} cần review)` : '';
      return `- ${d} — ${String(s.files)} file · ${String(s.symbols)} symbol · ${String(s.memories.size)} ghi chú${review}`;
    });

  const laws = db
    .prepare(
      `SELECT m.id, m.type, m.title, m.status,
              (SELECT group_concat(qname, ' ') FROM anchors WHERE memory_id = m.id) AS anchors
       FROM memories m
       WHERE m.status != 'retired' AND m.type IN ('invariant','gotcha','convention')
       ORDER BY CASE m.type WHEN 'invariant' THEN 0 WHEN 'gotcha' THEN 1 ELSE 2 END,
                m.updated_at DESC
       LIMIT 10`,
    )
    .all() as Array<{ id: string; type: string; title: string; status: string; anchors: string }>;

  const lawLines = laws.map((l) => {
    const flag = l.status === 'needs_review' ? ' ⚠️' : '';
    return `- ${l.type.toUpperCase()}${flag} [${l.id}] ${l.title} @ ${l.anchors}`;
  });

  const total = db
    .prepare(`SELECT count(*) AS c FROM memories WHERE status = 'needs_review'`)
    .get() as { c: number };

  const sections = [
    '### Bản đồ dự án (haido)',
    ...dirLines,
    ...(lawLines.length > 0 ? ['', '**Luật của dự án (đọc trước khi sửa):**', ...lawLines] : []),
    ...(total.c > 0
      ? ['', `⚠ ${String(total.c)} ghi chú đang cần review — gọi tool stale_memories khi rảnh.`]
      : []),
  ];

  // trim to budget from the bottom of the dir list first
  let text = sections.join('\n');
  while (estimateTokens(text) > budget && dirLines.length > 3) {
    dirLines.pop();
    text = [
      '### Bản đồ dự án (haido)',
      ...dirLines,
      `- … (rút gọn cho vừa ngân sách token)`,
      ...(lawLines.length > 0 ? ['', '**Luật của dự án (đọc trước khi sửa):**', ...lawLines] : []),
    ].join('\n');
  }
  return text;
}
