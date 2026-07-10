import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAnchorSpec } from '../src/cli/commands.js';
import { openDb, type Db } from '../src/core/db.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { remember } from '../src/memory/store.js';
import { recallBasic } from '../src/recall/basic.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let tmp: string;
let db: Db;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-store-'));
  cpSync(path.join(FIXTURES, 'ts-mini'), tmp, { recursive: true });
  db = openDb(':memory:');
  await indexRepo({ root: tmp, db });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

const base = {
  type: 'decision' as const,
  title: 'Use integer cents',
  body: 'All money amounts are integer cents; never floats.',
  why: 'float rounding corrupted invoice totals once',
  author: 'test',
};

describe('remember — hygiene enforcement (SPEC §9)', () => {
  it('accepts a valid memory and snapshots the anchor hash from the index', () => {
    const { id } = remember(db, { ...base, anchors: [{ symbol: 'src/board.ts#Board.move' }] });
    const anchor = db
      .prepare(`SELECT hash_at_link, path FROM anchors WHERE memory_id = ?`)
      .get(id) as { hash_at_link: string; path: string };
    const symbol = db
      .prepare(`SELECT body_hash FROM symbols WHERE qname = ? AND deleted_at IS NULL`)
      .get('src/board.ts#Board.move') as { body_hash: string };
    expect(anchor.hash_at_link).toBe(symbol.body_hash);
    expect(anchor.path).toBe('src/board.ts');
  });

  it('rejects a memory without anchors', () => {
    expect(() => remember(db, { ...base, anchors: [] })).toThrow(/anchor/);
  });

  it('rejects a memory without a real why', () => {
    expect(() =>
      remember(db, { ...base, why: 'because', anchors: [{ file: 'src/utils.ts' }] }),
    ).toThrow(/why/);
  });

  it('rejects an over-long body (one memory, one fact)', () => {
    expect(() =>
      remember(db, { ...base, body: 'x'.repeat(701), anchors: [{ file: 'src/utils.ts' }] }),
    ).toThrow(/700/);
  });

  it('rejects an unknown symbol and suggests near-matches', () => {
    expect(() =>
      remember(db, { ...base, anchors: [{ symbol: 'src/board.ts#Board.mvoe' }] }),
    ).toThrow(/unknown symbol/);
    try {
      remember(db, { ...base, anchors: [{ symbol: 'move' }] });
    } catch (e) {
      expect((e as Error).message).toContain('Did you mean');
      expect((e as Error).message).toContain('src/board.ts#Board.move');
    }
  });

  it('flags likely duplicates instead of silently stacking them', () => {
    const first = remember(db, { ...base, anchors: [{ file: 'src/utils.ts' }] });
    const second = remember(db, {
      ...base,
      title: 'Money uses integer cents',
      anchors: [{ file: 'src/utils.ts' }],
    });
    expect(second.duplicates.map((d) => d.id)).toContain(first.id);
  });
});

describe('recallBasic', () => {
  it('exact anchor beats same-file, and text search works', () => {
    const onMove = remember(db, { ...base, anchors: [{ symbol: 'src/board.ts#Board.move' }] });
    const onFile = remember(db, {
      ...base,
      title: 'Board file convention',
      body: 'Keep Board pure: no DOM access in this file.',
      anchors: [{ file: 'src/board.ts' }],
    });

    const bySymbol = recallBasic(db, { symbol: 'src/board.ts#Board.move' });
    expect(bySymbol[0]?.memory.id).toBe(onMove.id);
    expect(bySymbol[0]?.reason).toBe('anchored');
    expect(bySymbol.find((h) => h.memory.id === onFile.id)?.reason).toBe('same-file');

    const byOtherSymbol = recallBasic(db, { symbol: 'src/board.ts#Board.undo' });
    expect(byOtherSymbol.map((h) => h.reason)).toContain('same-file');

    const byQuery = recallBasic(db, { query: 'integer cents money' });
    expect(byQuery.length).toBeGreaterThan(0);
    expect(byQuery[0]?.reason).toBe('text-match');
  });
});

describe('parseAnchorSpec', () => {
  it('parses sym:/file: prefixes and auto-detects by #', () => {
    expect(parseAnchorSpec('sym:src/a.ts#f')).toEqual({ symbol: 'src/a.ts#f' });
    expect(parseAnchorSpec('file:src/a.ts')).toEqual({ file: 'src/a.ts' });
    expect(parseAnchorSpec('src/a.ts#f')).toEqual({ symbol: 'src/a.ts#f' });
    expect(parseAnchorSpec('src/a.ts')).toEqual({ file: 'src/a.ts' });
  });
});
