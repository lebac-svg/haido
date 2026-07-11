# haido — Design overview (EN)

Condensed from the full Vietnamese design docs ([vi/SPEC.md](vi/SPEC.md),
[vi/ARCHITECTURE.md](vi/ARCHITECTURE.md), market research in [vi/SURVEY.md](vi/SURVEY.md)).
This file is the fastest way for a contributor to understand what haido is and is not.

## Positioning

**Memory-first, map-minimal.** The "code graph via MCP" niche is crowded and commoditized
(see the survey: a 29k-star tool ships structure + embeddings + 3D viz as a single binary).
haido deliberately does NOT compete there. Its enemy is **forgetting**: agent working memory
is ephemeral while project knowledge must be durable — and durable knowledge today has no
objective mechanism to detect that it no longer matches the code. haido keeps only the
minimal structural index needed to anchor notes (symbols + fingerprints + import edges) and
spends everything on the **memory lifecycle**:

```
remember (anchored, with why) ──▶ code changes ──▶ anchor DRIFT/MISSING/MOVED
        ▲                                               │
        └── confirm / move / retire ◀── review queue ◀──┘
```

Five design principles:

1. **Anchor or it rots** — an unanchored note has no expiry signal; every memory needs ≥ 1 anchor.
2. **Objective staleness** — content hashes, never TTLs and never LLM self-reflection.
3. **Recall at the right moment beats recalling more** — hooks inject exactly when a file is
   touched, within a token budget, deduped per session.
4. **Cheap and predictable** — no hidden LLM calls, no embeddings requirement, no network;
   every behavior is explainable by an algorithm that fits on one page.
5. **Humans must be able to see it** — the map (`haido viz`) shows where knowledge lives
   and where it has gone stale.

## Architecture (one screen)

- **Storage:** one SQLite file (`.haido/haido.db`, WAL). Tables: `files`, `symbols`
  (with `body_hash`), `edges` (imports, co_change), `memories`, `anchors`
  (with `hash_at_link` + status), FTS5 over memories (diacritics-insensitive).
- **Indexer:** tree-sitter (WASM, grammars from `@vscode/tree-sitter-wasm`) extracts
  functions/classes/methods/exported consts/types for TS/TSX/JS + Python. Incremental:
  mtime+size fast path, then content hash, then parse. Text knowledge files (md/json/yaml/toml)
  are indexed at file level so notes can anchor to specs. **Normalized hashing** drops comments
  and whitespace: formatting never changes a fingerprint; any token change does. A class hash
  covers its member bodies (sensitive-over-silent policy).
- **Co-change miner:** bounded-window rebuild from `git log` — file pairs that changed
  together ≥ N times become weighted edges (a cheap, language-agnostic relatedness signal).
- **Staleness engine:** an idempotent reconciliation pass over all anchors; the state
  machine is `fresh → drift | missing | moved → fresh/retired`. Vanished targets are matched
  to identical twins by fingerprint, which is how anchors silently follow file renames.
- **Recall ranking:** `3.0·proximity + 1.0·bm25 + 0.6·type_prior + 0.3·recency − review_penalty`,
  where proximity is exact anchor > same file > neighborhood (imports/co-change/same dir) >
  full-text. Stale notes are demoted but never hidden on exact targets. Output is cut to a
  token budget.
- **Surfaces:** MCP server (6 tools, stdio), Claude Code hooks (SessionStart map,
  PostToolUse per-file injection + instant drift warnings after edits), CLI, and the
  self-contained viz page (2D reading view with spotlight interaction and directory
  territories; 3D showcase mode; memories drawn as diamond satellites tethered to anchors).
- **Memory pack:** one markdown file per note (restricted frontmatter, self-parsed — no YAML
  dependency). The DB is gitignored; the pack is committed. Import preserves recorded
  fingerprints, so machine B sees DRIFT for notes written on machine A if the code moved on.
- **Config:** `haido.toml` (self-parsed TOML subset) — include/exclude globs, co-change
  tunables, hook token budgets, output language (`en`/`vi`).

## Verified claims (not aspirations)

- Claude Code hook `additionalContext` contract verified with live canary sessions
  (see `experiments/hooks-probe/FINDINGS.md`): both SessionStart and PostToolUse deliver
  context, hooks run headless, `tool_input.file_path` arrives as an absolute OS path
  (haido normalizes to repo-relative POSIX).
- MCP roundtrips verified against a real Claude Code child session (`--mcp-config`).
- The full loop — edit → drift warning → review → confirm — runs live, including on this
  repository itself (self-hosted: haido's own constitution lives in
  [memory/](memory/) and is imported into its own database).

## Language policy

Public docs are English-first; the original design docs are Vietnamese and live in
[vi/](vi/) — kept, not translated away, because they are the project's actual working
documents and part of the dogfood. **Memory content is user data in the team's language**
(this team writes Vietnamese); haido's own UI strings are English by default with
`[ui] lang = "vi"` opt-in.
