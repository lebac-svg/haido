import { randomBytes } from 'node:crypto';
import type { Db } from '../core/db.js';

export type MemoryType = 'decision' | 'invariant' | 'gotcha' | 'convention' | 'todo';
export const MEMORY_TYPES: readonly MemoryType[] = [
  'decision',
  'invariant',
  'gotcha',
  'convention',
  'todo',
];

export type AnchorTarget = { symbol: string } | { file: string };

/** 'sym:<qname>' | 'file:<path>' | bare string (auto-detect: contains '#' => symbol). */
export function parseAnchorSpec(spec: string): AnchorTarget {
  if (spec.startsWith('sym:')) return { symbol: spec.slice(4) };
  if (spec.startsWith('file:')) return { file: spec.slice(5) };
  return spec.includes('#') ? { symbol: spec } : { file: spec };
}

export interface RememberInput {
  type: MemoryType;
  title: string;
  body: string;
  why: string;
  anchors: AnchorTarget[];
  author: string;
  sessionId?: string;
  now?: number;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  type: string;
}

export interface RememberResult {
  id: string;
  /** Possibly-duplicate existing memories (warning, not a blocker). */
  duplicates: DuplicateCandidate[];
}

export interface MemoryRow {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  why: string;
  status: 'fresh' | 'needs_review' | 'retired';
  author: string;
  session_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface AnchorRow {
  id: number;
  memory_id: string;
  target_kind: 'symbol' | 'file';
  qname: string;
  path: string;
  hash_at_link: string;
  status: 'fresh' | 'drift' | 'missing' | 'moved';
  stale_since: number | null;
  meta: string | null;
}

export function newMemoryId(now: number): string {
  return `m_${now.toString(36)}${randomBytes(4).toString('hex')}`;
}

/**
 * Create a memory. Enforces the hygiene rules (SPEC §9) the DB alone cannot:
 * why is mandatory, at least one anchor, anchors must resolve against the index.
 */
export function remember(db: Db, input: RememberInput): RememberResult {
  const now = input.now ?? Date.now();
  if (!MEMORY_TYPES.includes(input.type)) {
    throw new Error(`type must be one of: ${MEMORY_TYPES.join(', ')}`);
  }
  const title = input.title.trim();
  const body = input.body.trim();
  const why = input.why.trim();
  if (title.length === 0 || title.length > 100) throw new Error('title: 1..100 characters');
  if (body.length === 0 || body.length > 700) {
    throw new Error('body: 1..700 characters — one memory, one fact');
  }
  if (why.length < 10) {
    throw new Error('why: required (>= 10 chars) — a memory without a reason becomes noise');
  }
  if (input.anchors.length === 0) {
    throw new Error(
      'at least one anchor required — an unanchored note is a note that will rot ' +
        '(anchor to a symbol qname or a repo-relative file path)',
    );
  }

  const resolved = input.anchors.map((a) => resolveAnchor(db, a));
  const duplicates = findDuplicates(db, title, body);

  const id = newMemoryId(now);
  const insertMemory = db.prepare(
    `INSERT INTO memories (id, type, title, body, why, status, author, session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'fresh', ?, ?, ?, ?)`,
  );
  const insertAnchor = db.prepare(
    `INSERT INTO anchors (memory_id, target_kind, qname, path, hash_at_link, status)
     VALUES (?, ?, ?, ?, ?, 'fresh')`,
  );
  db.transaction(() => {
    insertMemory.run(
      id,
      input.type,
      title,
      body,
      why,
      input.author,
      input.sessionId ?? null,
      now,
      now,
    );
    for (const r of resolved) insertAnchor.run(id, r.kind, r.qname, r.path, r.hash);
  })();

  return { id, duplicates };
}

interface ResolvedAnchor {
  kind: 'symbol' | 'file';
  qname: string;
  path: string;
  hash: string;
}

function resolveAnchor(db: Db, target: AnchorTarget): ResolvedAnchor {
  if ('symbol' in target) {
    const row = db
      .prepare(
        `SELECT s.qname, s.body_hash, f.path FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE s.qname = ? AND s.deleted_at IS NULL`,
      )
      .get(target.symbol) as { qname: string; body_hash: string; path: string } | undefined;
    if (!row) {
      const tail = target.symbol.includes('#')
        ? (target.symbol.split('#').pop() ?? target.symbol)
        : target.symbol;
      const hints = db
        .prepare(
          `SELECT qname FROM symbols
           WHERE deleted_at IS NULL AND (name = ? OR qname LIKE ?) LIMIT 3`,
        )
        .all(tail, `%#%${tail}%`) as Array<{ qname: string }>;
      const hint =
        hints.length > 0 ? ` Did you mean: ${hints.map((h) => h.qname).join(' | ')}` : '';
      throw new Error(`unknown symbol '${target.symbol}' (index up to date?).${hint}`);
    }
    return { kind: 'symbol', qname: row.qname, path: row.path, hash: row.body_hash };
  }
  const row = db
    .prepare(`SELECT path, norm_hash FROM files WHERE path = ? AND deleted_at IS NULL`)
    .get(target.file) as { path: string; norm_hash: string } | undefined;
  if (!row) throw new Error(`unknown file '${target.file}' (repo-relative POSIX path expected)`);
  return { kind: 'file', qname: row.path, path: row.path, hash: row.norm_hash };
}

function findDuplicates(db: Db, title: string, body: string): DuplicateCandidate[] {
  const tokens = `${title} ${body}`
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 2)
    .slice(0, 12);
  if (tokens.length === 0) return [];
  const match = tokens.map((t) => `"${t}"`).join(' OR ');
  try {
    return db
      .prepare(
        `SELECT m.id, m.title, m.type FROM memories_fts
         JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ? AND m.status != 'retired'
         ORDER BY bm25(memories_fts) LIMIT 3`,
      )
      .all(match) as DuplicateCandidate[];
  } catch {
    return []; // FTS syntax edge cases must never block remembering
  }
}

export function getMemory(db: Db, id: string): (MemoryRow & { anchors: AnchorRow[] }) | null {
  const memory = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as MemoryRow | undefined;
  if (!memory) return null;
  const anchors = db
    .prepare(`SELECT * FROM anchors WHERE memory_id = ? ORDER BY id`)
    .all(id) as AnchorRow[];
  return { ...memory, anchors };
}

export function listNeedsReview(db: Db): Array<MemoryRow & { anchors: AnchorRow[] }> {
  const rows = db
    .prepare(`SELECT id FROM memories WHERE status = 'needs_review' ORDER BY updated_at`)
    .all() as Array<{ id: string }>;
  return rows
    .map((r) => getMemory(db, r.id))
    .filter((m): m is MemoryRow & { anchors: AnchorRow[] } => m !== null);
}
