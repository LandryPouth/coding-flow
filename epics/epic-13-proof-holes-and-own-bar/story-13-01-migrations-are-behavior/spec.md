# Story 13-01 — A migration is behavior

## Status: done

## User Value

A developer whose branch drops a column, rewrites a table or adds a
constraint gets the same demand for proof as one whose branch touches
`auth/` — not a green `not-required` that says the diff was docs.

## Requirements

- A changed file that matches `highRiskPaths` is a behavior file, even when it
  also matches `nonBehaviorGlobs`. The default overlap today:
  `**/migrations/**`, `**/migrate/**` (high-risk) and `**/migrations/**`,
  `**/*.sql` (non-behavior).
- The `mode: "none"` reason names what was excluded instead of the fixed
  *"docs, story, or lockfile only"*: e.g. `no behavior file changed (3 file(s)
  excluded by nonBehaviorGlobs: docs/a.md, …)`.
- A migration-only diff then reaches the normal paths: a test changed → pass
  at `evidence`; lcov reaching the lines → `diff-lines`; neither → fail with
  the existing reason, or a declared `## Test Exemption` (e.g. "schema-only
  migration, verified by `db:migrate` against a scratch database") → pass,
  recorded verbatim.
- Generated files stay non-behavior when they are not high-risk
  (`**/generated/**`, `*.gen.*`).

## Acceptance Criteria

- [x] Given a throwaway repo with `.coding-flow/config.json` only, when a
      branch adds `migrations/002.sql` (`ALTER TABLE users DROP COLUMN
      email;`) and nothing else, then `ai-flow verify` fails the coverage
      gate and the reason names `migrations/002.sql`.
- [x] Given the same branch plus a changed test file, then verify passes at
      `evidence`.
- [x] Given the same branch and a `--test-exemption "schema-only, checked by
      db:migrate on a scratch db"`, then verify passes and the evidence
      records the exemption text.
- [x] Given a branch changing only `docs/a.md` and `src/generated/x.gen.ts`,
      then `mode: "none"` and the reason lists both files as excluded.
- [x] Given a user `harness.json` that lists `**/*.sql` in
      `nonBehaviorGlobs` and not in `highRiskPaths`, then `.sql` files stay
      non-behavior (the user's explicit choice wins; only the overlap changes).

## Edge Cases

- Risk scoring already counts migrations as `high`; this story must not
  double-count or change risk levels, only the coverage gate's file split.
- A Prisma `schema.prisma` is high-risk and not non-behavior today:
  unchanged.

## Out of Scope

- Running migrations or diffing schemas. Proof stays "a test or a declared
  reason".

## Result

A file matching a pattern listed in both `highRiskPaths` and
`nonBehaviorGlobs` (by default migrations and `.sql`), other than `*.md`, is
behavior in the coverage gate. Config, lockfiles and generated code under a
high-risk directory stay excluded. The `not-required` reason lists the
excluded files; a failing gate names the behavior files. Tests: 5 for the
criteria (red on the old code), 3 boundary tests in `coverage-gate.test.js`;
the old "a migration is not asked for a unit test" is reversed. Each rule was
mutated both ways (too broad, absent) and the suite went red.
