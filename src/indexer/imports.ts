import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Tree } from 'web-tree-sitter';
import { posixDirname, posixJoin } from '../core/paths.js';
import type { LangId } from './parser.js';

export interface RawImport {
  kind: 'esm' | 'py';
  module: string; // './board', '@app/utils', 'game', 'helpers'
  level: number; // python relative-import dots (0 for absolute / ESM)
  names: string[]; // python `from m import a, b`
}

export interface TsPathsConfig {
  baseUrl: string;
  patterns: Array<{ prefix: string; suffix: string; hasStar: boolean; targets: string[] }>;
}

/** Top-level static imports only (v0.1). */
export function extractImports(tree: Tree, lang: LangId): RawImport[] {
  const out: RawImport[] = [];
  for (const node of tree.rootNode.namedChildren) {
    if (!node) continue;
    if (lang === 'py') {
      if (node.type === 'import_statement') {
        for (const child of node.namedChildren) {
          if (!child) continue;
          const target = child.type === 'aliased_import' ? child.childForFieldName('name') : child;
          if (target?.type === 'dotted_name') {
            out.push({ kind: 'py', module: target.text, level: 0, names: [] });
          }
        }
      } else if (node.type === 'import_from_statement') {
        const moduleNode = node.childForFieldName('module_name');
        if (!moduleNode) continue;
        let level = 0;
        let module: string;
        if (moduleNode.type === 'relative_import') {
          level = (moduleNode.text.match(/^\.+/)?.[0] ?? '').length;
          module = moduleNode.text.replace(/^\.+/, '');
        } else {
          module = moduleNode.text;
        }
        const names: string[] = [];
        for (const child of node.namedChildren) {
          if (!child || child.id === moduleNode.id) continue;
          if (child.type === 'dotted_name') names.push(child.text);
          else if (child.type === 'aliased_import') {
            const name = child.childForFieldName('name');
            if (name) names.push(name.text);
          }
        }
        out.push({ kind: 'py', module, level, names });
      }
      continue;
    }
    // TS / TSX / JS
    if (node.type === 'import_statement' || node.type === 'export_statement') {
      const source = node.childForFieldName('source');
      if (source) {
        const spec = source.text.slice(1, -1); // strip quotes
        if (spec.length > 0) out.push({ kind: 'esm', module: spec, level: 0, names: [] });
      }
    }
  }
  return out;
}

/** Resolve a raw import to repo-relative POSIX file paths that actually exist. */
export function resolveImport(
  fromRel: string,
  raw: RawImport,
  fileSet: ReadonlySet<string>,
  tsPaths: TsPathsConfig | null,
): string[] {
  if (raw.kind === 'py') return resolvePy(fromRel, raw, fileSet);

  const bases: string[] = [];
  if (raw.module.startsWith('.')) {
    bases.push(posixJoin(posixDirname(fromRel), raw.module));
  } else if (tsPaths) {
    for (const p of tsPaths.patterns) {
      if (p.hasStar) {
        if (raw.module.startsWith(p.prefix) && raw.module.endsWith(p.suffix)) {
          const middle = raw.module.slice(p.prefix.length, raw.module.length - p.suffix.length);
          for (const t of p.targets) bases.push(posixJoin(tsPaths.baseUrl, t.replace('*', middle)));
        }
      } else if (raw.module === p.prefix) {
        for (const t of p.targets) bases.push(posixJoin(tsPaths.baseUrl, t));
      }
    }
  }

  for (const base of bases) {
    const candidates: string[] = [];
    // NodeNext style: './board.js' on disk is board.ts
    const swapped = base.replace(/\.(m?js|jsx)$/, '');
    if (swapped !== base) candidates.push(`${swapped}.ts`, `${swapped}.tsx`, base);
    candidates.push(
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.mjs`,
      `${base}.jsx`,
      `${base}.cjs`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
      `${base}/index.js`,
    );
    for (const c of candidates) if (fileSet.has(c)) return [c];
  }
  return [];
}

function resolvePy(fromRel: string, raw: RawImport, fileSet: ReadonlySet<string>): string[] {
  let root = '';
  if (raw.level > 0) {
    root = posixDirname(fromRel);
    for (let i = 1; i < raw.level; i++) root = posixDirname(root);
  }
  const parts = raw.module.split('.').filter((p) => p.length > 0);
  const moduleBase = posixJoin(root, ...parts);
  const found = new Set<string>();
  const probe = (base: string): void => {
    if (base === '') return;
    if (fileSet.has(`${base}.py`)) found.add(`${base}.py`);
    else if (fileSet.has(`${base}/__init__.py`)) found.add(`${base}/__init__.py`);
  };
  probe(moduleBase);
  for (const name of raw.names) probe(posixJoin(moduleBase, ...name.split('.')));
  return [...found];
}

/** Minimal tsconfig `paths` support (comments and trailing commas tolerated). */
export function loadTsPaths(rootDir: string): TsPathsConfig | null {
  let text: string;
  try {
    text = readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    const cleaned = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    const parsed = JSON.parse(cleaned) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    const paths = parsed.compilerOptions?.paths;
    if (!paths) return null;
    const baseUrl = (parsed.compilerOptions?.baseUrl ?? '.').replaceAll('\\', '/');
    const patterns = Object.entries(paths).map(([key, targets]) => {
      const star = key.indexOf('*');
      return {
        prefix: star === -1 ? key : key.slice(0, star),
        suffix: star === -1 ? '' : key.slice(star + 1),
        hasStar: star !== -1,
        targets,
      };
    });
    return { baseUrl: baseUrl === '.' ? '' : baseUrl, patterns };
  } catch {
    return null;
  }
}
