#!/usr/bin/env node
import { Command } from 'commander';
import {
  cmdDoctor,
  cmdIndex,
  cmdInit,
  cmdReanchor,
  cmdRecall,
  cmdRemember,
  cmdStale,
} from './cli/commands.js';
import { formatIndexSummary, formatRecall, formatStale } from './cli/format.js';
import { MEMORY_TYPES, type MemoryType } from './memory/store.js';
import { VERSION } from './version.js';

const program = new Command();
program
  .name('haido')
  .description("Hải Đồ — a captain's log for AI coding agents: memories anchored to code")
  .version(VERSION);

const root = (): string => process.cwd();

program
  .command('init')
  .description('create .haido/ and index this repository')
  .action(async () => {
    const summary = await cmdInit(root());
    console.log(formatIndexSummary(summary));
    console.log("tip: add '.haido/' to your .gitignore — knowledge travels via the memory pack");
  });

program
  .command('index')
  .description('re-index changed files and reconcile memory anchors')
  .action(async () => {
    console.log(formatIndexSummary(await cmdIndex(root())));
  });

program
  .command('remember')
  .description('record a decision/invariant/gotcha/convention/todo anchored to code')
  .requiredOption('--type <type>', `one of: ${MEMORY_TYPES.join(', ')}`)
  .requiredOption('--title <title>', 'short title (<= 100 chars)')
  .requiredOption('--body <body>', 'one fact (<= 700 chars)')
  .requiredOption('--why <why>', 'the reason this is worth remembering')
  .requiredOption(
    '--anchor <target...>',
    'sym:<qname> or file:<path> (repeatable; bare values auto-detect by #)',
  )
  .option('--author <author>', 'defaults to human:<os user>')
  .action((opts: Record<string, unknown>) => {
    const result = cmdRemember(root(), {
      type: opts['type'] as MemoryType,
      title: opts['title'] as string,
      body: opts['body'] as string,
      why: opts['why'] as string,
      anchors: opts['anchor'] as string[],
      author: opts['author'] as string | undefined,
    });
    console.log(`remembered as ${result.id}`);
    if (result.duplicates.length > 0) {
      console.warn(
        `possible duplicates — consider updating instead:\n${result.duplicates
          .map((d) => `  ${d.id} (${d.type}) ${d.title}`)
          .join('\n')}`,
      );
    }
  });

program
  .command('recall [query]')
  .description('list memories for a file/symbol/query')
  .option('--file <path>', 'repo-relative file path')
  .option('--symbol <qname>', 'symbol qname (path#Name)')
  .option('--limit <n>', 'max results', '10')
  .action((query: string | undefined, opts: Record<string, unknown>) => {
    const hits = cmdRecall(root(), {
      query,
      file: opts['file'] as string | undefined,
      symbol: opts['symbol'] as string | undefined,
      limit: Number(opts['limit']),
    });
    console.log(formatRecall(hits));
  });

program
  .command('stale')
  .description('review queue: memories whose anchored code has changed')
  .action(() => {
    console.log(formatStale(cmdStale(root())));
  });

program
  .command('reanchor <memoryId>')
  .description('resolve a stale memory: confirm, move an anchor, or retire')
  .option('--confirm', 'the note still holds — snapshot the new code hashes')
  .option('--retire', 'the note no longer holds')
  .option('--move <anchorId>', 'move one anchor', (v) => Number(v))
  .option('--to <target>', 'sym:<qname> or file:<path> (with --move)')
  .action((memoryId: string, opts: Record<string, unknown>) => {
    console.log(
      cmdReanchor(root(), memoryId, {
        confirm: opts['confirm'] as boolean | undefined,
        retire: opts['retire'] as boolean | undefined,
        move: opts['move'] as number | undefined,
        to: opts['to'] as string | undefined,
      }),
    );
  });

program
  .command('doctor')
  .description('diagnose the workspace')
  .action(() => {
    const r = cmdDoctor(root());
    console.log(`node: ${r.node}`);
    console.log(`git:  ${r.git ?? 'NOT FOUND (co-change mining will be disabled)'}`);
    console.log(
      `workspace: ${r.workspace ? 'ok (.haido/haido.db)' : "missing — run 'haido init'"}`,
    );
    if (r.counts) {
      console.log(
        `index: ${String(r.counts.files)} files, ${String(r.counts.symbols)} symbols · memories: ${String(r.counts.memories)} (${String(r.counts.needsReview)} need review)`,
      );
    }
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`haido: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
