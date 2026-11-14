# Story 13-12 — A new function is measured as new

## Status: in-progress

Found by the independent review of story 13-06 on `develop` (2026-11-14,
P1). The size ratchet 13-06 shipped now lives in `bin/lib/complexity.js`
(story 14-07 replaced the script). When a hunk both replaces an existing line
and inserts a new long function, `toBaseLine` maps the new function's start
onto the replaced base line and `baseSpan` measures whatever base function
starts there: a new 100-line `fresh()` written after an edited `// doc` line
borrows the 121 lines of the `old()` below it and passes under `enforce`.

*(STANDARD — the `complexity-grew` check, which fails a verify under
`functionSize.enforce`; behavioural tests with real git repositories, as
`test/complexity-signal.test.js` does.)*

## Acceptance Criteria

- [x] A function whose start line is added is measured as new unless its
      base line was itself a function start with the same name; a new
      function over the bar fails under `enforce` even when its hunk also
      replaces a base line (the review's `// doc` + `fresh()` case).
- [x] A function touched only by deletions (a removed line inside its base
      span, e.g. the closing brace and header between two functions removed
      to inline a helper) is measured, and its growth past the bar fails.
- [x] A diff header the parser cannot read (git's C-quoted paths: `"`, `\`,
      tab, newline) is not skipped silently: the path is unquoted, or the
      check reports `unavailable` under `enforce`; a stale path from the
      previous file never carries over.
- [x] Under `enforce`, no merge base means the check is `unavailable` (not a
      pass), or it diffs against the configured `baseBranch`/first parent —
      the module's own rule that a check that could not run is never a pass.
- [x] A long function moved unchanged from one existing file to another is
      not reported as grown (matched by name among the touched files).
- [x] Whether skipping coverage can switch the ratchet off under `enforce`
      (`evidence.js`, `commandsOk && !skipCoverage`) is checked; if it can,
      it reports `unavailable` instead.
- [x] Existing tests stay green, unmodified; functions stay ≤ 80 lines.
      CHANGELOG `[Unreleased]` → Fixed.

## Out of Scope

- Changing the bar (80 lines, CRAP 30).

## Result

Verified 2026-11-14 in the story's worktree: 3 commands green, coverage 93.5 %
of 232 added lines, scope story (5 files), evidence
`.coding-flow/runs/2026-11-14T05-29-59-326Z-verify.json`. Tests:
`test/complexity-new-function.test.js` (9, red first at `645df3b`, one a
regression guard); the existing complexity tests are unchanged and green. The
review's reproduction script now gives the expected verdict for every case
(B: `fresh 0→100`; J: `a 54→101`; A: the quoted path's growth; D: no report).
Decisions in `plan.md`.

Review fixes (2026-11-14, review FAIL: one P1, a regression): real Node lcov
names (`anonymous_0`, `exports.build`, a constructor under its class name) now
match their replaced start line, and a move borrows only from a function
removed whole. Tests `e0e3b68` (red first, one driving a real
`node --test --experimental-test-coverage` lcov), fix `ebdebef`. Re-verified:
3 commands green, coverage 95.6 % of 252 added lines, evidence
`.coding-flow/runs/2026-11-14T05-39-41-006Z-verify.json`.

### Rollback Notes

Revert the fix commit (`bin/lib/complexity.js`); the check falls back to the
positional mapping and the HEAD fallback. No data or config changes.

