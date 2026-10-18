# Story 15-02 — Split `shellWrites` under a refactor claim

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
- **Proof**: characterization tests first, in their own commit, if any form
  is not yet pinned by `test/guard-shell.test.js`,
  `test/guard-adversarial.test.js` (the 05-05 corpus) or 15-01; then the
  split in a second commit verified with `ai-flow verify --claim refactor`
  — no existing test modified, suite green, moved lines executed.
- Every function in the new module ≤ 80 lines (13-06's ratchet passes on
  the diff); none of the CRAP > 30 entries remains in the module.

## Acceptance Criteria

- [ ] The refactor commit's verify records `claim: { kind: "refactor", ok:
      true }` and the coverage tier `verified`.
- [ ] `test/layering.test.js` lists `shell-writes` as core; it requires no
      module but `node:*` (pure).
- [ ] `scripts/check-function-size.js` passes on the diff; the largest
      function in `shell-writes.js` is ≤ 80 lines.
- [ ] Every DOGFOODING row and test about the guard behaves identically
      (no test file modified in the refactor commit — the claim checks it).
- [ ] The independent review (STRICT) finds no behavior change; its
      evidence is captured.

## Out of Scope

- New shell forms. A form found missing during the split becomes its own
  story, never a change inside the refactor.

## Result
