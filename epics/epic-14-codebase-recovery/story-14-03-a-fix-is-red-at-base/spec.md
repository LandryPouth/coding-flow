# Story 14-03 — A fix is proven by a test that was red at base

## User Value

When a finding is fixed, the evidence shows that the test protecting it
**failed before the fix and passes after** — not just that a test exists and
the suite is green. `/flow-review`'s "negative evidence" becomes a recorded
fact, for recovery fixes and for any bug fix.

## Requirements

- `ai-flow verify --red-at-base` (story or story-less):
  1. the diff's added or modified test files (`testGlobs`) — none → fail
     "nothing to be red: a fix needs a test that demonstrates it";
  2. two throwaway worktrees under the git common dir's temp area, at the
     merge base and at HEAD, set up **identically** (the HEAD versions of
     those test files copied into the base one; `node_modules` and other
     dependency dirs symlinked from the primary checkout, as `worktree.js`
     does for env files);
  3. the targeted command `redAtBase.command` from `harness.json` with
     `{files}` replaced by the test paths (e.g. `node --test {files}`,
     `npx vitest run {files}`, `pytest {files}`), run in both;
  4. ok iff it **fails at base and passes at HEAD**. Passing at both → "the
     test does not demonstrate the finding". Failing at both → "the test
     fails on the fix too, or cannot run in a clean tree" with both outputs'
     tails.
  5. evidence `redAtBase: { base, files, baseExit, headExit, ok, reason,
     durationMs }`; worktrees removed in every path (including errors).
- No `redAtBase.command` → fail with the per-stack examples; `bootstrap
  --scan` suggests one for detected stacks (Node test runner, Jest, Vitest,
  pytest, `go test` with package paths).
- Never in the user's own tree; never touches their index or stash.

## Acceptance Criteria

- [ ] Given a throwaway repo, a function with a bug on the base, and a branch
      adding a test that catches it plus the fix, then `verify --red-at-base`
      is ok, `baseExit ≠ 0`, `headExit = 0`.
- [ ] Given a branch adding a test that passes without the fix, then it fails
      with "does not demonstrate".
- [ ] Given a branch whose new test imports a helper added in the same diff
      (so it cannot run at base), then it fails "cannot run in a clean
      tree" — a red for the wrong reason is not a red.
- [ ] Given any outcome, including a thrown error mid-run, then no worktree
      remains (`git worktree list`) and the user's tree token is unchanged.
- [ ] Given no `redAtBase.command`, then the failure message names the key
      and shows the examples.

## Edge Cases

- A test that needs a database: the command is the user's to wrap
  (`docker compose run …`); not this story's job.
- Go: `{files}` is meaningless; `{packages}` (dirs of the test files, `./`
  prefixed) is substituted too.

## Result
