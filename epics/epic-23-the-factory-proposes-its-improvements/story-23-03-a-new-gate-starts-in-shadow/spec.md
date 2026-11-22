# Story 23-03 — A new gate starts in shadow

## User Value

A gate can be added in shadow mode: it evaluates on every verify and logs
`gate.fired` with `mode: shadow`, never blocks, and after N runs `insights`
shows its precision — so a new gate is judged on evidence before it can stop
anyone's story.

## Requirements

- `harness.json` gate entries accept `mode: shadow | blocking` (default
  `blocking` for existing gates — unchanged behaviour).
- In shadow: the gate runs, its verdict is recorded as `gate.fired {mode:
  shadow, outcome}` and printed as one informational line; verify's verdict
  and exit code ignore it.
- `insights` shows per shadow gate: fired, then test added / exempted /
  overridden / no change (21-04 semantics), and "ready to review" after
  `shadowMinRuns` (default 20).
- Promotion is a human edit of `mode` (a maintainer-question by 23-02).
- `doctor` lists shadow gates and their run counts.

## Acceptance Criteria

- [ ] Given a shadow gate that fails, when verify runs, then verify passes and
      a `gate.fired` event with `mode: shadow` exists.
- [ ] Given the same gate in `blocking`, then verify fails.
- [ ] Given an existing `harness.json` without `mode`, then behaviour is
      unchanged.
- [ ] Given 20 shadow runs, then `insights` marks the gate ready to review.
- [ ] Given a driven agent editing `harness.json` `mode`, then the guard
      denies it (harness config is protected from driven runs).

## Edge Cases

- A shadow gate that crashes: recorded as `outcome: error`, still never
  blocks.

## Out of Scope

- Choosing which gates to add.

## Security

- **Bypass risk**: shadow must never become a way to disable an existing gate:
  switching an existing blocking gate to shadow is a maintainer-question
  (23-02) and a driven agent cannot edit `harness.json` (guard).
- **Evidence integrity**: the shadow verdict is recorded in the same evidence
  file, so it cannot be dropped silently.
