# 🧭 haido (Hải Đồ)

> **A captain's log for AI coding agents** — project memories anchored to code,
> aware of their own staleness.

AI coding agents forget. Context windows fill up, sessions end, and every hard-won
decision — *"amounts are integer cents, never floats"*, *"we tried library X, it broke Y"* —
evaporates. Convention files (`CLAUDE.md`, rules, memory banks) try to help, but they rot
silently: nobody knows which notes still match the code.

**haido** fixes the rot. Every note is **anchored** to a specific function or file with a
content fingerprint. When that code changes, the note **raises its hand** — it shows up in a
review queue with the old/new fingerprints, gets confirmed, moved, or retired. Notes are
injected into your agent's context **at the exact moment it touches the related file**, within
a token budget. No cloud, no embeddings, no LLM guessing — one SQLite file and honest hashes.

*Hải Đồ* is Vietnamese for a nautical chart; the log that keeps a ship's knowledge honest.

## What it feels like

```text
$ (agent edits src/board.ts)
⚠ haido: note [m_x1] anchored at `src/board.ts#Board.move` just went DRIFT
  because of this change — if it no longer holds, reanchor or update the note.

$ (agent reads src/pricing.ts — hook injects, unprompted)
### Related memories (haido)
- ⛔ INVARIANT [m_9k] `src/pricing.ts#computeTotal`
  Money is integer cents — never floats. why: float rounding corrupted invoices once
```

The agent never has to *remember to remember*. SessionStart injects a compressed project map
plus the standing laws; touching a file injects the notes anchored around it (once per
session); editing code that invalidates a note triggers an immediate warning.

## Install (from source — npm package coming soon)

```bash
git clone <this repo> && cd haido && npm install && npm run build

cd /your/project
node /path/to/haido/dist/cli.js init                  # index + git mining + starter haido.toml
node /path/to/haido/dist/cli.js install claude-code \
     --command node /path/to/haido/dist/cli.js        # wires hooks + MCP (.mcp.json)
# open a new Claude Code session in your project — it now has a memory
```

`haido install claude-desktop` registers the MCP server for Claude Desktop
(on-demand recall — Desktop has no hooks). Once published: `npx haido init && npx haido install claude-code`.

## The pieces

| Surface | What you get |
|---|---|
| **Hooks** (Claude Code) | Auto-inject: project map at session start; anchored notes per touched file; drift warnings right after an edit invalidates a note |
| **MCP tools** | `recall` · `remember` · `find_related` · `map_overview` · `stale_memories` · `reanchor` |
| **CLI** | `init · index [--watch] · serve · install · remember · recall · related · overview · stale · reanchor · export · import · viz · doctor` |
| **`haido viz`** | A self-contained interactive map (one HTML file, zero deps): files colored by directory, import/co-change links with spotlight-on-hover, memories as diamond satellites tethered to their anchors, 2D reading view + 3D showcase mode |
| **Memory pack** | `export/import --pack`: one markdown file per note, committed to git — knowledge travels with the repo and is reviewed in PRs; recorded fingerprints carry staleness across machines |

## How staleness works (the core trick)

1. `remember` snapshots a **normalized content hash** of the anchored symbol/file
   (comments and whitespace stripped — `prettier` runs never cry wolf).
2. Every index pass re-checks all anchors against the current code:
   - hash matches → **fresh** (a revert heals a stale note automatically)
   - hash differs → **drift**, with old/new fingerprints for review
   - target vanished but an identical twin exists → **moved**: the anchor follows
     renames/moves silently
   - target gone for good → **missing**, with candidate suggestions
3. A note with any drifted/missing anchor enters the review queue: `confirm`
   (still true — snapshot the new hash), `move`, or `retire`. Nothing rots silently.

Hygiene is enforced at write time: every note needs a **why** and **≥ 1 anchor**, one fact
per note (≤ 700 chars), duplicates are flagged. Notes record *decisions, invariants,
gotchas, conventions* — never things derivable from code.

## Configuration (`haido.toml`, committed with your repo)

```toml
[index]
exclude = ["generated/**"]   # on top of built-in skips (node_modules, dist, …)
[cochange]
min_together = 3             # files must co-change ≥ N commits to become an edge
[recall]
budget_tokens = 800          # hook injection budget per file
[ui]
lang = "en"                  # output language: "en" (default) | "vi"
```

TypeScript/TSX/JS + Python are symbol-indexed; markdown/JSON/YAML/TOML are file-level
anchor targets (yes, you can anchor decisions to your specs). 100% local: no network
calls, no telemetry.

## Design docs

English overview: [docs/DESIGN.md](docs/DESIGN.md) · Engineering constitution:
[docs/QUALITY.md](docs/QUALITY.md) · Full design docs (Vietnamese originals — this
project is built by a Vietnamese-speaking team, and haido's own memory pack in
[docs/memory/](docs/memory/) is part of the dogfood): [docs/vi/](docs/vi/)

## Status

Core MVP works end-to-end and is verified live in real Claude Code sessions (hooks
canary + MCP roundtrips), self-hosted on this repo, and dogfooding on a real game
project. Pre-publish checklist: demo GIF, npm release. Roadmap: doc↔code "spec-of"
edges, semantic zoom for the map, `.mcpb` bundle for Claude Desktop.

## License

MIT
