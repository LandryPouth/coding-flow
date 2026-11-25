# Story 26-08 — Init shows the rules it applies

*(STANDARD — writes the policy file; moves no existing proof's fingerprint.)*

Split out of 26-06 (its criterion 5) at that story's review cap, 2026-11-24.

## Why

A fresh `.coding-flow/harness.json` does not show `coverageFloor` or
`failOnContrarySignals`: the readers resolve them without the file
(`docs/rules-and-limits.md`, inconsistency 10), so a project reading its own
policy does not know they exist. `ai-flow rules` (26-06) now prints both with
their source; the file itself still hides them.

Writing them is not free, which is why it left 26-06. The policy fingerprint
hashes the merged `readHarnessConfig().config`, so any key `init` adds that the
defaults lacked makes every proof already recorded for that project stale. 26-06
found the trap in four shapes, over four review rounds:

- `harness init --force` on an existing file spread the new keys under it;
- `init` on a project with proofs but no `harness.json` wrote them;
- proofs recorded in another checkout (the primary, a linked worktree) were
  not seen from the checkout running `init`;
- a project in a subdirectory of its repository: `git worktree list` gives the
  checkouts' roots, and the project's `.coding-flow/runs/` must be joined from
  each root with the project's path relative to the git toplevel, or its
  proofs are missed.

## Acceptance Criteria

- [x] Given `init` (and `harness init`) on a fresh project, then
      `harness.json` contains `coverageFloor: { high: "auto", medium:
      "evidence", low: "not-required" }` and `failOnContrarySignals: false`.
      (`test/rules-registry.test.js`: the two tests that were `todo` for this
      story.)
- [x] Given a project with a recorded verify proof in any of its checkouts,
      including a project in a subdirectory of the repository, when `init`
      or `harness init [--force]` runs, then the policy fingerprint is
      unchanged.
- [x] Given `init` then `ai-flow rules`, then no rule says
      `(project value ignored)`.

## Commands

```bash
npm test
```

## Result

The keys are written when `init` or `harness init` creates `harness.json`; the
policy fingerprint leaves each out while it holds that default (plan.md D1), so
a file written in one checkout and merged into another, or for a project in a
subdirectory, changes no recorded proof's fingerprint. An existing file is not
rewritten. Rollback: revert the story's commits; nothing is stored or migrated,
and fingerprints computed meanwhile equal the old ones for every project whose
file holds the defaults.

## Acceptance Traceability

1. test/rules-registry.test.js::init writes coverageFloor and failOnContrarySignals with the spec values
2. test/init-rules-fingerprint.test.js::a harness.json written in a linked worktree keeps the primary's fingerprint (project in a subdirectory)
3. test/init-rules-fingerprint.test.js::after init, no rule says its project value is ignored

## Status: in-progress

