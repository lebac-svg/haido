import chokidar from 'chokidar';
import path from 'node:path';
import type { Db } from '../core/db.js';
import type { IndexResult } from '../core/types.js';
import { reconcileAnchors, type StalenessReport } from '../memory/staleness.js';
import { indexRepo } from './indexer.js';

/** Directories the watcher never looks into (mirrors the indexer's scan rules). */
const IGNORED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.haido',
  'dist',
  'build',
  'out',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
]);

export interface WatchCycle {
  index: IndexResult;
  staleness: StalenessReport;
}

export interface WatchHandle {
  close(): Promise<void>;
}

/** F10: debounce file events, re-index incrementally, reconcile anchors, report. */
export function watchRepo(opts: {
  root: string;
  db: Db;
  debounceMs?: number;
  onCycle: (cycle: WatchCycle) => void;
  onError?: (e: unknown) => void;
}): WatchHandle {
  const debounceMs = opts.debounceMs ?? 300;

  const watcher = chokidar.watch(opts.root, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    ignored: (p: string) => {
      const rel = path.relative(opts.root, p);
      if (rel === '') return false;
      return rel
        .split(path.sep)
        .some((seg) => IGNORED_SEGMENTS.has(seg) || (seg.startsWith('.') && seg !== '.'));
    },
  });

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let rerun = false;

  const cycle = async (): Promise<void> => {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      const index = await indexRepo({ root: opts.root, db: opts.db });
      const staleness = reconcileAnchors(opts.db);
      if (index.filesIndexed > 0 || index.filesDeleted > 0 || staleness.events.length > 0) {
        opts.onCycle({ index, staleness });
      }
    } catch (e) {
      opts.onError?.(e);
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        void cycle();
      }
    }
  };

  const kick = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void cycle(), debounceMs);
  };

  watcher.on('add', kick).on('change', kick).on('unlink', kick);

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}
