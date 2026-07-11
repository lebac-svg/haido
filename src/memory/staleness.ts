import type { Db } from '../core/db.js';

/**
 * Staleness engine (ARCHITECTURE §5) — a full reconciliation pass:
 * every anchor of every non-retired memory is re-checked against the CURRENT index.
 * Idempotent; O(#anchors), which stays small. Diff-driven optimization can come later.
 *
 * Anchor transitions:
 *   fresh|drift|missing|moved -> fresh   (hash matches again — includes reverts)
 *   -> drift    (target exists, hash differs; meta = {old_hash, new_hash})
 *   -> moved    (target gone, exactly ONE alive twin with the same hash — auto reanchor)
 *   -> missing  (target gone; meta.candidates = suggestions)
 * Memory rollup: any drift|missing anchor => needs_review, else fresh (retired untouched).
 */
export interface AnchorEvent {
  memoryId: string;
  anchorId: number;
  qname: string;
  event: 'drifted' | 'moved' | 'went_missing' | 'healed';
  detail?: string;
}

export interface StalenessReport {
  checked: number;
  events: AnchorEvent[];
  needsReview: string[]; // memory ids currently needing review
}

interface AnchorJoinRow {
  id: number;
  memory_id: string;
  target_kind: 'symbol' | 'file';
  qname: string;
  path: string;
  hash_at_link: string;
  snapshot: string | null;
  status: 'fresh' | 'drift' | 'missing' | 'moved';
  stale_since: number | null;
}

