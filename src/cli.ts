#!/usr/bin/env node
import { Command } from 'commander';
import {
  cmdDoctor,
  cmdIndex,
  cmdInit,
  cmdOverview,
  cmdReanchor,
  cmdRecall,
  cmdRelated,
  cmdRemember,
  cmdStale,
  requireDb,
} from './cli/commands.js';
import { formatIndexSummary, formatStale } from './cli/format.js';
import { watchRepo } from './indexer/watch.js';
import { runHook, type HookKind } from './integrations/claude-code/hook.js';
import {
  installClaudeCode,
  installClaudeDesktop,
  type InstallResult,
} from './integrations/claude-code/install.js';
import { MEMORY_TYPES, type MemoryType } from './memory/store.js';
import { serveStdio } from './mcp/server.js';
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
    console.log("next: 'haido install claude-code' to wire hooks + MCP into Claude Code");
  });

program
  .command('index')
  .description('re-index changed files and reconcile memory anchors')
  .option('--watch', 're-index on every save (debounced)')
  .action(async (opts: Record<string, unknown>) => {
    console.log(formatIndexSummary(await cmdIndex(root())));
    if (!opts['watch']) return;
    const db = requireDb(root());
    console.log('watching for changes… (ctrl+c to stop)');
    watchRepo({
      root: root(),
      db,
      onCycle: (c) => {
        console.log(
          formatIndexSummary({
            filesSeen: c.index.filesSeen,
            filesIndexed: c.index.filesIndexed,
            filesDeleted: c.index.filesDeleted,
            symbolsChanged: c.index.diffs.length,
            staleness: c.staleness,
          }),
        );
      },
      onError: (e) => console.error('watch error:', e instanceof Error ? e.message : e),
    });
  });

program
  .command('serve')
  .description('run the MCP stdio server (plug into Claude Code / Claude Desktop)')
  .option('--root <path>', 'project root (Claude Desktop launches outside the repo)')
  .action(async (opts: Record<string, unknown>) => {
    await serveStdio((opts['root'] as string | undefined) ?? root());
  });

program
  .command('install <target>')
  .description('wire haido into an agent: claude-code (hooks + MCP) | claude-desktop (MCP)')
  .option('--global', 'claude-code: write hooks to user-level ~/.claude/settings.json')
  .option(
    '--command <parts...>',
    'launcher override for dev builds, e.g. --command node C:\\haido\\dist\\cli.js',
  )
  .action((target: string, opts: Record<string, unknown>) => {
    const command = opts['command'] as string[] | undefined;
    let result: InstallResult;
    if (target === 'claude-code') {
      result = installClaudeCode({
        root: root(),
        ...(command ? { command } : {}),
        globalSettings: Boolean(opts['global']),
      });
    } else if (target === 'claude-desktop') {
      result = installClaudeDesktop({ root: root(), ...(command ? { command } : {}) });
    } else {
      throw new Error(`unknown target '${target}' — use claude-code | claude-desktop`);
    }
    for (const w of result.wrote) console.log(`wrote ${w} (backup: ${w}.bak-haido if it existed)`);
    for (const n of result.notes) console.log(`note: ${n}`);
  });

program
  .command('hook <kind>')
  .description('(internal) Claude Code hook runner: session-start | post-tool')
  .action(async (kind: string) => {
    if (kind !== 'session-start' && kind !== 'post-tool') {
      console.error(`haido hook: unknown kind '${kind}'`);
      return; // exit 0 — a hook must never break the agent
    }
    const output = await runHook(kind as HookKind, root(), await readStdin());
    if (output) process.stdout.write(output);
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
  .description('ranked memories for a file/symbol/query (token-budgeted)')
  .option('--file <path>', 'repo-relative file path')
  .option('--symbol <qname>', 'symbol qname (path#Name)')
  .option('--budget <tokens>', 'token budget', '800')
  .action((query: string | undefined, opts: Record<string, unknown>) => {
    const result = cmdRecall(root(), {
      ...(query !== undefined ? { query } : {}),
      ...(opts['file'] !== undefined ? { file: opts['file'] as string } : {}),
      ...(opts['symbol'] !== undefined ? { symbol: opts['symbol'] as string } : {}),
      budget: Number(opts['budget']),
    });
    console.log(result.text);
  });

program
  .command('related <target>')
  .description('files most related to a file/symbol (imports, co-change, same dir)')
  .option('--limit <n>', 'max results', '8')
  .action((target: string, opts: Record<string, unknown>) => {
    console.log(cmdRelated(root(), target, Number(opts['limit'])));
  });

program
  .command('overview')
  .description('project map + standing invariants (what a fresh session should read)')
  .option('--budget <tokens>', 'token budget', '1500')
  .action((opts: Record<string, unknown>) => {
    console.log(cmdOverview(root(), Number(opts['budget'])));
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

async function readStdin(timeoutMs = 3000): Promise<string> {
  if (process.stdin.isTTY) return '';
  return await new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

program.parseAsync().catch((err: unknown) => {
  console.error(`haido: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
