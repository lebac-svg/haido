import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openDb, type Db } from '../src/core/db.js';
import { indexRepo } from '../src/indexer/indexer.js';
import { reconcileAnchors } from '../src/memory/staleness.js';
import { buildServer } from '../src/mcp/server.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let tmp: string;
let db: Db;
let client: Client;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-mcp-'));
  cpSync(path.join(FIXTURES, 'ts-mini'), tmp, { recursive: true });
  db = openDb(':memory:');
  await indexRepo({ root: tmp, db });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer({ db }).connect(serverTransport);
  client = new Client({ name: 'haido-test', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

interface TextResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<TextResult> {
  return (await client.callTool({ name, arguments: args })) as unknown as TextResult;
}

describe('MCP contract', () => {
  it('exposes exactly the six SPEC §7 tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'find_related',
      'map_overview',
      'reanchor',
      'recall',
      'remember',
      'stale_memories',
    ]);
  });

  it('remember → recall roundtrip', async () => {
    const r = await call('remember', {
      type: 'invariant',
      title: 'Toạ độ 0-based',
      body: 'Board dùng (col,row) 0-based.',
      why: 'đã sập bug lệch-1 hai lần',
      anchors: ['sym:src/board.ts#Board.move'],
    });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('remembered as');

    const recall = await call('recall', { file: 'src/board.ts' });
    expect(recall.content[0]?.text).toContain('Toạ độ 0-based');
    expect(recall.content[0]?.text).toContain('INVARIANT');
  });

  it('map_overview and find_related answer', async () => {
    const overview = await call('map_overview', {});
    expect(overview.content[0]?.text).toContain('src/');

    const related = await call('find_related', { file: 'src/index.ts' });
    expect(related.content[0]?.text).toContain('src/board.ts');
  });

  it('stale_memories shows drift and reanchor confirm clears it', async () => {
    const r = await call('remember', {
      type: 'decision',
      title: 'Move trả bool',
      body: 'Board.move trả boolean, không throw.',
      why: 'caller cần phân biệt nước đi hợp lệ',
      anchors: ['sym:src/board.ts#Board.move'],
    });
    const id = /m_[a-z0-9]+/.exec(r.content[0]?.text ?? '')?.[0];
    expect(id).toBeDefined();

    const p = path.join(tmp, 'src', 'board.ts');
    writeFileSync(p, readFileSync(p, 'utf8').replace('return true;', 'return from !== to;'));
    await indexRepo({ root: tmp, db });
    reconcileAnchors(db);

    const stale = await call('stale_memories');
    expect(stale.content[0]?.text).toContain(id);
    expect(stale.content[0]?.text).toContain('drift');

    const fixed = await call('reanchor', { memory_id: id, action: 'confirm' });
    expect(fixed.content[0]?.text).toContain('confirmed');

    const after = await call('stale_memories');
    expect(after.content[0]?.text).toContain('review queue is empty');
  });

  it('errors are returned as isError text, not crashes', async () => {
    const r = await call('reanchor', { memory_id: 'm_nope', action: 'retire' });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('not found');
  });
});
