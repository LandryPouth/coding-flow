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
  `fixedFiles` lists only paths inside the work tree.

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
