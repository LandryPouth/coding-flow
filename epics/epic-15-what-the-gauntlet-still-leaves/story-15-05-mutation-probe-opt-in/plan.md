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
  config. Kept on the working config here for consistency (review 1); the
  alignment with 13-04's base read is done when the two land together.
- **No answer is not a pass (review 1, P1).** `ran: false`, "not examined",
  when the probe decided no mutant (no site in the diff's committed JS/TS
  lines — a non-JS project included — or every mutant timed out, failed to
  compile, did not start or was not applied), and when the working tree has
  uncommitted JS/TS changes: the mutants run on HEAD, so their verdict would
  be about other code. `canStandIn` never replays such a proof, like a
  scanner that could not run: the tree token ignores HEAD, so the same
  content committed would otherwise read "already proved". A run that
  answered records the `head` it mutated.
- **A budget for the whole probe** — `mutation.timeoutMs`, default 30 min
  (the probe bounds each mutant at max(60 s, 3 × baseline); twenty mutants of
  a slow suite would otherwise hold a verify for hours). Past it `spawnSync`
  sends SIGTERM: the probe stops its command's process group, removes its
  worktree and writes what it decided; the run is then "not examined" with
  the count. The probe's own process group is not killed from here (a
  `spawnSync` child is not detached); a probe that ignores SIGTERM would
  hold the verify — it does not, its handler is tested in 15-04.
- **Exemption text without HTML comments**, an unclosed one running to the
  end, as 13-04 does for `## Policy Change`.
- **`ship` and `run` carry the probe's line** (`describeMutation`): the PR
  body gets `**Mutation:**` (✅ / ⚠️ / ❌), the `run` summary a
  `mutation:` line, and a story blocked by it reads "no proof", not "FAIL".
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

- **Found, not fixed (pre-existing):** with an untracked file in the tree,
  `verify` records `provenance.git.treeToken: null` (seen in this story's
  fixtures, with and without the probe; `currentTreeToken` called directly
  in the same repository returns a token). The tree-token assertion of
  criterion 5 therefore uses a tracked edit.

- The verify cache key does not include the mutation result (a mutation
  config change is covered: `harness.json` is in the policy fingerprint).
- No skill text changes; `/flow-run` does not mention the probe yet.

## Acceptance Traceability

- 1 → `test/mutation.test.js` « lists the survivor »; 2 → « runs no mutation » (and the refactor-claim
  trigger); 3 → « samples the same sites »; 4 → « Mutation Exemption » and « another line »;
  5 → « no worktree remains ». Not examined → « cannot run ».
