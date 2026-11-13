# Story 15-05 — Plan

## Implementation Context

- **Execution mode**: STRICT. Depends on 15-04 (go), 14-03 (runner), 14-04.
- **Likely files**: `bin/lib/mutation.js` (core, from
  `scripts/mutation-probe.js`), `bin/lib/evidence.js`,
  `bin/lib/coverage-gate.js` (contrary signal + exemption),
  `bin/lib/harness-config.js`, `harness-report.js`.

## Decisions

- **No `VULNERABLE` status** (study, table of the other tool's
  recommendations): one vocabulary for one question.
- **The probe runs as a child process, unchanged.** `bin/lib/mutation.js`
  spawns `scripts/mutation-probe.js` (15-04) with `--json` instead of moving
  its 770 lines into `bin/lib/`: its worktree, process groups, signal handling
  and leftover sweep went through five independent reviews, and a second copy
  would drift. The script is added to `package.json` `files` so it ships. A
  Ctrl-C during verify reaches the child (same process group), which cleans up.
- **Survivors are a contrary signal with the contrary signals' rule.** They
  lower `ok` only where `deleted-tests` and the others do: `mode: strict`, or
  `failOnContrarySignals` on a high-risk diff. Elsewhere they are listed as a
  warning (`with warnings (1 mutant(s) survived)`). Opting in to the probe is
  not opting in to strictness. Computed from the working config, as the other
  signals are on this branch; 13-04 (in flight) moves `enforced` to the base's
  config, and this rule should follow it when both land.
- **Not examined is not killed.** A probe that cannot run (the unmutated tree
  fails the command, no test file, no merge base) returns `ran: false` with
  the reason; it fails verify only when enforced, like a scanner that could
  not run.
- **Mutants run on the committed HEAD** (merge base..HEAD), as `--red-at-base`
  does: the probe needs commits, and a `git stash create` commit would miss
  untracked files. Printed in the limits.
- **`{files}` under a refactor claim.** A refactor changes no test, so the
  probe's own choice (the diff's test files) is empty and it would never run.
  When the diff touches no `testGlobs` file, every committed file matching
  `testGlobs` is passed as `--tests`: the tests already there are what must
  kill the mutants. Not in the spec; without it the refactor half of the
  trigger is dead.
- **`link` (not in the spec).** `mutation.link: ["node_modules"]` is passed
  through as the probe's `--link`; without it a project with dependencies
  fails its baseline in the throwaway tree. The probe's link guards apply.
- **15-04's carried-over findings are not fixed here**: sites still come from
  `git diff` without `-w` (re-indented lines count), and `--at` is HEAD, so
  relocation by text never runs in this path. Recorded for a follow-up.
- **verifyStoryOnce does not grow** (89 lines, above `functionSize.max`): the
  red-at-base and mutation calls moved into `extraProofs`, and the `ok` line
  became one `every` over the optional proofs.

## Out of Scope

- The verify cache key does not include the mutation result (a mutation
  config change is covered: `harness.json` is in the policy fingerprint).
- No skill text changes; `/flow-run` does not mention the probe yet.

## Acceptance Traceability

- 1 → `test/mutation.test.js` « lists the survivor »; 2 → « runs no mutation » (and the refactor-claim
  trigger); 3 → « samples the same sites »; 4 → « Mutation Exemption » and « another line »;
  5 → « no worktree remains ». Not examined → « cannot run ».
