import type { Db } from '../core/db.js';
import { t, type Lang } from '../core/lang.js';
import { estimateTokens } from './rank.js';

/**
 * map_overview (SPEC §7): a warm-start for a fresh session — compressed directory
 * stats + the project's standing invariants/gotchas, within a token budget.
 */
export function mapOverview(db: Db, opts: { budgetTokens?: number; lang?: Lang } = {}): string {
  const budget = opts.budgetTokens ?? 1500;
  const lang = opts.lang ?? 'en';

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
    return i === -1 ? t('overview_root', lang) : p.slice(0, i) + '/';
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
    .map(([d, s]) =>
      t('overview_line', lang, {
        dir: d,
        files: s.files,
        symbols: s.symbols,
        mems: s.memories.size,
        review: s.review.size > 0 ? t('overview_review_suffix', lang, { n: s.review.size }) : '',
      }),
    );

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

  const header = t('overview_header', lang);
  const lawsHeader = t('overview_laws', lang);
  const sections = [
    header,
    ...dirLines,
    ...(lawLines.length > 0 ? ['', lawsHeader, ...lawLines] : []),
    ...(total.c > 0 ? ['', t('overview_stale_cta', lang, { n: total.c })] : []),
  ];

  // trim to budget from the bottom of the dir list first
  let text = sections.join('\n');
  while (estimateTokens(text) > budget && dirLines.length > 3) {
    dirLines.pop();
    text = [
      header,
      ...dirLines,
      t('overview_trimmed', lang),
      ...(lawLines.length > 0 ? ['', lawsHeader, ...lawLines] : []),
    ].join('\n');
  }
  return text;
}
