import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/core/db.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { retireMemory } from '../src/memory/reanchor.js';
import { exportPack, importPack, parsePackFile } from '../src/memory/pack.js';
import { getMemory, remember } from '../src/memory/store.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let tmp: string;
let db: Db;
let packDir: string;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-pack-'));
  cpSync(path.join(FIXTURES, 'ts-mini'), tmp, { recursive: true });
  packDir = path.join(tmp, 'docs', 'memory-pack');
  db = openDb(':memory:');
  await indexRepo({ root: tmp, db });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function seed(): { inv: string; retired: string } {
  const inv = remember(db, {
    type: 'invariant',
    title: 'Toạ độ 0-based',
    body: 'Board dùng (col,row) 0-based; chỉ UI đổi sang 1-based.',
    why: 'đã sập bug lệch-1 hai lần',
    anchors: [{ symbol: 'src/board.ts#Board.move' }, { file: 'src/utils.ts' }],
    author: 'test',
  }).id;
  const retired = remember(db, {
    type: 'decision',
    title: 'Quyết định đã bỏ',
    body: 'Từng dùng float cho tiền.',
    why: 'lịch sử — đã thay bằng integer cents',
    anchors: [{ file: 'src/utils.ts' }],
    author: 'test',
  }).id;
  retireMemory(db, retired);
  return { inv, retired };
}

describe('memory pack roundtrip', () => {
  it('export → fresh machine import → identical memories, anchors resolve fresh', async () => {
    const { inv, retired } = seed();
    const r = exportPack(db, packDir);
    expect(r.written).toBe(2);
    expect(readdirSync(packDir).sort()).toEqual([`${inv}.md`, `${retired}.md`].sort());

    // "new machine": fresh db, same code, import the pack
    const db2 = openDb(':memory:');
    await indexRepo({ root: tmp, db: db2 });
    const imported = importPack(db2, packDir);
    expect(imported).toMatchObject({ imported: 2, updated: 0, unchanged: 0 });

    const m = getMemory(db2, inv);
    expect(m?.title).toBe('Toạ độ 0-based');
    expect(m?.status).toBe('fresh');
    expect(m?.anchors.map((a) => a.status)).toEqual(['fresh', 'fresh']);
    expect(getMemory(db2, retired)?.status).toBe('retired');

    // re-import is a no-op
    const again = importPack(db2, packDir);
    expect(again).toMatchObject({ imported: 0, updated: 0, unchanged: 2 });
    db2.close();
  });

  it('recorded hashes carry staleness across machines: code moved on → DRIFT after import', async () => {
    const { inv } = seed();
    exportPack(db, packDir);

    // machine B: the code has changed since the pack was written
    const boardPath = path.join(tmp, 'src', 'board.ts');
    writeFileSync(
      boardPath,
      readFileSync(boardPath, 'utf8').replace('return true;', 'return from !== to;'),
    );
    const db2 = openDb(':memory:');
    await indexRepo({ root: tmp, db: db2 });
    importPack(db2, packDir);

    const m = getMemory(db2, inv);
    expect(m?.status).toBe('needs_review');
    expect(m?.anchors.find((a) => a.target_kind === 'symbol')?.status).toBe('drift');
    db2.close();
  });

  it('hand-written bootstrap files (no hash) resolve to the current hash on import', async () => {
    writeFileSync(
      path.join(tmp, 'hand.md'),
      [
        '---',
        'id: m_hand_001',
        'type: convention',
        'status: fresh',
        'anchors:',
        "  - { kind: file, path: 'src/utils.ts' }",
        'created: 2026-07-10',
        'author: human:daiba',
        '---',
        '',
        '# Utils zero-dependency',
        '',
        'src/utils.ts không import module khác.',
        '',
        '**Why:** tái dùng trong worker.',
        '',
      ].join('\n'),
    );
    const r = importPack(db, tmp); // reads *.md in tmp root (only hand.md)
    expect(r.imported).toBe(1);
    const m = getMemory(db, 'm_hand_001');
    expect(m?.anchors[0]?.status).toBe('fresh');
    expect(m?.anchors[0]?.hash_at_link).not.toBe('');
  });

  it('parsePackFile rejects malformed files with a reason', () => {
    expect(parsePackFile('no frontmatter')).toContain('frontmatter');
    expect(
      parsePackFile('---\nid: x\ntype: invariant\nanchors:\n---\n# T\n\nbody\n\n**Why:** w'),
    ).toBe('no anchors');
    expect(
      parsePackFile(
        "---\nid: x\ntype: nope\nanchors:\n  - { kind: file, path: 'a.ts' }\n---\n# T\n\nb\n\n**Why:** w",
      ),
    ).toContain('invalid type');
  });

  it('export flags orphan files but never deletes them', () => {
    seed();
    exportPack(db, packDir);
    writeFileSync(path.join(packDir, 'm_gone_123.md'), '---\nid: m_gone_123\n---\n# Old note\n');
    const r = exportPack(db, packDir);
    expect(r.orphans).toEqual(['m_gone_123.md']);
    expect(readdirSync(packDir)).toContain('m_gone_123.md');
  });
});
