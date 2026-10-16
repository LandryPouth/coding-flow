# Epic 11 — Maintainability and measurement

## Goal

`harness.js` is split along the responsibilities it already has, the guard is
proven on the real agent hosts on a schedule, and the claim "Coding Flow
improves reliability" gets numbers.

## Why

- `bin/lib/harness.js` is 2 620 lines: secret detection, path policy, risk,
  diff analysis, command execution, coverage, evidence, story verification,
  printing. Epics 05–09 touch most of these; after them, the boundaries are
  known and tested, which is the right moment to extract — not before.
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
   but wide; run after epics 05–09 have landed)*
2. **story-11-02-real-host-guard-smoke** *(STANDARD)*
3. **story-11-03-run-the-benchmark** *(QUICK — protocol exists; this is
   execution and a write-up)*
4. **story-11-04-status-ignores-the-story-description** — a fresh single-file
   story reads `planned`, not `in-progress`. *(QUICK — found while writing
   these epics; independent of everything else, can run any time)*

## Decisions

- Extraction targets follow the audit's proposal, adjusted to the code:
  `security-policy` (secrets, blocked/sensitive paths — shared with
  `guard.js`), `diff-scope` (epic-07's resolver, changed files and lines),
  `risk` (story + diff + structural signals), `validation-run` (command
  resolution and execution, cache detection), `coverage-gate` (rung, floor,
  weakening, criteria), `evidence` (assembly, fingerprints, reuse, writing),
  `harness-report` (printing). `harness.js` keeps the command entry points
  and re-exports.