export function reconcileAnchors(db: Db, nowInput?: number): StalenessReport {
  const now = nowInput ?? Date.now();
  const anchors = db
    .prepare(
      `SELECT a.id, a.memory_id, a.target_kind, a.qname, a.path, a.hash_at_link, a.snapshot,
              a.status, a.stale_since
       FROM anchors a JOIN memories m ON m.id = a.memory_id
       WHERE m.status != 'retired'`,
    )
    .all() as AnchorJoinRow[];

  const symbolByQname = db.prepare(
    `SELECT s.body_hash AS hash, s.norm_text AS snap, f.path AS path FROM symbols s
     JOIN files f ON f.id = s.file_id
     WHERE s.qname = ? AND s.deleted_at IS NULL`,
  );
  const symbolTwins = db.prepare(
    `SELECT s.qname, s.norm_text AS snap, f.path FROM symbols s JOIN files f ON f.id = s.file_id
     WHERE s.body_hash = ? AND s.deleted_at IS NULL LIMIT 3`,
  );
  const symbolNameHints = db.prepare(
    `SELECT qname FROM symbols WHERE name = ? AND deleted_at IS NULL LIMIT 3`,
  );
  const fileByPath = db.prepare(
    `SELECT norm_hash AS hash, norm_text AS snap, content_hash FROM files
     WHERE path = ? AND deleted_at IS NULL`,
  );
  const fileTwins = db.prepare(
    `SELECT path, norm_text AS snap FROM files WHERE norm_hash = ? AND deleted_at IS NULL LIMIT 3`,
  );
  // snapshot only moves when the anchor is (back) in sync with the code — a
  // drifting anchor keeps its old snapshot: that IS the "old" side of the diff.
  const setStatus = db.prepare(
    `UPDATE anchors SET status = @status, stale_since = @staleSince, meta = @meta,
       qname = @qname, path = @path, snapshot = COALESCE(@snapshot, snapshot)
     WHERE id = @id`,
  );
  const backfillSnapshot = db.prepare(`UPDATE anchors SET snapshot = ? WHERE id = ?`);

  const events: AnchorEvent[] = [];

  const apply = db.transaction(() => {
    for (const a of anchors) {
      const next = evaluate(a);
      const changed = next.status !== a.status || next.qname !== a.qname || next.path !== a.path;
      if (changed) {
        setStatus.run({
          id: a.id,
          status: next.status,
          staleSince:
            next.status === 'drift' || next.status === 'missing' ? (a.stale_since ?? now) : null,
          meta: next.meta ? JSON.stringify(next.meta) : null,
          qname: next.qname,
          path: next.path,
          snapshot: next.status === 'fresh' || next.status === 'moved' ? (next.snap ?? null) : null,
        });
        if (next.event) {
          events.push({
            memoryId: a.memory_id,
            anchorId: a.id,
            qname: next.qname,
            event: next.event,
            detail: next.detail,
          });
        }
      } else if (a.status === 'fresh' && a.snapshot === null && next.snap != null) {
        // pre-v2 anchor (or import without a local twin): heal the snapshot in place
        backfillSnapshot.run(next.snap, a.id);
      }
    }
    // Memory rollup
    db.exec(
      `UPDATE memories SET status = 'needs_review'
       WHERE status = 'fresh' AND id IN (
         SELECT DISTINCT memory_id FROM anchors WHERE status IN ('drift','missing'));
       UPDATE memories SET status = 'fresh'
       WHERE status = 'needs_review' AND id NOT IN (
         SELECT DISTINCT memory_id FROM anchors WHERE status IN ('drift','missing'));`,
    );
  });
  apply();

  const needsReview = (
    db.prepare(`SELECT id FROM memories WHERE status = 'needs_review'`).all() as Array<{
      id: string;
    }>
  ).map((r) => r.id);

  return { checked: anchors.length, events, needsReview };

  interface Evaluated {
    status: AnchorJoinRow['status'];
    qname: string;
    path: string;
    /** Current normalized text — set only when the anchor is in sync with the code. */
    snap?: string | null;
    meta?: Record<string, unknown>;
    event?: AnchorEvent['event'];
    detail?: string;
  }

  function evaluate(a: AnchorJoinRow): Evaluated {
    let current: { hash: string; snap: string | null; path: string } | undefined;
    if (a.target_kind === 'symbol') {
      current = symbolByQname.get(a.qname) as
        | { hash: string; snap: string | null; path: string }
        | undefined;
    } else {
      const f = fileByPath.get(a.qname) as { hash: string; snap: string | null } | undefined;
      current = f ? { hash: f.hash, snap: f.snap, path: a.qname } : undefined;
    }

    if (current) {
      if (current.hash === a.hash_at_link) {
        // 'moved' -> 'fresh' is silent housekeeping; only drift/missing recoveries are news
        const healed = a.status === 'drift' || a.status === 'missing';
        return {
          status: 'fresh',
          qname: a.qname,
          path: current.path,
          snap: current.snap,
          ...(healed ? { event: 'healed' as const } : {}),
        };
      }
      return {
        status: 'drift',
        qname: a.qname,
        path: a.path,
        meta: { old_hash: a.hash_at_link, new_hash: current.hash },
        ...(a.status !== 'drift' ? { event: 'drifted' as const } : {}),
      };
    }

    // Target vanished — look for an identical twin (file rename / symbol move).
    const twins =
      a.target_kind === 'symbol'
        ? (symbolTwins.all(a.hash_at_link) as Array<
            { qname: string; snap: string | null; path: string }
          >)
        : (fileTwins.all(a.hash_at_link) as Array<{ path: string; snap: string | null }>).map(
            (f) => ({ qname: f.path, snap: f.snap, path: f.path }),
          );

    if (twins.length === 1 && twins[0]) {
      return {
        status: 'moved',
        qname: twins[0].qname,
        path: twins[0].path,
        snap: twins[0].snap,
        meta: { moved_from: a.qname },
        event: 'moved',
        detail: `${a.qname} -> ${twins[0].qname}`,
      };
    }

    const candidates =
      twins.length > 0
        ? twins.map((t) => t.qname)
        : a.target_kind === 'symbol'
          ? (
              symbolNameHints.all(a.qname.split('.').pop()?.split('#').pop() ?? '') as Array<{
                qname: string;
              }>
            ).map((r) => r.qname)
          : [];
    return {
      status: 'missing',
      qname: a.qname,
      path: a.path,
      meta: { candidates },
      ...(a.status !== 'missing' ? { event: 'went_missing' as const } : {}),
      detail: candidates.length > 0 ? `candidates: ${candidates.join(' | ')}` : undefined,
    };
  }
}
