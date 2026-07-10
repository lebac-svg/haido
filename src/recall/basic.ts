import type { Db } from '../core/db.js';
import { getMemory, type AnchorRow, type MemoryRow } from '../memory/store.js';

/**
 * Basic recall (v0.1). Sprint 3 replaces this with the scored engine (ARCHITECTURE §6);
 * priorities already follow the plan: exact anchor > same file > text match.
 */
export type RecallReason = 'anchored' | 'same-file' | 'text-match';

export interface RecallHit {
  memory: MemoryRow & { anchors: AnchorRow[] };
  reason: RecallReason;
}

export interface RecallQuery {
  symbol?: string;
  file?: string;
  query?: string;
  limit?: number;
}

export function recallBasic(db: Db, q: RecallQuery): RecallHit[] {
  const hits = new Map<string, RecallHit>();
  const add = (memoryId: string, reason: RecallReason): void => {
    if (hits.has(memoryId)) return;
    const memory = getMemory(db, memoryId);
    if (memory && memory.status !== 'retired') hits.set(memoryId, { memory, reason });
  };

  const anchorsByQname = db.prepare(`SELECT DISTINCT memory_id FROM anchors WHERE qname = ?`);
  const anchorsByPath = db.prepare(`SELECT DISTINCT memory_id FROM anchors WHERE path = ?`);

  if (q.symbol) {
    for (const r of anchorsByQname.all(q.symbol) as Array<{ memory_id: string }>) {
      add(r.memory_id, 'anchored');
    }
    const file = q.symbol.split('#')[0];
    if (file) {
      for (const r of anchorsByPath.all(file) as Array<{ memory_id: string }>) {
        add(r.memory_id, 'same-file');
      }
    }
  }
  if (q.file) {
    for (const r of anchorsByPath.all(q.file) as Array<{ memory_id: string }>) {
      add(r.memory_id, 'anchored');
    }
  }
  if (q.query) {
    const tokens = q.query
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((t) => t.length > 1)
      .slice(0, 12);
    if (tokens.length > 0) {
      try {
        const rows = db
          .prepare(
            `SELECT m.id FROM memories_fts
             JOIN memories m ON m.rowid = memories_fts.rowid
             WHERE memories_fts MATCH ? AND m.status != 'retired'
             ORDER BY bm25(memories_fts) LIMIT 20`,
          )
          .all(tokens.map((t) => `"${t}"`).join(' OR ')) as Array<{ id: string }>;
        for (const r of rows) add(r.id, 'text-match');
      } catch {
        // never let FTS syntax errors break recall
      }
    }
  }
  return [...hits.values()].slice(0, q.limit ?? 10);
}
