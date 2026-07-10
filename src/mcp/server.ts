import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openDb, type Db } from '../core/db.js';
import { dbPath, workspaceExists } from '../core/workspace.js';
import { indexRepo } from '../indexer/indexer.js';
import { confirmMemory, moveAnchor, retireMemory } from '../memory/reanchor.js';
import { reconcileAnchors } from '../memory/staleness.js';
import {
  listNeedsReview,
  parseAnchorSpec,
  remember,
  MEMORY_TYPES,
  type MemoryType,
} from '../memory/store.js';
import { mapOverview } from '../recall/overview.js';
import { recall } from '../recall/rank.js';
import { findRelated } from '../recall/related.js';
import { formatStale } from '../cli/format.js';
import { VERSION } from '../version.js';

const text = (t: string): { content: Array<{ type: 'text'; text: string }> } => ({
  content: [{ type: 'text' as const, text: t }],
});
const errText = (
  e: unknown,
): { content: Array<{ type: 'text'; text: string }>; isError: true } => ({
  content: [
    { type: 'text' as const, text: `haido error: ${e instanceof Error ? e.message : String(e)}` },
  ],
  isError: true,
});

/** Build the MCP server around an open DB (exported separately for contract tests). */
export function buildServer(ctx: { db: Db }): McpServer {
  const { db } = ctx;
  const server = new McpServer({ name: 'haido', version: VERSION });

  server.registerTool(
    'recall',
    {
      title: 'Recall project memories',
      description:
        'Call BEFORE editing an important file, or when you need to know WHY code is the way ' +
        'it is. Returns decisions/invariants/gotchas anchored to the given file/symbol ' +
        '(plus its import/co-change neighborhood), ranked and token-budgeted. ' +
        'Entries marked CẦN-REVIEW mean the anchored code changed after the note was written.',
      inputSchema: {
        file: z.string().describe('repo-relative POSIX path, e.g. src/board.ts').optional(),
        symbol: z.string().describe('symbol qname, e.g. src/board.ts#Board.move').optional(),
        query: z.string().describe('free-text search over memories').optional(),
        budget_tokens: z.number().int().min(100).max(4000).optional(),
      },
    },
    (args) => {
      try {
        const r = recall(db, {
          ...(args.file !== undefined ? { file: args.file } : {}),
          ...(args.symbol !== undefined ? { symbol: args.symbol } : {}),
          ...(args.query !== undefined ? { query: args.query } : {}),
          budgetTokens: args.budget_tokens ?? 800,
        });
        return text(r.text);
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    'remember',
    {
      title: 'Record a project memory',
      description:
        'Call RIGHT AFTER a decision is settled with the user, a trap costs you time (gotcha), ' +
        'or an invariant/convention becomes explicit. One memory = one fact (<= 700 chars), ' +
        'a mandatory why, and at least one anchor (sym:<qname> or file:<path>). ' +
        'Do NOT store what is derivable from code, task status, or code snippets.',
      inputSchema: {
        type: z.enum(MEMORY_TYPES as [MemoryType, ...MemoryType[]]),
        title: z.string().max(100),
        body: z.string().max(700),
        why: z.string().min(10).describe('the reason — without it the note becomes noise'),
        anchors: z
          .array(z.string())
          .min(1)
          .describe('sym:<qname> | file:<path> (bare strings auto-detect by #)'),
        session: z.string().optional(),
      },
    },
    (args) => {
      try {
        const result = remember(db, {
          type: args.type,
          title: args.title,
          body: args.body,
          why: args.why,
          anchors: args.anchors.map(parseAnchorSpec),
          author: 'agent:mcp',
          ...(args.session !== undefined ? { sessionId: args.session } : {}),
        });
        const dup =
          result.duplicates.length > 0
            ? `\npossible duplicates — consider updating instead: ${result.duplicates
                .map((d) => `${d.id} (${d.title})`)
                .join(', ')}`
            : '';
        return text(`remembered as ${result.id}${dup}`);
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    'find_related',
    {
      title: 'Find related files',
      description:
        'Given a file or symbol, list the files most related to it (imports, imported-by, ' +
        'changes-together-in-git, same directory) with reasons. Use it to decide what else ' +
        'to read before an edit that might ripple.',
      inputSchema: {
        file: z.string().optional(),
        symbol: z.string().optional(),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    (args) => {
      try {
        const rows = findRelated(db, {
          ...(args.file !== undefined ? { file: args.file } : {}),
          ...(args.symbol !== undefined ? { symbol: args.symbol } : {}),
          limit: args.limit ?? 8,
        });
        if (rows.length === 0) return text('(no related files found — is the path repo-relative?)');
        return text(rows.map((r) => `- ${r.path} — ${r.reasons.join(', ')}`).join('\n'));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    'map_overview',
    {
      title: 'Project map + standing laws',
      description:
        'Call ONCE at the start of a session (or when lost): compressed per-directory stats ' +
        "and the project's standing invariants/gotchas/conventions to respect before editing.",
      inputSchema: {
        budget_tokens: z.number().int().min(200).max(6000).optional(),
      },
    },
    (args) => {
      try {
        return text(mapOverview(db, { budgetTokens: args.budget_tokens ?? 1500 }));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    'stale_memories',
    {
      title: 'Review queue of stale memories',
      description:
        'List memories whose anchored code has CHANGED since they were written (with old/new ' +
        'fingerprints and candidates for vanished symbols). Call when the user asks to clean ' +
        'up project knowledge, or at the start of a large task. Resolve each with the ' +
        'reanchor tool: confirm (still true), move (code relocated), or retire (no longer true).',
      inputSchema: {},
    },
    () => {
      try {
        return text(formatStale(listNeedsReview(db)));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    'reanchor',
    {
      title: 'Resolve a stale memory',
      description:
        'Settle one entry of the review queue. action=confirm: the note still holds — snapshot ' +
        'the new code fingerprint. action=move: the code relocated — needs anchor_id and ' +
        'to=<sym:qname|file:path>. action=retire: the note no longer holds. ' +
        'NEVER confirm without actually re-reading the anchored code first.',
      inputSchema: {
        memory_id: z.string(),
        action: z.enum(['confirm', 'move', 'retire']),
        anchor_id: z.number().int().optional(),
        to: z.string().optional(),
      },
    },
    (args) => {
      try {
        if (args.action === 'confirm') {
          confirmMemory(db, args.memory_id);
          return text(`confirmed — '${args.memory_id}' is fresh again`);
        }
        if (args.action === 'retire') {
          retireMemory(db, args.memory_id);
          return text(`retired '${args.memory_id}'`);
        }
        if (args.anchor_id === undefined || args.to === undefined) {
          throw new Error('action=move needs anchor_id and to=<sym:qname|file:path>');
        }
        moveAnchor(db, args.memory_id, args.anchor_id, parseAnchorSpec(args.to));
        return text(`anchor #${String(args.anchor_id)} moved to ${args.to}`);
      } catch (e) {
        return errText(e);
      }
    },
  );

  return server;
}

/** `haido serve` — stdio transport. stdout belongs to the protocol; log to stderr only. */
export async function serveStdio(root: string): Promise<void> {
  if (!workspaceExists(root)) {
    throw new Error(`no .haido workspace here — run 'haido init' first (root: ${root})`);
  }
  const db = openDb(dbPath(root));
  await indexRepo({ root, db });
  reconcileAnchors(db);
  const server = buildServer({ db });
  await server.connect(new StdioServerTransport());
  console.error(`haido MCP server ready — root: ${root}`);
}
