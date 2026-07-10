import type { AnchorRow, MemoryRow } from '../memory/store.js';
import type { IndexSummary } from './commands.js';

const TYPE_ICON: Record<string, string> = {
  invariant: '⛔',
  gotcha: '🪤',
  decision: '📌',
  convention: '📐',
  todo: '📝',
};

export function formatIndexSummary(s: IndexSummary): string {
  const lines = [
    `files: ${String(s.filesSeen)} seen, ${String(s.filesIndexed)} indexed, ${String(s.filesDeleted)} deleted · symbol diffs: ${String(s.symbolsChanged)}`,
  ];
  if (s.coChange?.ok && s.coChange.pairsStored > 0) {
    lines.push(
      `co-change: ${String(s.coChange.pairsStored)} cặp file hay đổi cùng nhau (quét ${String(s.coChange.commitsScanned)} commit)`,
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

export function formatMemoryLine(m: MemoryRow & { anchors: AnchorRow[] }): string {
  const icon = TYPE_ICON[m.type] ?? '•';
  const flag = m.status === 'needs_review' ? ' ⚠️(needs review — code changed)' : '';
  const anchors = m.anchors.map((a) => a.qname).join(', ');
  return `${icon} ${m.type.toUpperCase()}${flag} [${m.id}] ${anchors}\n   ${m.title} — ${m.body}\n   why: ${m.why}`;
}

export function formatStale(memories: Array<MemoryRow & { anchors: AnchorRow[] }>): string {
  if (memories.length === 0) return 'review queue is empty — every memory matches the code ✅';
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
      formatMemoryLine(m),
      ...anchorLines,
      `   resolve: haido reanchor ${m.id} --confirm | --retire | --move <anchorId> --to <target>`,
    ].join('\n');
  });
  return blocks.join('\n\n');
}
