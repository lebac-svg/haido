import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  globToRegExp,
  loadConfig,
  makePathFilter,
  parseTomlSubset,
} from '../src/core/config.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-config-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('parseTomlSubset', () => {
  it('parses sections, strings, numbers, booleans, arrays, comments', () => {
    const t = parseTomlSubset(
      [
        '# comment',
        '[index]',
        'exclude = ["ds-bundle/**", "gen/**"]',
        'max_file_kb = 500',
        '',
        '[cochange]',
        'min_confidence = 0.5',
        'flag = true',
      ].join('\n'),
    );
    expect(t['index']?.['exclude']).toEqual(['ds-bundle/**', 'gen/**']);
    expect(t['index']?.['max_file_kb']).toBe(500);
    expect(t['cochange']?.['min_confidence']).toBe(0.5);
    expect(t['cochange']?.['flag']).toBe(true);
  });

  it('throws on lines it cannot parse', () => {
    expect(() => parseTomlSubset('what is this')).toThrow(/cannot parse/);
  });
});

describe('globToRegExp', () => {
  it('** spans slashes, * stays in a segment', () => {
    expect(globToRegExp('ds-bundle/**').test('ds-bundle/a/b.ts')).toBe(true);
    expect(globToRegExp('ds-bundle/**').test('src/a.ts')).toBe(false);
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/deep/a.ts')).toBe(false);
    expect(globToRegExp('**/*.test.ts').test('test/deep/x.test.ts')).toBe(true);
  });
});

describe('loadConfig', () => {
  it('falls back to defaults without a file', () => {
    const r = loadConfig(tmp);
    expect(r.source).toBe('defaults');
    expect(r.config).toEqual(DEFAULT_CONFIG);
  });

  it('merges a partial file over defaults', () => {
    writeFileSync(
      path.join(tmp, 'haido.toml'),
      '[index]\nexclude = ["gen/**"]\n\n[recall]\nbudget_tokens = 500\n',
    );
    const r = loadConfig(tmp);
    expect(r.source).toBe('file');
    expect(r.config.index.exclude).toEqual(['gen/**']);
    expect(r.config.index.maxFileKb).toBe(DEFAULT_CONFIG.index.maxFileKb);
    expect(r.config.recall.budgetTokens).toBe(500);
    expect(r.config.cochange).toEqual(DEFAULT_CONFIG.cochange);
  });

  it('a broken file falls back to defaults and reports the error (hooks stay safe)', () => {
    writeFileSync(path.join(tmp, 'haido.toml'), 'index]\ngarbage');
    const r = loadConfig(tmp);
    expect(r.source).toBe('defaults');
    expect(r.error).toBeTruthy();
    expect(r.config).toEqual(DEFAULT_CONFIG);
  });
});

describe('makePathFilter', () => {
  it('exclude wins; include-mode restricts; pruneDir only when subtree fully excluded', () => {
    const f = makePathFilter({
      ...DEFAULT_CONFIG,
      index: { ...DEFAULT_CONFIG.index, exclude: ['gen/**'], include: [] },
    });
    expect(f.file('src/a.ts')).toBe(true);
    expect(f.file('gen/a.ts')).toBe(false);
    expect(f.pruneDir('gen')).toBe(true);
    expect(f.pruneDir('src')).toBe(false);

    const only = makePathFilter({
      ...DEFAULT_CONFIG,
      index: { ...DEFAULT_CONFIG.index, include: ['src/**'], exclude: [] },
    });
    expect(only.file('src/a.ts')).toBe(true);
    expect(only.file('docs/a.md')).toBe(false);
    expect(only.pruneDir('docs')).toBe(false); // include-mode never prunes
  });
});
