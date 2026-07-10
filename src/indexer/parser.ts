import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Language, Parser } from 'web-tree-sitter';

export type LangId = 'ts' | 'tsx' | 'js' | 'py';

export const EXT_TO_LANG: Record<string, LangId> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.jsx': 'tsx', // the tsx grammar parses jsx fine
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.py': 'py',
};

const WASM_FILE: Record<LangId, string> = {
  ts: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  js: 'tree-sitter-javascript.wasm',
  py: 'tree-sitter-python.wasm',
};

const require = createRequire(import.meta.url);
let initPromise: Promise<void> | null = null;
const parsers = new Map<LangId, Parser>();

/**
 * Locate the grammar directory shipped by `@vscode/tree-sitter-wasm`.
 * (The older `tree-sitter-wasms` package ships ABI-incompatible builds — see
 * experiments/grammar-probe.mjs and docs/memory/m-boot-008.)
 */
function wasmDir(): string {
  const candidates: Array<() => string> = [
    () => path.join(path.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')), 'wasm'),
    () => path.join(process.cwd(), 'node_modules', '@vscode', 'tree-sitter-wasm', 'wasm'),
  ];
  for (const candidate of candidates) {
    try {
      const dir = candidate();
      if (existsSync(dir)) return dir;
    } catch {
      // try next candidate
    }
  }
  throw new Error('@vscode/tree-sitter-wasm package not found (grammar .wasm files missing)');
}

export async function getParser(lang: LangId): Promise<Parser> {
  initPromise ??= Parser.init();
  await initPromise;
  let parser = parsers.get(lang);
  if (!parser) {
    const language = await Language.load(path.join(wasmDir(), WASM_FILE[lang]));
    parser = new Parser();
    parser.setLanguage(language);
    parsers.set(lang, parser);
  }
  return parser;
}

export async function parseSource(lang: LangId, source: string) {
  const parser = await getParser(lang);
  const tree = parser.parse(source);
  if (!tree) throw new Error(`tree-sitter failed to parse (${lang})`);
  return tree;
}
