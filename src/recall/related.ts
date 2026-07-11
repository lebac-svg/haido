import type { Db } from '../core/db.js';
import { t, type Lang } from '../core/lang.js';
import { posixDirname } from '../core/paths.js';

/**
 * File neighborhood (ARCHITECTURE §6): imports (both directions) > co-change > same directory.
 * Used both by `find_related` and as the candidate ring for recall ranking.
 */
export interface RelatedFile {
  path: string;
  reasons: string[];
  weight: number;
}

export function findRelated(
  db: Db,
  target: { file?: string; symbol?: string; limit?: number; lang?: Lang },
): RelatedFile[] {
  const file = target.file ?? target.symbol?.split('#')[0];
  if (!file) return [];
  const limit = target.limit ?? 8;
  const lang = target.lang ?? 'en';

  const acc = new Map<string, RelatedFile>();
  const add = (path: string, reason: string, weight: number): void => {
    if (path === file) return;
    const prev = acc.get(path);
    if (prev) {
      prev.reasons.push(reason);
      prev.weight = Math.max(prev.weight, weight);
    } else {
      acc.set(path, { path, reasons: [reason], weight });
    }
  };

  const importsOut = db.prepare(
    `SELECT fd.path FROM edges e
     JOIN files fs ON fs.id = e.src_id JOIN files fd ON fd.id = e.dst_id
     WHERE e.kind = 'imports' AND fs.path = ? AND fd.deleted_at IS NULL`,
  );
  const importsIn = db.prepare(
    `SELECT fs.path FROM edges e
     JOIN files fs ON fs.id = e.src_id JOIN files fd ON fd.id = e.dst_id
     WHERE e.kind = 'imports' AND fd.path = ? AND fs.deleted_at IS NULL`,
  );
  const coChange = db.prepare(
    `SELECT fs.path AS a, fd.path AS b, e.weight, e.meta FROM edges e
     JOIN files fs ON fs.id = e.src_id JOIN files fd ON fd.id = e.dst_id
     WHERE e.kind = 'co_change' AND (fs.path = ? OR fd.path = ?)`,
  );

  for (const r of importsOut.all(file) as Array<{ path: string }>) {
    add(r.path, t('reason_import', lang), 1.0);
  }
  for (const r of importsIn.all(file) as Array<{ path: string }>) {
    add(r.path, t('reason_imported_by', lang), 0.9);
  }
  for (const r of coChange.all(file, file) as Array<{
    a: string;
    b: string;
    weight: number;
    meta: string | null;
  }>) {
    const other = r.a === file ? r.b : r.a;
    const together = r.meta ? (JSON.parse(r.meta) as { together?: number }).together : undefined;
    add(
      other,
      `${t('reason_cochange', lang)}${together ? ` (${t('reason_cochange_times', lang, { n: together })})` : ''}`,
      0.5 + 0.4 * Math.min(1, r.weight),
    );
  }

  const dir = posixDirname(file);
  const sameDir = db
    .prepare(`SELECT path FROM files WHERE deleted_at IS NULL AND path != ? AND path LIKE ?`)
    .all(file, `${dir === '' ? '' : `${dir}/`}%`) as Array<{ path: string }>;
  for (const r of sameDir) {
    if (posixDirname(r.path) === dir) add(r.path, t('reason_same_dir', lang), 0.3);
  }

  return [...acc.values()].sort((x, y) => y.weight - x.weight).slice(0, limit);
}
