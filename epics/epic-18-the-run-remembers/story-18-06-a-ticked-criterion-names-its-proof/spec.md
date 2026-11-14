# Story 18-06 — A ticked criterion names its proof

## User Value

In a driven run (and whenever the project asks for it), a ticked acceptance
criterion must point at proof: a test named in `## Acceptance Traceability`
whose file ran green in this verify, or a dated observation for what no test
can see (a browser check). A box ticked on faith is reported and, when
enforced, fails the run. On bethl epics 37–39 criteria were ticked before
verify, and 39-03's reviewer found two ticked criteria with no test that could
have proven them (P2-4).

## Requirements

- `## Acceptance Traceability` lines are parsed: `<criterion numbers> →
  <file>::<test name>` (several targets allowed) or `<n> → observed
  YYYY-MM-DD: <what was seen>`.
- For each ticked criterion, verify checks that at least one target file is
  among the files the validation commands ran (from the runner output or the
  coverage report when present) and that the command was green; an
  `observed` line needs a date not older than the story's last code change.
- Outcome per criterion: `proven`, `observed`, `unproven` (ticked, no valid
  target), `open` (unticked). Printed after the commands; recorded in
  evidence.
- Enforcement follows design-decisions entry 9 as amended by 08-03: surfaced
  by default; fails the run when `mode: strict`, when
  `failOnContrarySignals` applies, or when `AI_FLOW_DRIVEN` is set
  (20-01). Entry 9's direction rule holds: this can only lower the claim.
- A criterion with no traceability line at all is `unproven` when ticked.
- `/flow-run` prose: tick a criterion only after the verify that proves it,
  and write its traceability line.
- **Added 2026-11-14 (epic 29 study of Shipmoor's Claim Check):**
  - A proof run outside verify is declared, not hidden: `<n> → outside
    verify: <file>::<test> — <how it was run>` is its own outcome
    `declared` (bethl 43-01: two ticked criteria proven only by an
    integration test no verify command runs — review P2-7). It is a gap, not
    a proof: it never counts as `proven`.
  - Whether a named test file ran comes from 29-03's `collected` set when
    present (the runner's own list mode), before runner output or lcov.
  - The story gets one criteria verdict, printed after the outcomes:
    `Criteria: READY` (every ticked criterion `proven`), `READY WITH GAPS`
    (some `observed` or `declared`), `INCONCLUSIVE` (one `unproven`),
    `BLOCKED` (a named test is red). It can only lower the verify verdict.
  - Each criterion not `proven` prints the action that would prove it, e.g.
    `~ 5 unproven — test/x.integration-spec.ts is not run by any validation
    command: add it to one, or declare the row "outside verify"`.
  - Traceability rows without numbers (a table in criterion order, as bethl
    writes them) are matched by position; a row count that differs from the
    criteria count makes every criterion `unproven` with "rows do not match
    the criteria", never a guess.

## Acceptance Criteria

- [ ] Given a ticked criterion whose traceability names a test file the
      commands ran green, when verify runs, then it is `proven`.
- [ ] Given a ticked criterion with no traceability line, when verify runs in
      driven mode, then the run is not green and names the criterion.
- [ ] Given the same story in interactive non-strict mode, when verify runs,
      then the criterion is listed `unproven` and the verdict is unchanged.
- [ ] Given `observed 2026-11-12: …` older than the last code change of the
      story, then the criterion is `unproven`.
- [ ] Given `docs/design-decisions.md` entry 9, then it records this binding
      as a second amendment, enforced on request only.
- [ ] Given a ticked criterion whose row says `outside verify:` with a test
      file and how it was run, when verify runs, then it is `declared` and the
      criteria verdict is `READY WITH GAPS`, never `READY`.
- [ ] Given a ticked criterion with no proof, when verify runs, then the
      criteria verdict is `INCONCLUSIVE` and the criterion prints its next
      action.

## Edge Cases

- Runner output that does not list files (some reporters): fall back to the
  lcov report when present; otherwise `unproven`, never `proven` by guess.
- Criteria numbering: by order in the Acceptance Criteria list, 1-based.

## Out of Scope

- Proving that the named test actually asserts the criterion (review's job).

## Security

The rule only lowers claims; any parse doubt yields `unproven`.
