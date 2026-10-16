# Story 08-04 — Review verdicts that hold

## User Value

A captured "pass" means no blocking finding was left open, and a STRICT story
reviewed only by its own author is visibly so.

## Requirements

- `ai-flow review capture --verdict pass` with `--p0 > 0` or `--p1 > 0` is
  refused (exit 1) unless `--accept "<reason>"` is given; the reason is stored
  as `acceptedRisk` in the evidence.
- `status` shows `review: pass (self)` for STRICT-tier stories whose latest
  fresh review has `reviewer: "self"`; `--json` exposes `reviewer`.
- `ai-flow audit` counts reviews by reviewer kind and lists "pass with
  accepted P0/P1" entries.
- `templates/.claude/skills/flow-review/SKILL.md`: one line in the capture
  step — a pass with open P0/P1 needs `--accept` and the user's agreement.
  (Edit the template, then `node bin/ai-flow.js plugin sync`; update
  `evals/cases/flow-review.json` if the skill's routing text changes.)

## Acceptance Criteria

- [ ] `review capture --verdict pass --p1 1` → exit 1, nothing written.
- [ ] Same with `--accept "tracked in #12"` → written, `acceptedRisk` set.
- [ ] STRICT story with a self review → status shows `(self)`.
- [ ] Audit lists the accepted-risk pass.
- [ ] `plugin check` passes after the skill edit.

## Edge Cases

- Existing review files with pass + P1 (bethl has one) are read as they are;
  audit lists them as "pass with open P1 (pre-0.13)".
