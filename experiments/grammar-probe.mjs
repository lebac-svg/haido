// Diagnose grammar wasm <-> web-tree-sitter compatibility (Sprint 1).
import { readFileSync } from 'node:fs';
import { Language, Parser } from 'web-tree-sitter';

const target = process.argv[2] ?? 'node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm';
const bytes = readFileSync(target);
console.log('file:', target, bytes.length, 'bytes; magic:', bytes.subarray(0, 8).toString('hex'));

await Parser.init();
try {
  const lang = await Language.load(target);
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse('def f():\n    return 1\n');
  console.log('LOAD OK — root:', tree?.rootNode.type, '| abi:', lang.abiVersion ?? lang.version);
} catch (e) {
  console.error('LOAD FAILED:', e instanceof Error ? e.message : e);
}
