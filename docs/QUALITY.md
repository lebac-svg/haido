# haido — Engineering constitution (grounded reflection)

**Why this file exists:** haido is a tool that teaches AI discipline about memory.
*A project that teaches discipline while being sloppy itself loses the right to manage
other projects.* This repo must be a living model of what it sells: every self-critique
backed by evidence, every lesson recorded, every note anchored.

**Root principle — grounded reflection:** AI (and humans) may self-review and rewrite,
but **every critique must be checked against an objective signal** — a red test, a type
error, a lint finding, a measurement, dogfood behavior. Unanchored self-correction is
banned; research shows it often makes things worse.

Vietnamese original with full detail: [vi/QUALITY.md](vi/QUALITY.md).

## 1. Three reflection loops

**Small — every change:** new behavior → write the test first (especially the golden
tables for `normalize()`/staleness — the heart of the product). Run `npm run check`
(typecheck + lint + format + tests). **Red means read the real output, then fix the
root cause** — never guess, never weaken a test to pass. Green = done; not green = does
not exist.

**Medium — every feature:** definition-of-done checklist — golden tests cover the
acceptance criteria written in the spec (not tests invented to be easy); a REAL
end-to-end run (CLI/MCP against a fixture repo), not just units; one code-review pass
with every finding fixed or argued; behavior that deviates from the spec means fixing
one of the two *deliberately*, with the reason stated; new decisions/traps recorded in
`docs/memory/`.

**Large — every sprint:** dogfood on haido itself and on a real project; measure the
spec's metrics with real numbers; a three-question retro (what differed from the
architecture's predictions? what lesson makes us less dumb next sprint? which doc needs
fixing — and was it fixed?); a manual stale-review of `docs/memory/`.

## 2. The rig (objective verification machinery)

| Layer | Tool | Law |
|---|---|---|
| Types | TypeScript `strict` + `noUncheckedIndexedAccess` | no bare `any`; `@ts-expect-error` requires a reason |
| Lint | eslint flat + typescript-eslint | warnings are handled before a feature is done |
| Format | prettier (code; hand-formatted docs exempt) | no format debates |
| Tests | vitest + v8 coverage | golden normalize/staleness tables are inviolable |
| CI | GitHub Actions: ubuntu + windows × Node 20/22 | **not green, not merged** — Windows is first-class |
| One command | `npm run check` | must be green before ending any session that touched code |

Hard rules: assumptions about external APIs get a verifying prototype **before**
anything is built on them (the Claude Code hooks contract was proven by canary test
first); native dependencies must ship prebuilds for win+linux+mac; the competitive
window is met by **cutting scope, never by cutting gates**; a commit command must be
conditioned on the gate's exit code — piping `check; commit` once let a red commit
through (recorded as m_boot_010).

## 3. The hand-written logbook — `docs/memory/`

Until haido fully serves itself, this repo records its memory **by hand in the
product's own pack format** — discipline and dogfood at once (`haido import --pack
docs/memory` feeds it into the self-hosted database). Write decisions, invariants,
gotchas, conventions — with a **why** and an **anchor**; never restate what code/docs
already say. This pack is Vietnamese (the team's language); new memories switch to
English when the contributor base does.

## 4. End-of-session ritual (manual Stop-hook)

1. Is `npm run check` green? (If not, the session is not over.)
2. Any new decision settled, trap sprung, or invariant surfaced? → write it into
   `docs/memory/` with why + anchor.
3. Did anything deviate from the spec? → fix code or spec, say so explicitly.
4. Any promise made in conversation but not done? → do it or turn it into a tracked item.

## 5. Definition of "done"

Golden tests covering the acceptance criteria ✚ `npm run check` green locally ✚ CI green
on Windows and Linux ✚ exercised end-to-end by hand at least once ✚ lessons (if any)
recorded in `docs/memory/`. Missing any leg = not done; say "not done".
