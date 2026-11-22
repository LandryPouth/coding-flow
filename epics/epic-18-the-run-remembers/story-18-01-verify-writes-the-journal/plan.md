# Story 18-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD. New file writes beside existing evidence; no
  change to verdicts.
- **Likely files**:
  - `bin/lib/events.js` (new);
  - `bin/lib/harness.js` and `bin/lib/evidence.js`: where `verifyStoryOnce`
    starts and `writeVerifyEvidence` finishes; `harnessRunsDir` for the
    location;
  - `bin/lib/report.js` (`reportCommand`): the new section;
  - `docs/agent-contract.md`; `test/events.test.js` (new),
    `test/report.test.js`.
- **Search anchors**: `writeVerifyEvidence`, `harnessRunsDir`,
  `verifyStoryOnce`, `reportCommand`, `normalizePortable`.
- **Scout pre-step**: no.
- **Areas to avoid**: the verdict logic in `evidence.js`; the guard's module
  graph (`test/guard.test.js` pins what `guard` loads — `events.js` must not
  be required on the guard path).

## Technical Notes

- Append with `fs.appendFileSync` of one line ending in `\n`; lines stay
  under PIPE_BUF-ish sizes so concurrent appends in one checkout do not
  interleave.
- `tree` comes from the same treeToken the evidence already computes.

## Decisions

- **One file, not one per run.** A single append-only file is greppable and
  is what `insights` (epic 21) scans; `runs/` stays the per-run proof.
- **Schema version on every line**, so a reader can skip lines from a newer
  writer instead of failing.

## Test Plan

Unit tests on `events.js` (append, read with filters, corrupt line skipped);
an integration test through `verify` on a throwaway repo (as
`test/harness-verify.test.js` does) asserting the two lines; `report` section
asserted in `test/report.test.js`.

## Acceptance Traceability

- 1–2 → `test/events.test.js::verify writes start and end`
- 3 → `test/events.test.js::an unwritable journal never fails verify`
- 4 → `test/report.test.js::recent events section`
- 5 → review of `docs/agent-contract.md`

## Commands

```bash
npm test
```
