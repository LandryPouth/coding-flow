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
- **Completeness critic**: after the epic review, one fresh read-only
  process (role `critic`, `--json-schema`) is asked only "what is missing?":
  a criterion ticked with no proof behind it, a `## Browser Check` never
  observed, a risk handed on by a review and never resolved, a maintainer
  to-do with no owner, a story `done` whose notes say "not checked". Each
  item lands in the report; an unproven criterion reopens its story as
  `blocked`, the rest are listed.
- `REPORT.md` (rewritten after every story and at the end of every run that
  touches the epic — the maintainer can open it mid-run):
  - delivered stories, each with verify rung (`verified` / `evidence` /
    `exempted`), retries, review origin and found/open counts;
  - decisions taken alone (`decide-and-note`, from 22-01 events when present;
    otherwise the stories' `## Decisions` added during the run);
  - `Needs you` questions, grouped;
  - maintainer to-do (copied from the epic index section of that name);
  - cost, wall time, attempts, flaky retries (19-02);
  - what was not verified (browser tier open, manual checks);
  - **nothing dropped silently**: every cap that cut something — attempts
    exhausted, budget stop, findings `refuted`, skipped dependents, tiers not
    run, critic items — listed with its reason.
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
- [ ] Given a story whose criterion is ticked with no proof, when the critic
      runs, then the story is reopened `blocked` and the report names the
      criterion.
- [ ] Given a run stopped by its budget, then the report's "nothing dropped
      silently" section names the stories not started and why.
- [ ] Given a configured vault, then the report is mirrored; given none, the
      run still succeeds.

## Edge Cases

- An epic partially done: the report is written with what exists and says the
  epic review did not run yet.

## Out of Scope

- Production release (stays human).
