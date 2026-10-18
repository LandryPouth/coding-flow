# Story 13-01 — Plan

## Implementation Context

- **Execution mode**: STRICT (changes verdicts for existing users).
- **Scout pre-step**: no.
- **Likely files**: `bin/lib/coverage-gate.js` — the `behaviorFiles` filter
  (~340–356) and its `mode: "none"` return; `bin/lib/harness-config.js`
  (`defaultNonBehaviorGlobs`, `highRiskPaths` defaults, read only);
  `bin/lib/risk.js` (read only: confirm no change in levels).
- **Tests**: a new `test/migrations-are-behavior.test.js` on throwaway repos,
  modelled on `test/storyless-verify.test.js` (CLI + git, `mktemp -d`).
- **Avoid**: changing the default glob lists themselves (Decision below).

## Decisions

- **Overlap rule in code, lists untouched.** "High-risk ⇒ behavior" fixes
  every existing install without rewriting their `harness.json`; editing the
  defaults would only fix new installs.
- **Only the exact overlap is overridden.** A file is behavior despite
  `nonBehaviorGlobs` when it matches a pattern listed, verbatim, in both lists
  (by default `**/migrations/**`, `**/*.sql`), and is not `*.md`. A first
  version overrode any high-risk match except an "inert" list; the independent
  review reproduced the regression (`packages/auth/tsconfig.json`,
  `src/payments/generated/client.ts` demanded a test). Pinned both ways.
- **Other migration layouts are out of scope** (`src/migration/`, EF Core
  `Migrations/`, `alembic/versions/`, Liquibase changelogs): adding them to
  `highRiskPaths` changes risk levels for every user, which this story's edge
  cases exclude. Logged in DOGFOODING.
- **The existing test "a migration is not asked for a unit test" is reversed**
  on purpose, not weakened: it encoded the hole this story closes.
- **A user who lists a path as non-behavior and not as high-risk keeps it
  non-behavior**: the rule only applies to files matching both lists.

## Test Plan

Each acceptance criterion is one test; the failing-first replay is the
2026-10-18 DOGFOODING row (`DROP COLUMN` → green), which must fail on the old
code.

## Acceptance Traceability

- criteria 1–5 → `test/migrations-are-behavior.test.js`
