# Story 19-02 — Plan

## Implementation Context

- **Execution mode**: STRICT — touches the path to a verdict.
- **Likely files**: `bin/lib/evidence.js` (`executeValidationCommands`),
  `bin/lib/validation-run.js`, `bin/lib/harness-config.js` (config shape),
  `bin/lib/config.js`, `bin/lib/flaky-ledger.js` (new),
  `test/harness-verify.test.js`, `test/flaky-ledger.test.js` (new),
  `test/patch-coverage.test.js`.
- **Search anchors**: `executeValidationCommands`, `treeToken`,
  `untrackedDigest`, `freshRequired`.
- **Scout pre-step**: no.
- **Areas to avoid**: coverage thresholds; the cache replay path.

## Technical Notes

- DOGFOODING rows this answers (coding-flow): 2026-08-19 *test suite*
  (intermittent status test), 2026-10-18 *verify (13-03)*, 2026-11-10 *verify
  (15-01)* `pinned-claude-skills`, and the 2026-11-12 noise row; bethl:
  2026-11-12 verify row (39-02 `use-clips-feed`).
- Cross-verify detection uses evidence history: same story, same treeToken,
  same untracked digest, previous red, now green.

## Decisions

- **Default retry only in driven runs**: an interactive user can see and
  rerun; an unattended loop cannot, and the cost of a false red there is a
  wrongly blocked story.
- **Ledger keyed by file + test name**, not by command.

## Test Plan

A fixture test that fails on first run and passes on the second (counter file
in a temp dir); a twice-red test; a changed-tree case; ledger updates.

## Acceptance Traceability

- 1–4 → `test/harness-verify.test.js::retry on the same tree`
- 5–6 → `test/flaky-ledger.test.js`

## Commands

```bash
npm test
```
