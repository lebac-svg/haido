import type { Db } from '../core/db.js';
import { getMemory, type AnchorRow, type MemoryRow } from '../memory/store.js';
import { findRelated } from './related.js';

/**
 * Scored recall (ARCHITECTURE §6). Deterministic, explainable, no ML:
 *   score = 3.0·proximity + 1.0·bm25 + 0.6·type_prior + 0.3·recency − review_penalty
 * Stale memories are penalized but NEVER hidden on exact targets — "biết là đang
 * nghi ngờ" beats silence.
 */
export type Proximity = 'exact' | 'same-file' | 'neighbor' | 'global';

export interface RecallRequest {
  symbol?: string;
  file?: string;
  query?: string;
  budgetTokens?: number;
  limit?: number;
  now?: number;
}

export interface ScoredHit {
  memory: MemoryRow & { anchors: AnchorRow[] };
  proximity: Proximity;
  via: string;
  score: number;
}

export interface RecallResult {
  hits: ScoredHit[];
  text: string;
  totalCandidates: number;
  usedTokens: number;
}

const PROXIMITY_W: Record<Proximity, number> = {
  exact: 1.0,
  'same-file': 0.6,
  neighbor: 0.35,
  global: 0.2,
};
const TYPE_PRIOR: Record<string, number> = {
  invariant: 1.0,
  gotcha: 0.9,
  decision: 0.8,
  convention: 0.6,
  todo: 0.3,
};
const TYPE_ICON: Record<string, string> = {
  invariant: '⛔',
  gotcha: '🪤',
  decision: '📌',
  convention: '📐',
  todo: '📝',
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function recall(db: Db, req: RecallRequest): RecallResult {
  const now = req.now ?? Date.now();
  const budget = req.budgetTokens ?? 800;
  const limit = req.limit ?? 20;
  const targetFile = req.file ?? req.symbol?.split('#')[0];

  interface Cand {
    proximity: Proximity;
    via: string;
    bm25?: number;
  }
  const cands = new Map<string, Cand>();
  const put = (id: string, next: Cand): void => {
    const prev = cands.get(id);
    if (!prev) {
      cands.set(id, next);
      return;
    }
    if (PROXIMITY_W[next.proximity] > PROXIMITY_W[prev.proximity]) {
      cands.set(id, { ...next, ...(prev.bm25 !== undefined ? { bm25: prev.bm25 } : {}) });
    } else if (next.bm25 !== undefined) {
      prev.bm25 = next.bm25;
    }
  };

  const byQname = db.prepare(`SELECT DISTINCT memory_id FROM anchors WHERE qname = ?`);
  const byPath = db.prepare(`SELECT DISTINCT memory_id FROM anchors WHERE path = ?`);

  if (req.symbol) {
    for (const r of byQname.all(req.symbol) as Array<{ memory_id: string }>) {
      put(r.memory_id, { proximity: 'exact', via: `neo đúng ${req.symbol}` });
    }
  }
  if (req.file) {
    for (const r of byPath.all(req.file) as Array<{ memory_id: string }>) {
      put(r.memory_id, { proximity: 'exact', via: `neo trong ${req.file}` });
    }
  }
  if (req.symbol && targetFile) {
    for (const r of byPath.all(targetFile) as Array<{ memory_id: string }>) {
      put(r.memory_id, { proximity: 'same-file', via: `cùng file ${targetFile}` });
    }
  }
  if (targetFile) {
    for (const n of findRelated(db, { file: targetFile, limit: 12 })) {
      for (const r of byPath.all(n.path) as Array<{ memory_id: string }>) {
        put(r.memory_id, { proximity: 'neighbor', via: `${n.path}: ${n.reasons[0] ?? 'gần'}` });
      }
    }
  }
  if (req.query) {
    const tokens = req.query
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((t) => t.length > 1)
      .slice(0, 12);
    if (tokens.length > 0) {
      try {
        const rows = db
          .prepare(
            `SELECT m.id, bm25(memories_fts) AS rank FROM memories_fts
             JOIN memories m ON m.rowid = memories_fts.rowid
             WHERE memories_fts MATCH ? AND m.status != 'retired'
             ORDER BY rank LIMIT 20`,
          )
          .all(tokens.map((t) => `"${t}"`).join(' OR ')) as Array<{ id: string; rank: number }>;
        for (const r of rows)
          put(r.id, { proximity: 'global', via: 'khớp nội dung', bm25: r.rank });
      } catch {
        // FTS syntax errors must never break recall
      }
    }
  }

  // bm25: smaller is better → min-max normalize to 0..1 (best = 1)
  const ranks = [...cands.values()].map((c) => c.bm25).filter((x): x is number => x !== undefined);
  const minRank = ranks.length > 0 ? Math.min(...ranks) : 0;
  const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0;

  const scored: ScoredHit[] = [];
  for (const [id, c] of cands) {
    const memory = getMemory(db, id);
    if (!memory || memory.status === 'retired') continue;
    const bm =
      c.bm25 === undefined ? 0.5 : maxRank > minRank ? (maxRank - c.bm25) / (maxRank - minRank) : 1;
    const ageDays = Math.max(0, now - memory.updated_at) / 86_400_000;
    let score =
      3.0 * PROXIMITY_W[c.proximity] +
      1.0 * bm +
      0.6 * (TYPE_PRIOR[memory.type] ?? 0.5) +
      0.3 * Math.exp(-ageDays / 180);
    if (memory.status === 'needs_review') score -= c.proximity === 'exact' ? 0.4 : 0.8;
    scored.push({ memory, proximity: c.proximity, via: c.via, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  const header = '### Trí nhớ liên quan (haido)';
  const lines = [header];
  let used = estimateTokens(header);
  const kept: ScoredHit[] = [];
  for (const hit of top) {
    const entry = formatHit(hit);
    const cost = estimateTokens(entry);
    if (kept.length > 0 && used + cost > budget) break;
    lines.push(entry);
    used += cost;
    kept.push(hit);
  }

  return {
    hits: kept,
    text: kept.length === 0 ? '(chưa có trí nhớ nào ở vùng này)' : lines.join('\n'),
    totalCandidates: cands.size,
    usedTokens: used,
  };
}

function formatHit(hit: ScoredHit): string {
  const m = hit.memory;
  const icon = TYPE_ICON[m.type] ?? '•';
  const review = m.status === 'needs_review' ? ' ⚠️CẦN-REVIEW(code đã đổi)' : '';
  const anchors = m.anchors.map((a) => `\`${a.qname}\``).join(' ');
  return `- ${icon} ${m.type.toUpperCase()}${review} [${m.id}] ${anchors}\n  ${m.title} — ${m.body}\n  vì: ${m.why} · (${hit.via})`;
}
