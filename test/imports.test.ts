import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractImports,
  loadTsPaths,
  resolveImport,
  type RawImport,
} from '../src/indexer/imports.js';
import { parseSource } from '../src/indexer/parser.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

const esm = (module: string): RawImport => ({ kind: 'esm', module, level: 0, names: [] });

describe('import resolution', () => {
  const tsFiles = new Set(['src/index.ts', 'src/board.ts', 'src/utils.ts']);
  const tsPaths = {
    baseUrl: '',
    patterns: [{ prefix: '@app/', suffix: '', hasStar: true, targets: ['src/*'] }],
  };

  it('relative ESM import', () => {
    expect(resolveImport('src/index.ts', esm('./board'), tsFiles, null)).toEqual(['src/board.ts']);
  });

  it('NodeNext .js specifier resolves to .ts source', () => {
    expect(resolveImport('src/index.ts', esm('./board.js'), tsFiles, null)).toEqual([
      'src/board.ts',
    ]);
  });

  it('tsconfig paths alias', () => {
    expect(resolveImport('src/index.ts', esm('@app/utils'), tsFiles, tsPaths)).toEqual([
      'src/utils.ts',
    ]);
  });

  it('external package resolves to nothing', () => {
    expect(resolveImport('src/index.ts', esm('lodash'), tsFiles, tsPaths)).toEqual([]);
  });

  const pyFiles = new Set(['main.py', 'game.py', 'helpers.py', 'pkg/__init__.py', 'pkg/mod.py']);

  it('python absolute import', () => {
    expect(
      resolveImport('main.py', { kind: 'py', module: 'game', level: 0, names: [] }, pyFiles, null),
    ).toEqual(['game.py']);
  });

  it('python package import', () => {
    expect(
      resolveImport('main.py', { kind: 'py', module: 'pkg', level: 0, names: [] }, pyFiles, null),
    ).toEqual(['pkg/__init__.py']);
    expect(
      resolveImport(
        'main.py',
        { kind: 'py', module: 'pkg.mod', level: 0, names: [] },
        pyFiles,
        null,
      ),
    ).toEqual(['pkg/mod.py']);
  });

  it('python relative from-import: from . import helpers', () => {
    expect(
      resolveImport(
        'main.py',
        { kind: 'py', module: '', level: 1, names: ['helpers'] },
        pyFiles,
        null,
      ),
    ).toEqual(['helpers.py']);
  });

  it('loadTsPaths reads the fixture tsconfig', () => {
    const cfg = loadTsPaths(path.join(FIXTURES, 'ts-mini'));
    expect(cfg).not.toBeNull();
    expect(cfg?.patterns[0]?.prefix).toBe('@app/');
    expect(cfg?.patterns[0]?.targets).toEqual(['src/*']);
  });

  it('extractImports finds ESM and python imports', async () => {
    const tsSource = readFileSync(path.join(FIXTURES, 'ts-mini', 'src', 'index.ts'), 'utf8');
    const tsTree = await parseSource('ts', tsSource);
    expect(extractImports(tsTree, 'ts').map((r) => r.module)).toEqual(['./board', '@app/utils']);
    tsTree.delete();

    const pySource = readFileSync(path.join(FIXTURES, 'py-mini', 'main.py'), 'utf8');
    const pyTree = await parseSource('py', pySource);
    const raws = extractImports(pyTree, 'py');
    pyTree.delete();
    expect(raws).toEqual([
      { kind: 'py', module: 'game', level: 0, names: [] },
      { kind: 'py', module: 'helpers', level: 0, names: ['clamp'] },
    ]);
  });
});
