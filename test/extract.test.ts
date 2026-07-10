import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractSymbols } from '../src/indexer/extract.js';
import { parseSource, type LangId } from '../src/indexer/parser.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

async function symbolsOf(lang: LangId, fixtureFile: string, relPath: string) {
  const source = readFileSync(path.join(FIXTURES, fixtureFile), 'utf8');
  const tree = await parseSource(lang, source);
  const symbols = extractSymbols(tree, lang, relPath);
  tree.delete();
  return symbols;
}

describe('symbol extraction (golden fixtures)', () => {
  it('TS class with methods', async () => {
    const symbols = await symbolsOf('ts', 'ts-mini/src/board.ts', 'src/board.ts');
    expect(symbols.map((s) => [s.qname, s.kind])).toEqual([
      ['src/board.ts#Board', 'class'],
      ['src/board.ts#Board.move', 'method'],
      ['src/board.ts#Board.undo', 'method'],
    ]);
    const move = symbols.find((s) => s.name === 'move');
    expect(move?.startLine).toBeGreaterThan(1);
    expect(move?.endLine).toBeGreaterThan(move?.startLine ?? 0);
    expect(move?.signature).toContain('move(from: number, to: number)');
  });

  it('TS functions, exported const, arrow const, type alias', async () => {
    const symbols = await symbolsOf('ts', 'ts-mini/src/utils.ts', 'src/utils.ts');
    expect(new Map(symbols.map((s) => [s.qname, s.kind]))).toEqual(
      new Map([
        ['src/utils.ts#clamp', 'function'],
        ['src/utils.ts#lerp', 'function'],
        ['src/utils.ts#CONFIG', 'const'],
        ['src/utils.ts#helper', 'function'],
        ['src/utils.ts#Cell', 'type'],
      ]),
    );
  });

  it('Python classes, methods, module functions', async () => {
    const symbols = await symbolsOf('py', 'py-mini/game.py', 'game.py');
    expect(new Map(symbols.map((s) => [s.qname, s.kind]))).toEqual(
      new Map([
        ['game.py#Game', 'class'],
        ['game.py#Game.__init__', 'method'],
        ['game.py#Game.move', 'method'],
        ['game.py#new_game', 'function'],
      ]),
    );
  });

  it('extraction is deterministic (same hashes on re-parse)', async () => {
    const first = await symbolsOf('ts', 'ts-mini/src/board.ts', 'src/board.ts');
    const second = await symbolsOf('ts', 'ts-mini/src/board.ts', 'src/board.ts');
    expect(first.map((s) => s.bodyHash)).toEqual(second.map((s) => s.bodyHash));
  });
});
