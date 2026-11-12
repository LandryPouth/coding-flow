# Story 14-03 — A fix is proven by a test that was red at base

## Status: done

## User Value

When a finding is fixed, the evidence shows that the test protecting it
**failed before the fix and passes after** — not just that a test exists and
the suite is green. `/flow-review`'s "negative evidence" becomes a recorded
fact, for recovery fixes and for any bug fix.

## Requirements

- `ai-flow verify --red-at-base` (story or story-less):
  1. the diff's added or modified test files (`testGlobs`) — none → fail
     "nothing to be red: a fix needs a test that demonstrates it";
     an added/deleted non-test file (a rename is both: its old path counts as
     deleted wherever the new one lands), or a modified file that is not
     plain JavaScript/TypeScript code → fail "cannot run in a clean tree": the
     base tree only carries the merge base plus the HEAD test files, and copying
     such a file would let a setup difference look like the finding. Read from
     git, never the checkout: a symlink or submodule is refused, an
     extensionless file is code only when its committed content starts with a
     shebang on both sides; `*.config.*`, dotfiles, test-setup names
     (`jest.setup.*`, `setup-tests.ts`) and any file named where the run is
     launched — the command (a preload, `NODE_OPTIONS`, its entry script),
     `package.json` scripts, `.npmrc`'s `node-options`, `.env` — are setup,
     not code. Prose is let through only when added or modified (never a type
     change), since only those are copied from HEAD. Test files under
     a fixture directory still count;
  2. two throwaway worktrees under the OS temp dir (never under `.git/`: Jest
     ignores every path containing it), at the
     merge base and at HEAD, set up **identically** (the HEAD versions of
     those test files copied into the base one and committed there, in that
     tree's own index, so its `git status` is as clean as HEAD's;
     `node_modules` and other
     dependency dirs symlinked from the primary checkout, as `worktree.js`
     does for env files);
  3. the targeted command `redAtBase.command` from `harness.json` with
     `{files}` replaced by the test paths (`node --test --test-reporter=tap
     {files}`), run in both;
  4. ok iff it **fails at base and passes at HEAD**. Passing at both → "the
     test does not demonstrate the finding". Failing at both → "the test
     fails on the fix too, or cannot run in a clean tree" with both outputs'
     tails. "Fails at base" means node's TAP output shows a test **from
     the diff's test files** that started and failed (`failureType:
     testCodeFailure` located in one of them), and nothing that never started
     (a file-level failure, a failed hook); any other output — another runner,
     node's default reporter — is refused. A diff that changes no code file has
     nothing to be red against and is refused before the trees are built;
     prose the preflight lets through is copied from HEAD into the base tree.
  5. evidence `redAtBase: { base, files, baseExit, headExit, ok, reason,
     durationMs }`; worktrees removed in every path (including errors).
- No `redAtBase.command` → fail with the example; `bootstrap --scan` suggests
  `node --test --test-reporter=tap {files}` for a Node project that does not
  use Jest, Vitest or Mocha.
- Never in the user's own tree; never touches their index or stash — not even
  the temporary index git hands a `pre-commit` hook (`GIT_INDEX_FILE` and the
  other repository variables are dropped for the trees and the runner).

## Acceptance Criteria

- [x] Given a throwaway repo, a function with a bug on the base, and a branch
      adding a test that catches it plus the fix, then `verify --red-at-base`
      is ok, `baseExit ≠ 0`, `headExit = 0`.
- [x] Given a branch adding a test that passes without the fix, then it fails
      with "does not demonstrate".
- [x] Given a branch whose new test imports a helper file added in the same
      diff (so it cannot run at base), then it fails "cannot run in a clean
      tree" — a red for the wrong reason is not a red.
- [x] Given any outcome, including a thrown error mid-run, then no worktree
      remains (`git worktree list`) and the user's tree token is unchanged.
- [x] Given no `redAtBase.command`, then the failure message names the key
      and shows the example.

## Edge Cases

- A test that needs a database: the command is the user's to wrap
  (`docker compose run …`); not this story's job.
- A helper added inside an existing code file is treated as part of the fix:
  the preflight cannot distinguish a new function used for setup from the
  behavior being fixed. Keep setup helpers in their own (added) file, which is
  refused, or test the old behavior. Under node ESM a missing export is a
  file-level failure and is refused; under CommonJS a missing name is
  `undefined` at runtime, and the resulting `x is not a function` reads as a
  red.
- A failing `before`/`beforeEach` hook is reported by node as `hookFailed` and
  refused.
- Several test files share one exit code: once the run shows a diff test that
  started and failed and nothing that never started, every file in `files` is
  reported together.
- The trees link `node_modules` from the user's checkout, so a runner cache
  written during a run (Vitest's `node_modules/.vite`) lands there. Only the
  root `node_modules` is linked: in a pnpm/npm workspace a package's own
  `node_modules` is missing from the trees, and its reds are refused as
  "fails on the fix too".
- Only node's test runner is read. A Jest, Vitest, Go or pytest suite is
  refused ("does not show a test from the diff that ran and failed"), never
  read: each brought setup, mock and config files (declared in a JS config,
  `__mocks__`, `setupFiles` without extension) whose change could pass for the
  fix. A setup file reached only through an unchanged file (an unchanged
  wrapper script that requires it, an import from the test) is not seen as
  setup and counts as code like any other module.
- The base tree sits on its own throwaway commit: a test that reads the commit
  itself (`git rev-parse HEAD`, `git log`, `git describe`) sees a different one
  at base and can read as red.
- A command run without test isolation (`--experimental-test-isolation=none`)
  is refused: a file that fails to load prints nothing then.
- A run killed by a signal never reaches its cleanup; the next run removes
  the worktrees a dead process left registered in the repository — only a
  `base`/`head` linked worktree inside a run directory it marked, directly
  under the OS temp dir, and never the run directory recursively.

## Spec Change

Acceptance criterion 3 now says "a helper **file** added in the same diff":
a helper added inside an existing code file is treated as part of the fix,
because the preflight cannot distinguish that new function from the behavior
being fixed. The edge case is documented above; setup helpers must live in an
added file (refused) or the test must exercise old behavior.

Requirement 4 (2026-11-09, sixth review, user's choice): a red is now
positive evidence of a test that started and failed, read per runner, instead
of "any failure not on a list of setup errors". pytest dropped from the
suggested stacks until its output is observed.

Requirements 1, 3 and 4 (2026-11-09, tenth review, user's choice): reduced to
node's test runner. Ten reviews kept finding Jest/Vitest/Go setup and mock
files the name-based preflight let through as code (P1 per round: 2, 3, 3, 1,
2, 1, 4). The modified-file classification now reads git modes and blobs, and
only JavaScript/TypeScript counts as code.

Requirement 2 moved the trees from the git common dir to the OS temp dir
(2026-11-09 review): under `.git/`, test discovery commonly skips every
path (Jest's haste map found no test at all).

## Result

Done 2026-11-10. `verify --red-at-base` proves a fix with node's test runner
(TAP); every other runner is refused. Fifteen STRICT reviews: the tenth led to
the node-only scope (user's choice); the eleventh to fourteenth each found a
false proof (a rename hiding a deletion, a launch-named setup file, a suffix
match on a non-diff test, a type-changed prose file, the base tree's
uncommitted copies) and the hook variables writing a commit's index. The
fifteenth passed (P2: the base-tree commit could run the user's `gc --auto`,
fixed in 243d893 with a test). Known limits are under Edge Cases.
