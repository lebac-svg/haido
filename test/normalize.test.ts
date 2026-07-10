import { describe, expect, it } from 'vitest';
import { hashNode, normalizedText } from '../src/indexer/normalize.js';
import { parseSource, type LangId } from '../src/indexer/parser.js';

async function hashOf(lang: LangId, source: string): Promise<string> {
  const tree = await parseSource(lang, source);
  const hash = hashNode(tree.rootNode);
  tree.delete();
  return hash;
}

// The heart of haido (docs/memory/m-boot-003): formatting/comment edits must NOT
// change the fingerprint; any token change MUST.
describe('normalize + hash (golden invariance)', () => {
  it('TS: whitespace and comments do not change the hash', async () => {
    const a = await hashOf(
      'ts',
      'function add(a: number, b: number) {\n  // sum\n  return a + b;\n}\n',
    );
    const b = await hashOf(
      'ts',
      'function add(a: number,b: number)\n{\n      /* another comment */\n  return a + b;   }',
    );
    expect(a).toBe(b);
  });

  it('TS: a real token change changes the hash', async () => {
    const a = await hashOf('ts', 'function add(a: number, b: number) { return a + b; }');
    const c = await hashOf('ts', 'function add(a: number, b: number) { return a - b; }');
    expect(a).not.toBe(c);
  });

  it('TS: renaming an identifier changes the hash', async () => {
    const a = await hashOf('ts', 'function add(a: number, b: number) { return a + b; }');
    const d = await hashOf('ts', 'function add(x: number, b: number) { return x + b; }');
    expect(a).not.toBe(d);
  });

  it('TS: token boundaries are preserved (ab vs a b)', async () => {
    const a = await hashOf('ts', 'const x = ab;');
    const b = await hashOf('ts', 'const x = a  b;'); // parse differs, tokens differ
    expect(a).not.toBe(b);
  });

  it('Python: comments and spacing do not change the hash', async () => {
    const a = await hashOf('py', 'def add(a, b):\n    # sum\n    return a + b\n');
    const b = await hashOf('py', 'def add(a,   b):\n    return a + b  # trailing note\n');
    expect(a).toBe(b);
  });

  it('Python: body change changes the hash', async () => {
    const a = await hashOf('py', 'def add(a, b):\n    return a + b\n');
    const c = await hashOf('py', 'def add(a, b):\n    return a - b\n');
    expect(a).not.toBe(c);
  });

  it('normalized text drops comments entirely', async () => {
    const tree = await parseSource('ts', '// top\nconst x = 1; /* mid */ const y = 2;');
    const text = normalizedText(tree.rootNode);
    tree.delete();
    expect(text).not.toContain('top');
    expect(text).not.toContain('mid');
    expect(text).toContain('x');
    expect(text).toContain('y');
  });
});
