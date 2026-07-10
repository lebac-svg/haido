import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/core/db.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { confirmMemory, moveAnchor, retireMemory } from '../src/memory/reanchor.js';
import { reconcileAnchors } from '../src/memory/staleness.js';
import { getMemory, remember } from '../src/memory/store.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let tmp: string;
let db: Db;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-stale-'));
  cpSync(path.join(FIXTURES, 'ts-mini'), tmp, { recursive: true });
  db = openDb(':memory:');
  await indexRepo({ root: tmp, db });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function edit(rel: string, from: string, to: string): void {
  const p = path.join(tmp, rel);
  writeFileSync(p, readFileSync(p, 'utf8').replace(from, to));
}

function rememberOnMove() {
  return remember(db, {
    type: 'invariant',
    title: 'Coords are 0-based',
    body: 'Board coordinates are (col,row), 0-based; only the UI converts to 1-based.',
    why: 'off-by-one bugs happened twice before',
    anchors: [{ symbol: 'src/board.ts#Board.move' }],
    author: 'test',
  });
}

// The soul of the product (SPEC US3): a note must raise its hand when its code changes,
// heal when the code comes back, follow the code when it moves, and never cry wolf on formatting.
describe('staleness lifecycle', () => {
  it('fresh → drift (with old/new hash) → heal on revert', async () => {
    const { id } = rememberOnMove();
    expect(reconcileAnchors(db).events).toEqual([]);
    expect(getMemory(db, id)?.status).toBe('fresh');

    edit('src/board.ts', 'return true;', 'return from !== to;');
    await indexRepo({ root: tmp, db });
    let report = reconcileAnchors(db);
    expect(report.events.map((e) => e.event)).toEqual(['drifted']);
    expect(report.needsReview).toEqual([id]);

    const drifted = getMemory(db, id);
    expect(drifted?.status).toBe('needs_review');
    const anchor = drifted?.anchors[0];
    expect(anchor?.status).toBe('drift');
    expect(anchor?.stale_since).not.toBeNull();
    const meta = JSON.parse(anchor?.meta ?? '{}') as { old_hash: string; new_hash: string };
    expect(meta.old_hash).toBeTruthy();
    expect(meta.new_hash).toBeTruthy();
    expect(meta.old_hash).not.toBe(meta.new_hash);

    edit('src/board.ts', 'return from !== to;', 'return true;');
    await indexRepo({ root: tmp, db });
    report = reconcileAnchors(db);
    expect(report.events.map((e) => e.event)).toEqual(['healed']);
    expect(getMemory(db, id)?.status).toBe('fresh');
    expect(getMemory(db, id)?.anchors[0]?.status).toBe('fresh');
  });

  it('formatting-only edits never disturb memories (symbol AND file anchors)', async () => {
    const { id } = remember(db, {
      type: 'convention',
      title: 'Utils stay dependency-free',
      body: 'src/utils.ts must not import from other modules.',
      why: 'keeps the helpers reusable in workers',
      anchors: [{ symbol: 'src/board.ts#Board.move' }, { file: 'src/utils.ts' }],
      author: 'test',
    });
    for (const rel of ['src/board.ts', 'src/utils.ts']) {
      const p = path.join(tmp, rel);
      writeFileSync(p, `// reformat pass\n${readFileSync(p, 'utf8').replaceAll('\n', '\n\n')}`);
    }
    const r = await indexRepo({ root: tmp, db });
    expect(r.filesIndexed).toBe(2); // files DID change on disk...
    const report = reconcileAnchors(db);
    expect(report.events).toEqual([]); // ...but no memory noise — the core promise
    expect(getMemory(db, id)?.status).toBe('fresh');
  });

  it('renaming a file auto-moves anchors (same fingerprint) and stays quiet afterwards', async () => {
    const { id } = rememberOnMove();
    mkdirSync(path.join(tmp, 'src', 'engine'));
    renameSync(path.join(tmp, 'src', 'board.ts'), path.join(tmp, 'src', 'engine', 'board.ts'));
    await indexRepo({ root: tmp, db });

    const report = reconcileAnchors(db);
    expect(report.events.map((e) => e.event)).toEqual(['moved']);
    const m = getMemory(db, id);
    expect(m?.status).toBe('fresh'); // moved is not a review reason
    expect(m?.anchors[0]?.qname).toBe('src/engine/board.ts#Board.move');

    expect(reconcileAnchors(db).events).toEqual([]); // moved -> fresh silently
    expect(getMemory(db, id)?.anchors[0]?.status).toBe('fresh');
  });

  it('deleted symbol → missing; confirm refuses; retire removes it from the loop', async () => {
    const { id } = rememberOnMove();
    writeFileSync(
      path.join(tmp, 'src', 'board.ts'),
      'export class Board {\n  undo(): void {}\n}\n',
    );
    await indexRepo({ root: tmp, db });

    const report = reconcileAnchors(db);
    expect(report.events.map((e) => e.event)).toEqual(['went_missing']);
    const m = getMemory(db, id);
    expect(m?.status).toBe('needs_review');
    expect(m?.anchors[0]?.status).toBe('missing');

    expect(() => confirmMemory(db, id)).toThrow(/missing/);
    retireMemory(db, id);
    expect(getMemory(db, id)?.status).toBe('retired');
    expect(reconcileAnchors(db).checked).toBe(0);
  });

  it('confirm after drift snapshots the new hash and satisfies the next reconcile', async () => {
    const { id } = rememberOnMove();
    edit('src/board.ts', 'return true;', 'return from !== to;');
    await indexRepo({ root: tmp, db });
    reconcileAnchors(db);
    expect(getMemory(db, id)?.status).toBe('needs_review');

    confirmMemory(db, id);
    const m = getMemory(db, id);
    expect(m?.status).toBe('fresh');
    expect(m?.anchors[0]?.status).toBe('fresh');
    expect(m?.anchors[0]?.meta).toBeNull();
    expect(reconcileAnchors(db).events).toEqual([]);
  });

  it('moveAnchor re-points a note at another symbol', async () => {
    const { id } = rememberOnMove();
    const anchorId = getMemory(db, id)?.anchors[0]?.id;
    expect(anchorId).toBeDefined();
    moveAnchor(db, id, anchorId ?? -1, { symbol: 'src/utils.ts#clamp' });
    const m = getMemory(db, id);
    expect(m?.anchors[0]?.qname).toBe('src/utils.ts#clamp');
    expect(m?.status).toBe('fresh');
    expect(reconcileAnchors(db).events).toEqual([]);
  });
});
