import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/core/db.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { reconcileAnchors } from '../src/memory/staleness.js';
import { remember } from '../src/memory/store.js';
import { mapOverview } from '../src/recall/overview.js';
import { recall } from '../src/recall/rank.js';
import { findRelated } from '../src/recall/related.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let tmp: string;
let db: Db;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-recall-'));
  cpSync(path.join(FIXTURES, 'ts-mini'), tmp, { recursive: true });
  db = openDb(':memory:');
  await indexRepo({ root: tmp, db });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function seed() {
  const inv = remember(db, {
    type: 'invariant',
    title: 'Toạ độ 0-based',
    body: 'Board dùng (col,row) 0-based; chỉ UI đổi sang 1-based.',
    why: 'đã sập bug lệch-1 hai lần',
    anchors: [{ symbol: 'src/board.ts#Board.move' }],
    author: 't',
  }).id;
  const conv = remember(db, {
    type: 'convention',
    title: 'Utils zero-dependency',
    body: 'src/utils.ts không được import module khác.',
    why: 'tái dùng được trong worker',
    anchors: [{ file: 'src/utils.ts' }],
    author: 't',
  }).id;
  const todo = remember(db, {
    type: 'todo',
    title: 'Test biên cho clamp',
    body: 'clamp chưa có test cho NaN và lo>hi.',
    why: 'đề phòng NaN lọt qua phép so sánh',
    anchors: [{ symbol: 'src/utils.ts#clamp' }],
    author: 't',
  }).id;
  return { inv, conv, todo };
}

describe('recall ranking', () => {
  it('exact anchor ranks first; invariant outranks todo on the same file', () => {
    const { inv } = seed();
    const r = recall(db, { symbol: 'src/board.ts#Board.move' });
    expect(r.hits[0]?.memory.id).toBe(inv);
    expect(r.hits[0]?.proximity).toBe('exact');
    expect(r.text).toContain('INVARIANT');

    const utils = recall(db, { file: 'src/utils.ts' });
    expect(utils.hits.slice(0, 2).map((h) => h.proximity)).toEqual(['exact', 'exact']);
    expect(utils.hits[0]?.memory.type).toBe('convention'); // 0.6 prior beats todo 0.3
    expect(utils.hits[2]?.proximity).toBe('neighbor'); // board's invariant rides same-dir
  });

  it('memories travel across import edges (neighborhood recall)', () => {
    const { inv } = seed();
    const r = recall(db, { file: 'src/index.ts' }); // index.ts imports board.ts + utils.ts
    const hit = r.hits.find((h) => h.memory.id === inv);
    expect(hit?.proximity).toBe('neighbor');
    expect(hit?.via).toContain('src/board.ts');
    expect(r.hits.length).toBe(3); // all three ride the import edges
  });

  it('needs_review is penalized but still visible with a warning label', async () => {
    const { inv, conv } = seed();
    const p = path.join(tmp, 'src', 'board.ts');
    writeFileSync(p, readFileSync(p, 'utf8').replace('return true;', 'return from !== to;'));
    await indexRepo({ root: tmp, db });
    reconcileAnchors(db);

    const r = recall(db, { file: 'src/index.ts' });
    const invIndex = r.hits.findIndex((h) => h.memory.id === inv);
    const convIndex = r.hits.findIndex((h) => h.memory.id === conv);
    expect(invIndex).toBeGreaterThan(convIndex); // penalty pushed it down...
    expect(invIndex).not.toBe(-1); // ...but never hidden
    expect(r.text).toContain('CẦN-REVIEW');
  });

  it('token budget cuts the list but always keeps the top hit', () => {
    seed();
    const r = recall(db, { file: 'src/index.ts', budgetTokens: 40 });
    expect(r.hits.length).toBe(1);
    expect(r.usedTokens).toBeGreaterThan(0);
  });
});

describe('findRelated', () => {
  it('explains import edges in both directions and same-dir', () => {
    const forIndex = findRelated(db, { file: 'src/index.ts' });
    expect(forIndex.map((r) => r.path).sort()).toEqual(['src/board.ts', 'src/utils.ts']);
    expect(forIndex[0]?.reasons[0]).toBe('import');

    const forBoard = findRelated(db, { file: 'src/board.ts' });
    const back = forBoard.find((r) => r.path === 'src/index.ts');
    expect(back?.reasons).toContain('được import bởi');
    const sameDir = forBoard.find((r) => r.path === 'src/utils.ts');
    expect(sameDir?.reasons).toContain('cùng thư mục');
  });

  it('accepts a symbol and uses its file', () => {
    const rows = findRelated(db, { symbol: 'src/index.ts#start' });
    expect(rows.map((r) => r.path)).toContain('src/board.ts');
  });
});

describe('mapOverview', () => {
  it('summarizes directories and lists standing laws', () => {
    seed();
    const text = mapOverview(db);
    expect(text).toContain('src/');
    expect(text).toContain('3 file');
    expect(text).toContain('INVARIANT');
    expect(text).toContain('Toạ độ 0-based');
  });

  it('respects a small token budget by trimming', () => {
    seed();
    const text = mapOverview(db, { budgetTokens: 200 });
    expect(text.length).toBeLessThan(1000);
  });
});
