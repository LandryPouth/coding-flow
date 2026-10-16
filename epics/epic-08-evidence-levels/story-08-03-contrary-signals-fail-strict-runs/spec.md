# Story 08-03 — Contrary signals fail strict runs

## User Value

"3 test files deleted, 13 assertions removed" and "5 of 9 acceptance criteria
unchecked" stop sitting under a green verdict in the projects that asked for
strictness, and stand out in the others.

## Requirements

- In `mode: strict`, or when the story's combined risk is `high` **and**
  `harness.json` `failOnContrarySignals` is true (default false in standard):
  - `weakenedTests` entries with signal `deleted` → `ok: false` unless the
    story has a `## Test Exemption` section or `--test-exemption` mentions
    the removal;
  - `assertions-removed` → warning only (refactors move assertions; the
    detector is a regex — see `harness.js` comments);
  - unchecked acceptance criteria → `ok: false` with the list, unless the
    criterion line is marked deferred (`- [~]`, the convention bethl already
    uses in `tasks.md`) or the story has `## Deferred Criteria` naming it.
- In standard mode: unchanged verdict, but `verify`'s summary line becomes
  `passed, with warnings (3 deleted test files, 5 open criteria)` instead of
  `passed`, and `status` shows a warning marker.
- These signals are computed on the story scope (epic-07); this story must
  not land before 07-01.

## Acceptance Criteria

- [ ] strict + a deleted `*.test.ts` in the story diff + no exemption →
      `ok: false`, reason lists the file.
- [ ] strict + same + `## Test Exemption` mentioning the file → `ok: true`.
- [ ] strict + assertions removed only → `ok: true` with warning.
- [ ] strict + 2 unchecked criteria → `ok: false`; marking one `[~]` and
      the other `[x]` → `ok: true`.
- [ ] standard + the same inputs → `ok: true`, summary says "with warnings",
      `status --json` exposes `warnings: { deletedTests, openCriteria }`.

## Edge Cases

- A story without acceptance criteria (no spec) → no criteria signal.
- Renamed test files (git rename detection) are not "deleted" — use
  `--find-renames` in `deletedFilesInDiff`.
