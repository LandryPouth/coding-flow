# Story 20-07 — The epic ends with a review and a report

## User Value

When the last story of an epic is done, the driver reviews the whole epic's
diff in a fresh process — the bugs between stories were only ever found by
the epic-wide review, done by hand each time on bethl (bilan) — and writes
`epics/<epic>/REPORT.md`, the one page the maintainer reads instead of every
story.

## Requirements

- Epic review: a read-only `claude -p "/coding-flow:flow-review --epic
  <epic>"` over the diff from the epic's base to its branch tip, given the
  epic `index.md` as the contract; findings recorded (reviewer `process`,
  scope `epic`). P0/P1 findings → one fix process on the epic branch, one
  verify of the epic (all required tiers), resolve, capture.
- `REPORT.md` (rewritten at the end of every run that touches the epic):
  - delivered stories, each with verify rung (`verified` / `evidence` /
    `exempted`), retries, review origin and found/open counts;
  - decisions taken alone (`decide-and-note`, from 22-01 events when present;
    otherwise the stories' `## Decisions` added during the run);
  - `Needs you` questions, grouped;
  - maintainer to-do (copied from the epic index section of that name);
  - cost, wall time, attempts, flaky retries (19-02);
  - what was not verified (browser tier open, manual checks).
- Mirrored to the vault when one is configured (21-02); skipped otherwise.
- The `/flow-review` skill accepts `--epic` (diff range and contract).

## Acceptance Criteria

- [ ] Given an epic whose stories are all done, when the run ends, then an
      epic review process runs over the epic diff with the index as contract.
- [ ] Given an epic review P1, then one fix process and one epic verify run
      before capture.
- [ ] Given the end of a run, then `REPORT.md` lists every story with rung,
      retries, review origin and counts, the questions, the to-do and the
      cost.
- [ ] Given a configured vault, then the report is mirrored; given none, the
      run still succeeds.

## Edge Cases

- An epic partially done: the report is written with what exists and says the
  epic review did not run yet.

## Out of Scope

- Production release (stays human).
