import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/core/db.js';
import { mineCoChange } from '../src/git/cochange.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { findRelated } from '../src/recall/related.js';

let tmp: string;
let db: Db;

function git(...args: string[]): void {
  const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

function bump(rel: string, salt: string): void {
  writeFileSync(path.join(tmp, rel), `export const v_${salt} = '${salt}';\n`);
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-git-'));
  db = openDb(':memory:');
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@haido.local');
  git('config', 'user.name', 'haido test');
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('co-change mining', () => {
  it('files committed together >= 3 times become an edge; loners do not', async () => {
    // a & b always change together; c changes alone
    for (const round of ['one', 'two', 'three']) {
      bump('a.ts', round);
      bump('b.ts', round);
      git('add', '.');
      git('commit', '-m', `round ${round}`);
    }
    bump('c.ts', 'solo');
    git('add', '.');
    git('commit', '-m', 'solo c');

    await indexRepo({ root: tmp, db });
    const result = mineCoChange({ root: tmp, db });
    expect(result.ok).toBe(true);
    expect(result.commitsScanned).toBe(4);
    expect(result.pairsStored).toBe(1);

    const related = findRelated(db, { file: 'a.ts' });
    const b = related.find((r) => r.path === 'b.ts');
    expect(b?.reasons.some((x) => x.includes('changes together (3×)'))).toBe(true);
    expect(related.find((r) => r.path === 'c.ts')?.reasons).toEqual(['same directory']);
  });

  it('re-mining is idempotent (full rebuild, no duplicate edges)', async () => {
    for (const round of ['one', 'two', 'three']) {
      bump('a.ts', round);
      bump('b.ts', round);
      git('add', '.');
      git('commit', '-m', round);
    }
    await indexRepo({ root: tmp, db });
    mineCoChange({ root: tmp, db });
    mineCoChange({ root: tmp, db });
    const count = db.prepare(`SELECT count(*) AS c FROM edges WHERE kind = 'co_change'`).get() as {
      c: number;
    };
    expect(count.c).toBe(1);
  });

  it('degrades gracefully outside a git repo', async () => {
    const bare = mkdtempSync(path.join(os.tmpdir(), 'haido-nogit-'));
    try {
      const db2 = openDb(':memory:');
      const r = mineCoChange({ root: bare, db: db2 });
      expect(r.ok).toBe(false);
      db2.close();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
