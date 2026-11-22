# Story 15-02 — Split `shellWrites` under a refactor claim

## Status: done

## Claim: refactor

## User Value

The function that decides which shell commands write which files — 331
lines, ~110 decision points, the source of epic 05's 10–12 review passes per
story — becomes a pure module a reviewer can read, and the split is the first
refactor the tool proves with its own `--claim refactor`.

## Requirements

- `bin/lib/shell-writes.js` (core, pure: string in, targets out; no fs, no
  config): the shell reading now inside `shellWrites` (`guard.js:434`) and
  its inner helpers (`physical`, `add`, `followScript`), cut into named
  functions along the forms they read (redirections, in-place editors,
  copy/move/link destinations, interpreters and `-c`, scripts followed).
- `guard.js` keeps path resolution and policy; it calls the module.
- **Proof**: characterization tests first, on their own branch landed before
  the split, if any form is not yet pinned by `test/guard-shell.test.js`,
  `test/guard-adversarial.test.js` (the 05-05 corpus) or 15-01; then the
  split on a branch started after them, verified with
  `ai-flow verify --claim refactor` — no existing test modified, suite green,
  moved lines executed. (The claim diffs from the fork point, and refuses a
  base that only this branch holds.)
- Every function in the new module ≤ 80 lines (13-06's ratchet passes on
  the diff); none of the CRAP > 30 entries remains in the module.

## Acceptance Criteria

- [x] The refactor commit's verify records `claim: { kind: "refactor", ok:
      true }` and the coverage tier `verified`.
- [x] `test/layering.test.js` lists `shell-writes` as core; it requires no
      module but `node:*` (pure).
- [x] verify's `complexity-grew` check (13-06's ratchet, enforced: max 80
      lines, CRAP 30) passes on the diff; the largest function in
      `shell-writes.js` is ≤ 80 lines.
- [x] Every DOGFOODING row and test about the guard behaves identically
      (no test file modified in the refactor commit — the claim checks it).
- [x] The independent review (STRICT) finds no behavior change; its
      evidence is captured.

## Out of Scope

- New shell forms. A form found missing during the split becomes its own
  story, never a change inside the refactor.

## Result

- **Branch 1 (fee15eb, landed on `develop` first)**: `test/shell-writes.test.js`
  pins the exact `shellWrites` output per form (14 tests). The guard suites only
  assert `deny`, so five mutants survived them: directory destination found by
  stat (`cp a keys`, the 15-01 survivor), sed's script operand, sed's `-e` value,
  cp's sources, `git restore -s`. The new file kills all five. Also:
  `shell-writes` was classified as core + `PURE` in `test/layering.test.js`
  (requires nothing but `node:path`), and an empty stub was added.
- **Branch 2 (the refactor)**: `bin/lib/shell-writes.js` holds the whole shell
  reader, cut by form (words, segments, targets, redirections, verb, cd,
  in-place editors, copy/move/link, downloads, git, scripts, interpreters).
  The disk questions (`realpath`, `isDirectory`, `realPathOf`, `home`) come in
  through a `host` that `guard.js` supplies. `guard.js` dropped from 1428 to 837 lines.
- **Out of declared scope, and why**: `DEFAULT_REPORT_PATHS` moved from
  `coverage.js` to `harness-config.js` (`coverage.js` re-exports it). The
  guard's module budget (`guard loads only the modules it needs`, ≤ 6) would
  otherwise have reached 7. The move takes `coverage.js` off the guard path,
  as the `harness-config.js` header already said it should be ("a leaf"), so
  the budget held without changing the test. The first verify was red because
  the constant had not been exported (5 `monorepo-coverage` tests failed);
  after the fix, the proof is green.
- **Proof**: `.coding-flow/runs/2026-11-10T18-10-48-630Z-verify.json`. Claim
  refactor ok: 128 base test files untouched, none skipped or weakened.
  `Coverage: verified`: 100 % of the 775 added lines executed. `complexity-grew`
  ran enforced with no item. Largest function in `shell-writes.js`:
  `splitSegments`, 80 lines, moved verbatim, CRAP 25. `shellWrites` went from
  331 lines / CRAP 86 to 37 / 9. The criterion first named
  `scripts/check-function-size.js`, which no longer exists: the 13-06 ratchet
  runs inside verify (`complexity-grew`), and the criterion now names it.
- **Independent review** (fresh agent, adversarial, handed the diff and this
  contract): no behavior change. A differential run of old vs new compared
  229,276 `shellWrites` calls and 75,423 `decide()` calls (≈80 verb forms ×
  36 argument shapes × cd/subshell/pipe prefixes, from 3 start directories,
  with symlinks) and found 0 differences. It also missed the missing export
  above, which the full suite caught. Low finding, kept as is: the module's
  `shellWrites` has no default `host`. A default would mean requiring `fs`/`os`,
  and the module would no longer be pure; every caller goes through the guard
  wrapper. Info finding, out of scope, a 15-01 candidate: the
  `childProcess` assertion in `test/guard.test.js` reads `require.cache`, where
  builtins never appear, so it cannot fail.

### Rollback Notes

- `git revert` of the refactor commit restores the shell reader inside
  `guard.js`. The characterization commit can stay: it tests through
  `guard.js`'s exports, which did not change. No data or config to roll back.

