# Story 19-05 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/validation-run.js` (`resolveValidationCommands`),
  `bin/lib/evidence.js` (`executeValidationCommands`), `bin/lib/config.js`,
  `bin/lib/templates.js` (config template), `test/harness-plan-commands.test.js`,
  `test/harness-verify.test.js`.
- **Search anchors**: `validation.quality`, `resolveValidationCommands`,
  `isProjectScriptInvocation`.
- **Scout pre-step**: no.
- **Areas to avoid**: `validation.quality` semantics (stays a check).

## Technical Notes

- bethl declares `npm run lint -- --force` as a quality check; its fixer would
  be `npm run lint -- --fix` (to be declared by the project, not by this story).

## Decisions

- **Fixers before checks, results kept**: the alternative (report-only) keeps
  the red that was the problem.
- **Where a fixer may come from (decided by the run, 2026-11-22):**
  `validation.fix` in the config applies whatever the checks' source; a
  `## Fixers` block in `plan.md` applies only when the checks come from
  `plan.md` too, and is refused unattended on the same terms as plan checks
  (a bare project-script invocation passes, `--allow-plan-commands` opts in).
  Criterion 4 needs a plan-side declaration to mean anything; tying it to the
  checks' source keeps one rule: the config wins, as for checks.
- **`fixedFiles` from two git snapshots** of the whole working tree: a
  throwaway copy of the index, `add -A -- .` (ignored files left out, only
  `.coding-flow/runs` excluded), `write-tree`, diffed by git and read
  untrimmed. Not the tree token's snapshot: that one excludes the story dirs
  and `.coding-flow/` whenever an untracked file exists, so a fixer ticking a
  box in a tracked `spec.md` went unlisted (review P1). `null` when git cannot
  say (outside git): unknown is not empty.
- **Fixer limits apart from the checks'** (`fixTimeouts`): a fixer and a check
  may share a text and carry different limits (review P2). A fixer's limit is
  part of its fingerprint line; a changed `validation.fix` also changes the
  policy fingerprint, so an earlier proof is not reused (tested).
- **`land` never runs fixers.** Its re-verify judges the merge commit on the
  target checkout; a fixer there would leave the target dirty and prove a
  tree nobody committed. If the merged result needs fixing, its checks fail
  and the land rolls back, as for any red.
- **Fingerprint:** fixers join the command fingerprint only when declared, so
  a project without them keeps every earlier proof (criterion 3).
- **Fixers prove nothing alone (review 2 P1):** the verdict comes from the
  checks; with no check verify is red even when the fixers passed, and no
  earlier proof is reused for a run without checks.
