import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectStats, formatStats } from '../src/cli/stats.js';
import { openDb, type Db } from '../src/core/db.js';
import { ensureWorkspace } from '../src/core/workspace.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { reconcileAnchors } from '../src/memory/staleness.js';
import { remember } from '../src/memory/store.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let tmp: string;
let db: Db;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-stats-'));
  cpSync(path.join(FIXTURES, 'ts-mini'), tmp, { recursive: true });
  db = openDb(ensureWorkspace(tmp));
  await indexRepo({ root: tmp, db });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('haido stats', () => {
  it('counts memories, anchors, drift and hook-session activity', async () => {
    remember(db, {
      type: 'invariant',
      title: 'A',
      body: 'a',
      why: 'because reasons',
      anchors: [{ symbol: 'src/board.ts#Board.move' }],
      author: 'test',
    });
    remember(db, {
      type: 'gotcha',
      title: 'B',
      body: 'b',
      why: 'because reasons',
      anchors: [{ file: 'src/utils.ts' }],
      author: 'test',
    });

    // drift the first one
    const abs = path.join(tmp, 'src', 'board.ts');
    writeFileSync(abs, readFileSync(abs, 'utf8').replace('return true;', 'return 1 < 2;'));
    await indexRepo({ root: tmp, db });
    reconcileAnchors(db);

    // one hook session that injected a note and agent-edited two files
    const sessionDir = path.join(tmp, '.haido', 'session');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, 's1.json'),
      JSON.stringify({
        injected: ['m_x'],
        lastTouch: { 'src/board.ts': Date.now(), 'src/utils.ts': Date.now() },
      }),
    );

    const s = collectStats(db, tmp);
    expect(s.index.files).toBeGreaterThan(0);
    expect(s.memories.live).toBe(2);
    expect(s.memories.needsReview).toBe(1);
    expect(s.memories.byType['invariant']).toBe(1);
    expect(s.memories.createdLast7d).toBe(2);
    expect(s.anchors.total).toBe(2);
    expect(s.anchors.byStatus['drift']).toBe(1);
    expect(s.anchors.withSnapshot).toBe(2);
    expect(s.sessions.seen).toBe(1);
    expect(s.sessions.notesInjected).toBe(1);
    expect(s.sessions.agentEditedFiles).toBe(2);

    const text = formatStats(s);
    expect(text).toContain('memories: 2 live');
    expect(text).toContain('need review');
    expect(text).toContain('files agent-edited 2');
  });
});
