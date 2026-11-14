# Plan — Story 13-12

STANDARD: the `complexity-grew` check in `bin/lib/complexity.js`, which fails a
verify under `functionSize.enforce`. Tests on real git repositories
(`test/complexity-new-function.test.js`), red first (`645df3b`).

## Decisions

- **Same function = same name on a replaced line.** An added start line maps to
  a base line only when its hunk replaced a line that starts a function of the
  same name (declaration, assigned function/arrow, method, `def`/`func`/`fn`),
  the closest one to the positional guess. Otherwise the function is new
  (length 0 before). Consequence, accepted: renaming a long function reads as a
  new one over the bar.
- **Names as real lcov writes them (review).** A qualified name is matched on
  its last segment, a `.` allowed before it (`exports.build =`,
  `module.exports.run =`); `default` matches `export default`; a capitalised
  name also matches `constructor(` (V8 lists a constructor under its class).
  `anonymous_N`, `(anonymous_N)` and `<anonymous>` have no name: the replaced
  lines must hold exactly one line that reads like a function start, else the
  function is new. A test drives a real `node --test --experimental-test-coverage`
  lcov through the check (a test title edited, an export parameter added).
- **Growth by deletion.** A pure deletion hunk inside the function's span marks
  it touched; its base span is then measured as before.
- **Quoted paths.** git's C-quoted headers are unquoted (octal escapes as UTF-8
  bytes); the diff is asked for explicit `a/`/`b/` prefixes and no external
  diff, so a user's `diff.noprefix` or `diff.mnemonicPrefix` cannot hide a file.
  Hunk lines are skipped by count, so a removed `-- a/x` line is not a header;
  `diff --git` resets the file. A `+++` header still unreadable → `unavailable`.
- **No merge base.** Under `enforce`, off a base branch (`main`, `master`,
  `develop`, the default branch, the configured `baseBranch`) no merge base →
  `unavailable`. On a base branch, verify's stated scope is the uncommitted
  work against HEAD (every other gate measures the same), so that stays.
- **Moves.** A function that reads as new borrows the span of a function of the
  same name that the diff removed whole (every line of its base span) from any
  touched file. A long function moved unchanged passes; grown while moved, it
  is still growth; a same-named function only edited elsewhere (a changed
  signature) lends nothing (review P2). Known limit: a new function named like
  a deleted unrelated one borrows that one's length.
- **`skipCoverage` (AC6): no change.** Only `land`'s internal re-verify sets it
  (`worktree.js`), a run of the merged tree that is never a story proof
  (`COVERAGE_SKIPPED_REASON`); no user flag reaches it, so it cannot switch the
  ratchet off for a story.
- **Accepted after review:** no merge base on a base branch keeps measuring the
  uncommitted work (verify's stated scope); a new function named like a wholly
  deleted unrelated one borrows its length.
