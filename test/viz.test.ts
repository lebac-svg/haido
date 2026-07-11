import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cmdExportViz, cmdViz } from '../src/cli/commands.js';
import { openDb } from '../src/core/db.js';
import { ensureWorkspace } from '../src/core/workspace.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { remember } from '../src/memory/store.js';
import { buildVizHtml } from '../src/viz/html.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let tmp: string;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-viz-'));
  cpSync(path.join(FIXTURES, 'ts-mini'), tmp, { recursive: true });
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
  db.close();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('haido viz', () => {
  it('renders a self-contained HTML with the embedded data', () => {
    const file = cmdViz(tmp);
    expect(file).toBe(path.join(tmp, '.haido', 'map.html'));
    const html = readFileSync(file, 'utf8');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Hải Đồ');
    expect(html).toContain('src/board.ts'); // file node present in data
    expect(html).toContain('Toạ độ 0-based'); // memory travels into the page
    expect(html).not.toContain('__HAIDO_DATA__'); // placeholder replaced
    expect(html).not.toContain('__REPO_NAME__'); // BOTH occurrences (title + h1) replaced
    expect(html).not.toContain('src="http'); // strictly self-contained
    expect(html).not.toContain('https://'); // no external references at all
  });

  it('bakes the UI language at generation time (en default, vi opt-in)', () => {
    const en = buildVizHtml('{"files":[],"memories":[],"edges":[]}', 'x');
    expect(en).toContain('only files with notes');
    expect(en).toContain("Ship's log"); // bridge panel labels are translated too
    expect(en).toContain('Inspector');
    expect(en).toContain('Review station');
    expect(en).not.toContain('chỉ file có ghi chú');
    const vi = buildVizHtml('{"files":[],"memories":[],"edges":[]}', 'x', 'vi');
    expect(vi).toContain('chỉ file có ghi chú');
    expect(vi).toContain('Nhật ký hải trình');
  });

  it('viz JSON carries structure (syms) and note timeline (created)', () => {
    const data = JSON.parse(cmdExportViz(tmp)) as {
      files: Array<{ path: string; syms: Array<{ k: string; n: string; l1: number }> }>;
      memories: Array<{ created: number }>;
    };
    const board = data.files.find((f) => f.path === 'src/board.ts');
    expect(board).toBeDefined();
    expect(board?.syms.length).toBeGreaterThan(0);
    expect(board?.syms[0]?.k).toBeTruthy();
    expect(board?.syms[0]?.l1).toBeGreaterThan(0);
    expect(typeof data.memories[0]?.created).toBe('number');
  });

  it('escapes </script> injection in embedded data', () => {
    const html = buildVizHtml(JSON.stringify({ files: [{ path: 'a</script><b>.ts' }] }), 'x');
    expect(html).not.toContain('a</script>');
    expect(html).toContain('\\u003c/script');
  });
});
