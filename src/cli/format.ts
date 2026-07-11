import { t, type Lang } from '../core/lang.js';
import type { AnchorRow, MemoryRow } from '../memory/store.js';
import type { IndexSummary } from './commands.js';

const TYPE_ICON: Record<string, string> = {
  invariant: '⛔',
  gotcha: '🪤',
  decision: '📌',
  convention: '📐',
  todo: '📝',
};

export function formatIndexSummary(s: IndexSummary, lang: Lang = 'en'): string {
  const lines = [
    `files: ${String(s.filesSeen)} seen, ${String(s.filesIndexed)} indexed, ${String(s.filesDeleted)} deleted · symbol diffs: ${String(s.symbolsChanged)}`,
  ];
  if (s.coChange?.ok && s.coChange.pairsStored > 0) {
    lines.push(
      t('summary_cochange', lang, {
        pairs: s.coChange.pairsStored,
        commits: s.coChange.commitsScanned,
      }),
    );
  }
  for (const e of s.staleness.events) {
    const icon =
      e.event === 'drifted'
        ? '⚠️ drift'
        : e.event === 'went_missing'
          ? '❓ missing'
          : e.event === 'moved'
            ? '➡️ moved'
            : '✅ healed';
    lines.push(`  ${icon}  ${e.qname} (${e.memoryId})${e.detail ? ` — ${e.detail}` : ''}`);
  }
  if (s.staleness.needsReview.length > 0) {
    lines.push(
      `memories needing review: ${String(s.staleness.needsReview.length)} — run 'haido stale'`,
    );
  }
  return lines.join('\n');
}

export function formatMemoryLine(
  m: MemoryRow & { anchors: AnchorRow[] },
  lang: Lang = 'en',
): string {
  const icon = TYPE_ICON[m.type] ?? '•';
  const flag = m.status === 'needs_review' ? t('memline_review', lang) : '';
  const anchors = m.anchors.map((a) => a.qname).join(', ');
  return `${icon} ${m.type.toUpperCase()}${flag} [${m.id}] ${anchors}\n   ${m.title} — ${m.body}\n   ${t('why', lang)}: ${m.why}`;
}

export function formatStale(
  memories: Array<MemoryRow & { anchors: AnchorRow[] }>,
  lang: Lang = 'en',
): string {
  if (memories.length === 0) return t('stale_empty', lang);
  const blocks = memories.map((m) => {
    const anchorLines = m.anchors
      .filter((a) => a.status === 'drift' || a.status === 'missing')
      .map((a) => {
        const meta = a.meta ? (JSON.parse(a.meta) as Record<string, unknown>) : {};
        if (a.status === 'drift') {
          const oldHash = String(meta['old_hash'] ?? a.hash_at_link).slice(0, 8);
          const newHash = String(meta['new_hash'] ?? '?').slice(0, 8);
          return `   ⚠️ drift  #${String(a.id)} ${a.qname} (${oldHash} → ${newHash})`;
        }
        const candidates = Array.isArray(meta['candidates'])
          ? (meta['candidates'] as string[])
          : [];
        return `   ❓ missing #${String(a.id)} ${a.qname}${candidates.length > 0 ? ` — candidates: ${candidates.join(' | ')}` : ''}`;
      });
    return [
      formatMemoryLine(m, lang),
      ...anchorLines,
      `   resolve: haido reanchor ${m.id} --confirm | --retire | --move <anchorId> --to <target>`,
    ].join('\n');
  });
  return blocks.join('\n\n');
}
