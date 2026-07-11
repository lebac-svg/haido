import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Lang } from './lang.js';

/**
 * haido.toml — committable per-repo config (ARCHITECTURE §9). Parsed by a
 * restricted self-contained TOML subset (sections, strings, numbers, booleans,
 * single-line string arrays, full-line # comments) — no dependency, same
 * philosophy as the pack frontmatter. Unknown keys are ignored; a broken file
 * silently falls back to defaults (hooks must never break the agent) — `haido
 * doctor` surfaces the parse error.
 */
export interface HaidoConfig {
  index: {
    /** If non-empty, ONLY paths matching one of these globs are indexed. */
    include: string[];
    /** Always excluded (added on top of built-in dir skips). */
    exclude: string[];
    maxFileKb: number;
    /** Purge soft-deleted index rows older than this many days (0 = keep forever). */
    purgeDeletedDays: number;
  };
  cochange: {
    maxCommits: number;
    maxFilesPerCommit: number;
    minTogether: number;
    minConfidence: number;
  };
  recall: {
    budgetTokens: number;
    overviewBudgetTokens: number;
  };
  ui: {
    /** Output language for recall/overview/stale/hook strings ('en' | 'vi'). */
    lang: Lang;
  };
}

export const DEFAULT_CONFIG: HaidoConfig = {
  index: { include: [], exclude: [], maxFileKb: 1500, purgeDeletedDays: 30 },
  cochange: { maxCommits: 2000, maxFilesPerCommit: 30, minTogether: 3, minConfidence: 0.3 },
  recall: { budgetTokens: 800, overviewBudgetTokens: 1500 },
  ui: { lang: 'en' },
};

export function configPath(root: string): string {
  return path.join(root, 'haido.toml');
}

export interface LoadedConfig {
  config: HaidoConfig;
  source: 'file' | 'defaults';
  error?: string;
}

export function loadConfig(root: string): LoadedConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath(root), 'utf8');
  } catch {
    return { config: DEFAULT_CONFIG, source: 'defaults' };
  }
  try {
    const t = parseTomlSubset(raw);
    const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
    const strs = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const index = (t['index'] ?? {}) as Record<string, unknown>;
    const cochange = (t['cochange'] ?? {}) as Record<string, unknown>;
    const recall = (t['recall'] ?? {}) as Record<string, unknown>;
    return {
      source: 'file',
      config: {
        index: {
          include: strs(index['include']),
          exclude: strs(index['exclude']),
          maxFileKb: num(index['max_file_kb'], DEFAULT_CONFIG.index.maxFileKb),
          purgeDeletedDays: num(index['purge_deleted_days'], DEFAULT_CONFIG.index.purgeDeletedDays),
        },
        cochange: {
          maxCommits: num(cochange['max_commits'], DEFAULT_CONFIG.cochange.maxCommits),
          maxFilesPerCommit: num(
            cochange['max_files_per_commit'],
            DEFAULT_CONFIG.cochange.maxFilesPerCommit,
          ),
          minTogether: num(cochange['min_together'], DEFAULT_CONFIG.cochange.minTogether),
          minConfidence: num(cochange['min_confidence'], DEFAULT_CONFIG.cochange.minConfidence),
        },
        recall: {
          budgetTokens: num(recall['budget_tokens'], DEFAULT_CONFIG.recall.budgetTokens),
          overviewBudgetTokens: num(
            recall['overview_budget_tokens'],
            DEFAULT_CONFIG.recall.overviewBudgetTokens,
          ),
        },
        ui: {
          lang: ((t['ui'] as Record<string, unknown> | undefined)?.['lang'] === 'vi'
            ? 'vi'
            : 'en') as Lang,
        },
      },
    };
  } catch (e) {
    return {
      config: DEFAULT_CONFIG,
      source: 'defaults',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Restricted TOML: [section], key = "str" | 123 | true | ["a", "b"]. Full-line # comments. */
export function parseTomlSubset(raw: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  let section = '_root';
  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const sec = /^\[([\w.-]+)\]$/.exec(line);
    if (sec?.[1]) {
      section = sec[1];
      continue;
    }
    const kv = /^([\w-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv?.[1] || kv[2] === undefined) throw new Error(`haido.toml: cannot parse line '${line}'`);
    (out[section] ??= {})[kv[1]] = parseValue(kv[2].trim());
  }
  return out;
}

function parseValue(v: string): unknown {
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new Error(`array must be single-line: ${v}`);
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((part) => parseValue(part.trim()));
  }
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  throw new Error(`unsupported value: ${v}`);
}

/** Minimal glob: '**' spans slashes, '*' within a segment, '?' one char. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // 'dir/**/x' — '**/' also matches zero segments
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    }
  }
  return new RegExp(`^${re}$`);
}

export interface PathFilter {
  /** Should this repo-relative POSIX file path be indexed? */
  file(rel: string): boolean;
  /** May this directory be pruned from the walk entirely? */
  pruneDir(relDir: string): boolean;
}

export function makePathFilter(config: HaidoConfig): PathFilter {
  const includes = config.index.include.map(globToRegExp);
  const excludes = config.index.exclude.map(globToRegExp);
  return {
    file(rel: string): boolean {
      if (excludes.some((r) => r.test(rel))) return false;
      if (includes.length > 0 && !includes.some((r) => r.test(rel))) return false;
      return true;
    },
    pruneDir(relDir: string): boolean {
      // safe to prune only when an exclude covers the whole subtree and
      // include-mode is off (an include could still match deeper files)
      if (includes.length > 0) return false;
      return excludes.some((r) => r.test(`${relDir}/`) && r.test(`${relDir}/x`));
    },
  };
}

/** Starter file written by `haido init` when no haido.toml exists. */
export const STARTER_TOML = `# haido.toml — cấu hình cho repo này (commit được, đi theo dự án)
# Bỏ dấu # để kích hoạt. Mọi giá trị vắng mặt dùng mặc định.

[index]
# exclude = ["ds-bundle/**", "generated/**"]   # loại thêm ngoài các thư mục mặc định
# include = ["src/**", "docs/**"]              # nếu đặt: CHỈ index các glob này
# max_file_kb = 1500
# purge_deleted_days = 30

[cochange]
# max_commits = 2000
# max_files_per_commit = 30
# min_together = 3
# min_confidence = 0.3

[recall]
# budget_tokens = 800            # ngân sách token mỗi lần hook tiêm theo file
# overview_budget_tokens = 1500  # ngân sách cho bản đồ đầu phiên

[ui]
# lang = "en"                    # ngôn ngữ output của haido: "en" (mặc định) | "vi"
`;
