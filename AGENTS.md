# Working rules for AI agents in the haido repo

This repo builds a memory tool for AI — so any agent working here must model the very
discipline it ships.

## Read before touching anything (in order)

1. `docs/DESIGN.md` — what haido is and is not (EN overview).
2. `docs/QUALITY.md` — the engineering constitution: reflection loops, definition of done.
3. `docs/memory/` — the project's logbook: decisions/invariants/gotchas still in force.
   **Read all of it before editing code.**
4. Full design docs (Vietnamese originals): `docs/vi/SPEC.md`, `docs/vi/ARCHITECTURE.md`,
   `docs/vi/SURVEY.md`.

## Hard rules

- **`npm run check` must be green before ending any session that touched code.** Red means
  read the real output and fix the root cause — never weaken a test, never skip.
- **Critique needs an anchor:** conclude "right/wrong" only from objective signals (tests,
  tsc, eslint, measurements, live behavior) — no vibes-driven rewrites.
- **The spec is law:** if behavior deviates from `docs/vi/SPEC.md`/`ARCHITECTURE.md`, either
  fix the code or propose a spec diff for the owner to approve. No silent drift; never edit
  the settled decisions in SPEC §14 on your own.
- **Commits are gated:** condition any commit on the check's exit code (`m_boot_010`), and
  commit/push/publish only when the owner asks.
- **End-of-session ritual** (QUALITY §4): new decisions/traps/invariants → record them in
  `docs/memory/` in the pack format (frontmatter + why + anchor), then
  `node dist/cli.js import --pack docs/memory` to sync the self-hosted database.
- **Do NOT create a `CLAUDE.md` file** in this repo (owner's explicit requirement).
- **Vietnamese content goes through MCP or pack files, never PowerShell CLI args**
  (`m_boot_013` — console encoding mangles diacritics).
- The owner speaks Vietnamese: converse with them in Vietnamese (xưng "tôi", gọi "bạn").
  Code, comments, and commit messages are English. Public docs are English-first;
  this repo's memory pack stays in the team's language (currently Vietnamese).

## Competitive context (so you don't drift off course)

Do not turn haido into yet another code-graph server — that niche is owned by a 29k-star
tool. haido's value is the **memory lifecycle**: hash anchors → self-detected staleness →
review → reanchor. Details: `docs/vi/SURVEY.md` §9–11.
