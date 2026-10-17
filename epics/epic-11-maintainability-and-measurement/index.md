# Epic 11 — Maintainability and measurement

## Goal

`harness.js` is split along the responsibilities it already has, the guard is
proven on the real agent hosts on a schedule, and the claim "Coding Flow
improves reliability" gets numbers.

## Why

- `bin/lib/harness.js` is 3 233 lines (2 620 when this epic was planned; epics
  07–09 added to it): secret detection, path policy, risk, diff analysis,
  command execution, coverage gate, contrary signals, evidence, story
  verification, printing. Epics 05–09 have landed (PR #53, 2026-10-17): the
  boundaries are known and tested, which is the right moment to extract.
- The guard's behaviour depends on host versions (OpenCode 2 broke it
  silently, 2026-10-16). Unit tests load the plugin with fake contexts; only
  a real host proves the hook is called.
- `docs/experiments` states the main hypothesis (Coding Flow vs the agent
  alone) is not yet validated. The external audit is right that this is the
  claim everything else serves.

## Scope

**In scope**

- Extraction of `harness.js` into modules with no behaviour change.
- A smoke script that installs into a throwaway HOME and asks each available
  host (Claude Code, OpenCode 1.x, OpenCode 2.x) to write `.env`, asserting
  a denial; run by hand before a release and optionally on a schedule.
- Running the benchmark protocol already written in `docs/experiments` and
  publishing the numbers, whatever they say.

**Out of scope**

- A rewrite. Every extraction is a move plus re-export; `npm test` unchanged
  and green at each step.

## Backbone

`Backbone: modules extracted with tests green at each step → hosts smoke-tested before a release → benchmark run and published`

### Story dependency tree

```text
s1
s2
s3
s4
```

## Stories

1. **story-11-01-split-harness-by-responsibility** *(STANDARD — mechanical
   but wide; epics 05–09 have landed, ready to run)*
2. **story-11-02-real-host-guard-smoke** *(STANDARD)*
3. **story-11-03-run-the-benchmark** *(QUICK — protocol exists; this is
   execution and a write-up)*
4. **story-11-04-status-ignores-the-story-description** — a fresh single-file
   story reads `planned`, not `in-progress`. *(QUICK — found while writing
   these epics; independent of everything else, can run any time)*

## Decisions

- Extraction targets follow the audit's proposal, adjusted to the code as of
  2026-10-17: `harness-config` (defaults, read/ensure — what `templates.js`
  and `policy-fingerprint.js` need), `security-policy` (secrets,
  blocked/sensitive paths — what `guard.js` needs), `diff-scope` (changed
  files and lines, on top of epic-07's `diff-base.js`), `risk` (story + diff
  + structural signals), `validation-run` (command resolution and execution,
  cache detection), `coverage-gate` (floor, weakening, criteria, contrary
  signals, on top of `coverage.js`), `evidence` (preflight, assembly,
  fingerprints, reuse, writing), `harness-report` (printing). The shared
  story readers join `story.js`. `harness.js` keeps the command entry points
  and re-exports. The story's spec holds the line-by-line map.
- Split along the dependency rule, not only by responsibility
  (`docs/plans/uncle-bob-gauntlet.md`): the guard and `policy-fingerprint.js`
  depend on `harness-config`/`security-policy`, never on `harness.js`; the
  core → story/speckit edges are left to story 12-03.
