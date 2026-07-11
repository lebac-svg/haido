import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db.js';
import { ensureWorkspace } from '../src/core/workspace.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { remember } from '../src/memory/store.js';
import { runHook } from '../src/integrations/claude-code/hook.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let tmp: string;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-hook-'));
  cpSync(path.join(FIXTURES, 'ts-mini'), tmp, { recursive: true });
  const db = openDb(ensureWorkspace(tmp)); // real .haido/haido.db — hooks open it themselves
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

const payload = (extra: Record<string, unknown>): string =>
  JSON.stringify({ session_id: 'sess-1', cwd: tmp, ...extra });

interface HookOut {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

describe('claude-code hook runner', () => {
  it('session-start injects the map once, then stays silent for that session', async () => {
    const first = await runHook('session-start', tmp, payload({ source: 'startup' }));
    expect(first).not.toBeNull();
    const parsed = JSON.parse(first ?? '') as HookOut;
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('Project map'); // en default
    expect(parsed.hookSpecificOutput.additionalContext).toContain('Toạ độ 0-based');

    expect(await runHook('session-start', tmp, payload({}))).toBeNull();
  });

  it('post-tool Read injects anchored memories exactly once per session (Windows abs path)', async () => {
    const absWin = path.join(tmp, 'src', 'board.ts'); // absolute, backslashes on Windows
    const first = await runHook(
      'post-tool',
      tmp,
      payload({ tool_name: 'Read', tool_input: { file_path: absWin } }),
    );
    expect(first).not.toBeNull();
    const parsed = JSON.parse(first ?? '') as HookOut;
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('INVARIANT');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('Toạ độ 0-based');

    const second = await runHook(
      'post-tool',
      tmp,
      payload({ tool_name: 'Read', tool_input: { file_path: absWin } }),
    );
    expect(second).toBeNull(); // dedup within the session
  });

  it('post-tool Edit re-indexes and warns when the edit made a memory stale', async () => {
    const abs = path.join(tmp, 'src', 'board.ts');
    writeFileSync(abs, readFileSync(abs, 'utf8').replace('return true;', 'return from !== to;'));
    const out = await runHook(
      'post-tool',
      tmp,
      payload({ tool_name: 'Edit', tool_input: { file_path: abs } }),
    );
    expect(out).not.toBeNull();
    const ctx = (JSON.parse(out ?? '') as HookOut).hookSpecificOutput.additionalContext;
    expect(ctx).toContain('DRIFT');
    expect(ctx).toContain('reanchor');
  });

  it('never throws: outside files, unknown payloads, missing workspace → silence', async () => {
    expect(await runHook('post-tool', tmp, payload({ tool_name: 'Bash' }))).toBeNull();
    expect(
      await runHook(
        'post-tool',
        tmp,
        payload({ tool_name: 'Read', tool_input: { file_path: 'C:/elsewhere/x.ts' } }),
      ),
    ).toBeNull();
    expect(await runHook('post-tool', tmp, 'not-json-at-all')).toBeNull();
    const empty = mkdtempSync(path.join(os.tmpdir(), 'haido-empty-'));
    try {
      expect(await runHook('session-start', empty, payload({}))).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
