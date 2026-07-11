import Database from 'better-sqlite3';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatStale } from '../src/cli/format.js';
import { buildVizJson } from '../src/viz/data.js';
import { openDb } from '../src/core/db.js';
import { ensureWorkspace } from '../src/core/workspace.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { tokenDiff } from '../src/memory/diff.js';
import { listNeedsReview, remember } from '../src/memory/store.js';
import { reconcileAnchors } from '../src/memory/staleness.js';

describe('tokenDiff', () => {
  it('renders a small change inside a long body with collapsed context', () => {
    const base = 'function move ( from , to ) { if ( ! valid ) return false ;';
    const oldT = `${base} return true ; }`;
    const newT = `${base} return from !== to ; }`;
    const d = tokenDiff(oldT, newT);
    expect(d).toContain('⟨- true⟩');
    expect(d).toContain('⟨+ from !== to⟩');
    expect(d).toContain('…'); // long unchanged prefix collapsed
    expect(d).not.toContain('valid'); // context beyond the window is elided
  });

  it('handles pure insertions and pure deletions', () => {
    expect(tokenDiff('a b c', 'a b c d e')).toContain('⟨+ d e⟩');
    expect(tokenDiff('a b c d', 'a d')).toContain('⟨- b c⟩');
  });

  it('is honest about no change and caps runaway output', () => {
    expect(tokenDiff('a b', 'a b')).toBe('(no token change)');
    const noise = (seed: string): string =>
      Array.from({ length: 3000 }, (_, i) => `${seed}${String(i)}`).join(' ');
    expect(tokenDiff(noise('x'), noise('y')).length).toBeLessThanOrEqual(490);
  });
});

describe('drift review shows the actual code diff', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-diff-'));
    cpSync(fileURLToPath(new URL('./fixtures/ts-mini', import.meta.url)), tmp, {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('haido stale renders Δ old→new tokens for a drifted symbol anchor', async () => {
    const db = openDb(ensureWorkspace(tmp));
    await indexRepo({ root: tmp, db });
    remember(db, {
      type: 'invariant',
      title: 'Toạ độ 0-based',
      body: 'Board dùng (col,row) 0-based.',
      why: 'đã sập bug lệch-1 hai lần',
      anchors: [{ symbol: 'src/board.ts#Board.move' }],
      author: 'test',
    });

    const abs = path.join(tmp, 'src', 'board.ts');
    writeFileSync(abs, readFileSync(abs, 'utf8').replace('return true;', 'return from !== to;'));
    await indexRepo({ root: tmp, db });
    reconcileAnchors(db);

    const out = formatStale(listNeedsReview(db));
    expect(out).toContain('Δ');
    expect(out).toContain('⟨- true⟩');
    expect(out).toContain('⟨+ from !== to⟩');

    // the review station on the bridge gets the same diff via the viz payload
    const viz = JSON.parse(buildVizJson(db)) as {
      memories: Array<{
        status: string;
        anchors: Array<{ status: string; diff?: string; snapshot?: unknown }>;
      }>;
    };
    const flagged = viz.memories.find((m) => m.status === 'needs_review');
    const drifted = flagged?.anchors.find((a) => a.status === 'drift');
    expect(drifted?.diff).toContain('⟨+ from !== to⟩');
    expect(drifted?.snapshot).toBeUndefined(); // raw snapshots never ship to the page
    db.close();
  });
});

describe('schema migration v1 → v2', () => {
  it('adds snapshot columns in place; the indexer self-heals missing norm_text', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-mig-'));
    const file = path.join(tmp, 'haido.db');
    const v1 = new Database(file);
    v1.exec(
      `CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, lang TEXT NOT NULL,
         content_hash TEXT NOT NULL, norm_hash TEXT NOT NULL, mtime INTEGER NOT NULL,
         size INTEGER NOT NULL, indexed_at INTEGER NOT NULL, deleted_at INTEGER);
       CREATE TABLE symbols (id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, kind TEXT NOT NULL,
         name TEXT NOT NULL, qname TEXT NOT NULL, start_line INTEGER NOT NULL,
         end_line INTEGER NOT NULL, signature TEXT, body_hash TEXT NOT NULL,
         updated_at INTEGER NOT NULL, deleted_at INTEGER);
       CREATE TABLE anchors (id INTEGER PRIMARY KEY, memory_id TEXT NOT NULL,
         target_kind TEXT NOT NULL, qname TEXT NOT NULL, path TEXT NOT NULL,
         hash_at_link TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'fresh',
         stale_since INTEGER, meta TEXT);
       CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       INSERT INTO meta VALUES ('schema_version', '1');
       INSERT INTO files (path, lang, content_hash, norm_hash, mtime, size, indexed_at)
         VALUES ('a.ts', 'ts', 'c1', 'n1', 12345, 10, 1);`,
    );
    v1.close();

    const db = openDb(file); // migrates on open
    const cols = (table: string): string[] =>
      (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
    expect(cols('files')).toContain('norm_text');
    expect(cols('symbols')).toContain('norm_text');
    expect(cols('anchors')).toContain('snapshot');
    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as {
      value: string;
    };
    expect(version.value).toBe('2');
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('re-parses an unchanged file whose norm_text is NULL (pre-v2 row)', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-heal-'));
    cpSync(fileURLToPath(new URL('./fixtures/ts-mini', import.meta.url)), tmp, {
      recursive: true,
    });
    const db = openDb(ensureWorkspace(tmp));
    await indexRepo({ root: tmp, db });
    // Simulate a pre-v2 row: wipe norm_text while mtime/size/content stay identical.
    db.exec(`UPDATE files SET norm_text = NULL; UPDATE symbols SET norm_text = NULL;`);
    const again = await indexRepo({ root: tmp, db });
    expect(again.filesIndexed).toBeGreaterThan(0); // self-heal re-parsed them
    const missing = db
      .prepare(`SELECT count(*) AS c FROM files WHERE norm_text IS NULL AND deleted_at IS NULL`)
      .get() as { c: number };
    expect(missing.c).toBe(0);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });
});
