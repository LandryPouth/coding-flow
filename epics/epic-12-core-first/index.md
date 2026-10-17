# Epic 12 — Core first: guard and proof stand alone, everything else is an opt-in layer

## Goal

The core — guard, `verify` with its evidence, freshness and coverage gate —
gives its full strength in a repository that uses **no** stories, epics,
worktrees or skills. Those layers stay available, are installed only on
request, and never appear by accident. The boundary is enforced by a test,
not by intention.

## Why

The external audit (2026-10-16) recommends treating the CLI, the proof engine
and the guard as the product, and stories, worktrees, skills and auto-merge as
optional layers — "reuse the engine where it helps, don't adopt the whole way
of working by default". The install side of that already exists
(`init --minimal`, reported by `doctor` as "guard + proof layer only"). What
is missing, checked in the code and on this checkout:

- **The proof is weaker without a story.** `harness.js` ~2291: a verify not
  attributed to a single story records coverage as `"not evaluated (no single
  story to attribute this run to)"`. A minimal user gets the command
  execution but never the coverage gate or the diff risk — the two signals
  that make the proof more than an exit code.
- **Minimal silently becomes full.** On 2026-10-16, running
  `node bin/ai-flow.js init --help` in this repository (installed
  `--minimal`) did not print help: it ran the install and reported `Install:
  promoted from minimal to full`, copying 13 files (RULES.md, docs templates,
  examples), creating `opencode.json` and adding 12 package scripts. Reverted
  by hand.
- **No subcommand help.** `init --help` executes `init`. For a CLI whose
  commands write files, `--help` must never act.
- **The boundary is not checked.** `harness.js` requires `story.js`;
  nothing prevents a core module from depending on worktree or skill code.
  Once epic-11 has split `harness.js`, a dependency test can hold the line.
- **Documentation leads with the workflow.** README and QUICKSTART present
  `/flow-plan` → `/flow-run` → `/flow-ship` first; the core is described as
  one of several parts.

## Scope

**In scope**

- `verify` without a story evaluates coverage and diff risk on the branch's
  own diff (epic-07's base resolution), with `scope: "branch"`.
- `--help` / `-h` on every subcommand prints usage and exits 0 without
  touching anything; `init` on a minimal install stays minimal unless
  `--full` is passed.
- A layering test: core modules may not require layer modules.
- README/QUICKSTART restructured: "Core" first (what it guarantees, what it
  does not — linking epic-05's limits section), then "Optional layers", each
  with how to add it.

**Out of scope — decisions made while planning**

- **Changing the default of `init` to minimal.** That changes what every new
  user gets; it is the maintainer's product decision, recorded as an open
  question in story 12-04 rather than decided here.
- **Splitting into several npm packages.** One zero-dependency package with
  an enforced internal boundary gives the same reuse without a release
  process per package.

## Backbone

`Backbone: a repo with only the core installed → verify runs the configured commands → coverage and risk are evaluated on the branch diff → evidence is written and freshness-checked → help and init never widen the install by accident → a test proves core modules do not depend on layers → docs present the core first`

### Story dependency tree

```text
s1

s2

s3

s4
```

All four are independent, with external prerequisites: `s1` needs
story-07-01 (diff base), `s3` needs story-11-01 (the split).

## Stories

1. **story-12-01-verify-without-a-story-keeps-its-teeth** — coverage and risk
   on the branch diff when no story is given. *(STRICT — changes verdicts for
   every non-story user)*
2. **story-12-02-help-never-acts-and-minimal-stays-minimal** *(STANDARD)*
3. **story-12-03-core-does-not-depend-on-layers** — dependency test.
   *(QUICK, after 11-01)*
4. **story-12-04-document-core-first** — README/QUICKSTART order, layer
   table, open question on the `init` default. *(QUICK)*

## Decisions

- **Core modules** (after 11-01): `guard`, `harness`, `harness-config`,
  `security-policy`, `policy-fingerprint`, `diff-base`, `diff-scope`, `risk`,
  `validation-run`, `coverage`, `coverage-gate`, `evidence`, `harness-report`,
  `identity`, `audit`, `report`, `doctor` (core checks), `util`, `context`,
  `policy`. **Layer modules**: `story`, `storage/*`, `worktree*`,
  `placement-store`, `backbone`, `next`, `run`, `status` (story view),
  `ship`, `review`, `skills`, `plugin`, `claude-plugin`, `speckit`,
  `templates` (story templates). Where a core module needs story data
  (acceptance criteria, story risk), it receives it as an argument from the
  layer, never by requiring the layer.
