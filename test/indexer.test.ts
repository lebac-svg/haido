import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/core/db.js';
import { indexRepo } from '../src/indexer/indexer.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let tmp: string;
let db: Db;

function setup(fixture: string): void {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-test-'));
  cpSync(path.join(FIXTURES, fixture), tmp, { recursive: true });
  db = openDb(':memory:');
}

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('indexRepo on ts-mini', () => {
  beforeEach(() => setup('ts-mini'));

  it('cold index finds all files, symbols, and import edges', async () => {
    const r = await indexRepo({ root: tmp, db });
    expect(r.filesSeen).toBe(3);
    expect(r.filesIndexed).toBe(3);
    expect(r.diffs.filter((d) => d.change === 'added')).toHaveLength(9);

    const edges = db
      .prepare(
        `SELECT fs.path AS src, fd.path AS dst FROM edges e
         JOIN files fs ON fs.id = e.src_id JOIN files fd ON fd.id = e.dst_id
         WHERE e.kind = 'imports' ORDER BY dst`,
      )
      .all() as Array<{ src: string; dst: string }>;
    expect(edges).toEqual([
      { src: 'src/index.ts', dst: 'src/board.ts' },
      { src: 'src/index.ts', dst: 'src/utils.ts' },
    ]);
  });

  it('second run is a no-op (mtime+size fast path)', async () => {
    await indexRepo({ root: tmp, db });
    const r2 = await indexRepo({ root: tmp, db });
    expect(r2.filesIndexed).toBe(0);
    expect(r2.diffs).toEqual([]);
  });

  it('editing one method body changes that method AND its containing class (by design)', async () => {
    await indexRepo({ root: tmp, db });
    const boardPath = path.join(tmp, 'src', 'board.ts');
    writeFileSync(
      boardPath,
      readFileSync(boardPath, 'utf8').replace('return true;', 'return from !== to;'),
    );
    const r = await indexRepo({ root: tmp, db });
    expect(r.filesIndexed).toBe(1);
    // v0.1 policy "sensitive over silent": a class hash covers its member bodies,
    // so class-anchored memories also go up for review. Board.undo must NOT change.
    expect(r.diffs.map((d) => [d.qname, d.change])).toEqual([
      ['src/board.ts#Board', 'changed'],
      ['src/board.ts#Board.move', 'changed'],
    ]);
  });

  it('formatting-only edits reindex the file but produce ZERO diffs', async () => {
    await indexRepo({ root: tmp, db });
    const utilsPath = path.join(tmp, 'src', 'utils.ts');
    const reformatted = readFileSync(utilsPath, 'utf8')
      .replace('export function lerp', '// a new comment\nexport function  lerp')
      .replaceAll('\n', '\n\n');
    writeFileSync(utilsPath, reformatted);
    const r = await indexRepo({ root: tmp, db });
    expect(r.filesIndexed).toBe(1);
    expect(r.diffs).toEqual([]); // the core promise: no stale spam from formatting
  });
});

describe('indexRepo on py-mini', () => {
  beforeEach(() => setup('py-mini'));

  it('indexes python and resolves imports', async () => {
    const r = await indexRepo({ root: tmp, db });
    expect(r.filesSeen).toBe(3);
    const qnames = r.diffs.map((d) => d.qname).sort();
    expect(qnames).toEqual(
      [
        'game.py#Game',
        'game.py#Game.__init__',
        'game.py#Game.move',
        'game.py#new_game',
        'helpers.py#clamp',
        'main.py#run',
      ].sort(),
    );
    const edgeCount = db
      .prepare(`SELECT count(*) AS c FROM edges WHERE kind = 'imports'`)
      .get() as { c: number };
    expect(edgeCount.c).toBe(2); // main -> game, main -> helpers
  });

  it('deleting a file soft-deletes symbols and cleans edges pointing at it', async () => {
    await indexRepo({ root: tmp, db });
    rmSync(path.join(tmp, 'helpers.py'));
    const r = await indexRepo({ root: tmp, db });
    expect(r.filesDeleted).toBe(1);
    expect(r.diffs).toEqual([
      {
        qname: 'helpers.py#clamp',
        change: 'removed',
        oldHash: expect.any(String) as unknown as string,
      },
    ]);
    const alive = db
      .prepare(`SELECT count(*) AS c FROM symbols WHERE deleted_at IS NULL`)
      .get() as { c: number };
    expect(alive.c).toBe(5); // 6 - clamp
    const edgeCount = db
      .prepare(`SELECT count(*) AS c FROM edges WHERE kind = 'imports'`)
      .get() as { c: number };
    expect(edgeCount.c).toBe(1); // only main -> game survives
  });
});