- **D-cap — re-scoped after four review rounds (run's decision, 2026-11-23).**
  Each round found a new P1: (1) `fixedFiles` missed tracked story/config
  files when an untracked file existed; (2) fixers alone gave a green verify;
  (3) a fixer's reformat of an unrelated test file earned the coverage gate;
  (4) the round-3 fix — scoping files only the fixers changed out of the
  diff-derived signals — made a verdict depend on run state (green before the
  fixer's change is committed, NOT PROVEN after, while reuse said "already
  proved"), and compared paths in two forms in a project below the git top.
  The run's cap is four rounds, so the story is re-scoped, not reviewed a
  fifth time: the fixer-only scoping is removed. A file a fixer touched is the
  story's diff exactly like a hand edit, in every signal, so reuse and status
  stay sound. What remains of round 3 is the coverage gate's own rule that a
  neutral test edit counts as strengthened, which a hand reformat exploits as
  well: it moves to story 19-08. Here, verify only warns (no verdict change)
  when a test file the gate counted as strengthened was rewritten by a fixer
  in the run (`fixerStrengthened`).
- **A fixer may not rewrite `.coding-flow/` or the story's own files:** the
  config, the run files, the story text and its criteria are read after the
  fixers, so verify is red (a `(fixers)` result naming the files) instead of
  proving from two states. The snapshot excludes nothing now: verify writes
  its own evidence after the second snapshot.
- **No check, no fixer:** fixers do not run when there is no check, since the
  verify is red anyway.
- **A `## Fixers` block ignored** (checks from the config or package.json) is
  said in a warning and recorded as `planFixersIgnored`.
- **The fixers run before anything reads the tree (re-scoped round 2 P1, the
  class):** the fresh-test requirement and the risk it reads were computed on
  the pre-fixer diff, so one tree got two verdicts (green, then red when the
  fix was committed). `verifyStoryOnce` now resolves only which fixers to run
  (`fixFirst`), runs them, then reads everything: harness config, risk and
  `freshTestsFor`, the commands (package.json may be reformatted) and
  `freshCommands`, the plan-command refusal, coverage, criteria, complexity,
  contrary signals, claim, story digest, policy and tree token. Audited reads
  that stay before the fixers: the story dir and diff-base request (paths and
  refs, no content); in `harnessVerify`, the reuse lookup. That lookup matches
  on the tree token, which leaves out the story roots and `.coding-flow/`, so
  (round 3 P2) with fixers declared it also matches on `storyRootsDigest`: the
  git tree ids of `epics/`, `specs/` and `.specify/` when the fixers ran.
  Another story's file put back unformatted is a change, never "already
  proved". `.coding-flow/` needs no digest: a reformat of it is no write.
- **Under `.coding-flow/`, a reformat is no write (round 3 P1):** `prettier
  --write .` re-indents the run files verify itself writes, which made every
  verify after the first red, forever. A JSON or JSONL file there whose parsed
  value is unchanged is not a write and is not listed; any other change, a new
  file or a removed one stays a forbidden write (a forged run stays red). The
  guard logs may only grow: the old bytes must be a prefix of the new ones.
- **Under the story roots, a reformat is still a write**, red, and the red
  names the remedy: add `.coding-flow/`, `epics/`, `specs/` and `.specify/` to
  the formatter's ignore file. `bootstrap --scan` prints those lines with a
  prettier/biome/dprint recipe; it writes nothing, like every recipe.
- **Limit:** on Windows with `core.autocrlf=true`, a fixer that changes only
  line endings is invisible to the snapshot (git normalises them).
- **The guard's own logs** (`.coding-flow/denials.jsonl`,
  `guard-unchecked.jsonl`) are not fixer output: the guard writes them during
  a run. Left out of `fixedFiles` and of the forbidden set.
- **Every story root is forbidden to a fixer** (`epics/`, `specs/`,
  `.specify/`, and the story in scope wherever it lives), so another story's
  criteria or an epic index cannot be ticked, with or without `--story`.
- **Outside git** `fixedFiles` is null and the forbidden-write rule cannot
  apply: a stated limit (`docs/rules-and-limits.md`).
- **The snapshot reads the whole work tree from the repository top, and
  `.coding-flow/` whatever the ignore rules say** (re-scoped series, round 1
  P1-A and P2-1): most projects ignore `.coding-flow/runs/`, the manifest and
  the active story, and `git add -A` skips ignored files, so a fixer forging a
  run file went unseen; a project below the top missed writes beside it.
  Other ignored files stay unread (build output, `node_modules`). Tested with
  this repository's own `.coding-flow/` ignore lines.
- **The forbidden-write red is one-shot (decided, re-scoped round 1 P2-2):** a
  fixer that rewrites the story's files or `.coding-flow/` makes that verify
  red; the next verify finds nothing left to fix and judges the files as they
  now are. Telling a fixer's text from a hand edit later would need a record of
  every fixer run; the red names the files so the author reverts or keeps them
  knowingly. Stated in `docs/rules-and-limits.md` and the CHANGELOG.
- **`fixedFiles` paths are relative to the project root**, like every path
  verify prints; a file outside it reads `../…`. The forbidden-write rule
  compares them with `.coding-flow/` and the story dir in that same form
  (review 4 P1-B, tested in a project below the repository top).
- **PR body:** fixer rows read `fix: …`, and the rewritten files are named.
- **Snapshot cost:** `git add -A` on a throwaway index writes blobs for the
  untracked files into the object store; they are unreachable and `git gc`
  prunes them. Accepted.
- **Red-at-base and the mutation probe run the checks without the fixers:**
  they judge a base or a mutant as committed, the way `land` does. A base
  whose only fault is formatting can read red at base; documented in
  `docs/rules-and-limits.md`, not changed here.
- **Suggestion, not template:** `config.json` is JSON (no comments), so the
  "suggest as a comment" requirement is met by `bootstrap --scan` (a
  `## Fixer Recipes` section and a summary line), like the quality and
  security recipes. A script that already rewrites (`--fix`, `--write`) is
  offered as is; an ESLint `lint` without one gets `-- --fix`; Coding Flow's
  own `flow:fix` (`doctor --fix`) is never offered.
- **Outside-the-repo writes:** a fixer runs at the project root like every
  declared command; the tool cannot stop a command writing elsewhere, and
  `fixedFiles` lists only paths inside the work tree. The spec line now says
  so instead of promising it; `docs/rules-and-limits.md` lists it as a limit.

## Test Plan

Temp repo with a fake fixer script that rewrites a file; failure case; plan
command refusal; dry-run.

## Acceptance Traceability

- 1, 2, 3, 5 → `test/harness-fixers.test.js` (a fixer runs first…, a fixer
  that fails…, without validation.fix…, --dry-run lists the fixers…)
- 4 → `test/harness-fixers.test.js` (a fixer declared only in plan.md is
  refused unattended…)
- land skips fixers → `test/worktree.test.js` (worktree land re-verifies the
  merged commit as it is…)

## Commands

```bash
npm test
```
