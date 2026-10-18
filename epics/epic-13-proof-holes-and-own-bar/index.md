# Epic 13 — Proof holes, and this repository's own bar

## Goal

The two holes found on 2026-10-18 are closed — a migration is never "no
behavior", a command substitution is never a credential — and Coding Flow
holds itself to its own strongest rung: its verifies reach `verified`, its
security core runs STRICT, the bar it measures cannot be lowered silently,
the specification of a parser comes before its code, and touched functions
stop growing.

## Why

Measured 2026-10-18 (`docs/plans/uncle-bob-gauntlet.md`, section
*Re-measured*):

- A branch adding only `ALTER TABLE users DROP COLUMN email;` verifies green,
  coverage `not-required`, reason *"docs, story, or lockfile only"*:
  `**/migrations/**` and `**/*.sql` are both high-risk and non-behavior, and
  non-behavior wins (`bin/lib/coverage-gate.js` ~343). Every user with a
  migrations folder is exposed; epic 14's data dimension depends on it.
- The secret heuristic's only hit on a 162-commit MVP was a false positive
  (`password="$(aws secretsmanager …)"`).
- 0 of 206 verifies of this repository reached `verified`, although the whole
  suite runs under native lcov in 161 s (+11 %) and subprocess code is
  counted.
- STRICT reached the security core once, by a naming accident
  (`security-policy.js` matches `**/*policy.*`); `bin/lib/guard.js` matches no
  default high-risk path. The three epic-05 guard stories scored `medium`.
- Epic-05 stories took 10–12 review passes each, the P1s being missing shell
  cases: spec gaps, with the adversarial corpus as the epic's **last** story.
- `**/*.config.*`, `tsconfig*.json`, `.eslintrc*` are non-behavior: a diff
  that loosens a lint or coverage threshold is invisible to every signal.

## Scope

**In scope** — two bug fixes in the core; this repository's config; two
signals (policy weakening, criteria drift) and one rule in `/flow-plan`; a
size ratchet as a declared quality check.

**Out of scope**

- **The open `high` rows of `docs/DOGFOODING.md`** (`worktree land
  --dry-run` writes; story worktrees invisible to `flow-review`/`status`).
  They are ahead of this epic by the log's own rule, and fixed on their own,
  before s3.
- **Splitting `shellWrites`** — story 15-02, the first refactor proven by
  story 14-04's `--claim refactor`, which is the point.
- **CRAP for users' diffs** (wave 4): story 14-07. **Mutation** (wave 5),
  boundaries for users, the survivors of Experiment 1: epic 15.

## Backbone

`Backbone: a destructive migration needs proof → a secret is a secret → this repo's verifies reach verified and its security core runs STRICT → the bar cannot be lowered silently → the spec is written before the parser → a touched function cannot grow past the line`

### Story dependency tree

```text
s1
s2
s3
├── s4
└── s6
s5
```

`s1`, `s2`, `s5` are independent. `s4` and `s6` assume s3's lcov command is
in this repository's validation (s6 reads its lcov; s4's tests use the
config s3 writes).

## Stories

1. **story-13-01-migrations-are-behavior** *(STRICT — changes verdicts for
   every user with migrations)*
2. **story-13-02-command-substitution-is-not-a-credential** *(QUICK)*
3. **story-13-03-coding-flow-proves-itself-at-verified** — lcov in
   validation, the security core in `highRiskPaths`, `.coding-flow/runs/**`
   blocked by default. *(STANDARD)*
4. **story-13-04-the-bar-does-not-move** — policy-weakening signal.
   *(STANDARD)*
5. **story-13-05-spec-before-parser** — corpus-first rule, criteria-drift
   signal. *(STANDARD)*
6. **story-13-06-touched-functions-do-not-grow** — size ratchet. *(STANDARD)*

## Decisions

- **High-risk beats non-behavior.** A path matching both is behavior. Cheaper
  and clearer than removing the SQL globs from `nonBehaviorGlobs` (which
  would reintroduce generated SQL dumps as behavior for users who list them
  elsewhere).
- **The ratchet is a declared quality command, not a new gate.** It runs
  through `validation.quality` like `check-lock-exit-reachability.js`, so a
  user adopts it the same way, and the core gains no policy.
- **Signals lower claims, never raise them** (entry 9): policy weakening and
  criteria drift are contrary signals; strict mode fails on them unless a
  `## Policy Change` section explains the change.
