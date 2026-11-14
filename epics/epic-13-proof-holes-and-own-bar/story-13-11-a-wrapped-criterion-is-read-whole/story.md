# Story 13-11 — A wrapped criterion is read whole

## Status: planned

Found by the independent review of story 13-05 on `develop` (2026-11-14,
P1). `criteria-changed` compares each acceptance criterion on its first line
only (`bin/lib/spec-drift.js`, `CRITERION` and `criterionItems`): an indented
continuation line is dropped at the base and at HEAD. This repository wraps
its criteria at about 80 columns, so rewording "deny" to "warn" on a
continuation line — or adding "unless Y" on a new one — raises no signal and
a strict run passes.

*(STANDARD — the criteria-drift signal, which lowers a verify verdict;
behavioural tests on throwaway repositories with wrapped criteria.)*

## Acceptance Criteria

- [ ] A criterion is its bullet line plus every following line indented
      deeper than the bullet that is not itself a list item or a heading,
      whitespace-normalised. Rewording a word on a continuation line, or
      adding a clause on a new continuation line, raises `criteria-changed`
      (tests with the reworded word on the continuation line).
- [ ] Re-wrapping a criterion without changing its words, and ticking it,
      stay silent (CRLF included).
- [ ] A `## Spec Change` that holds only an HTML comment or whitespace is
      not a reason, as for `## Policy Change` (`coverage-gate.js`); strict
      still fails.
- [ ] The report pairs a changed criterion with its most similar old one,
      or lists removed and added criteria apart when no pair is clear; an
      added criterion with no pair is shown. Removing one of two identical
      criteria is reported.
- [ ] Open-criterion detection (`coverage-gate.js`, which also reads
      `criterionItems`) behaves as before. Existing tests stay green,
      unmodified. CHANGELOG `[Unreleased]` → Fixed.

## Out of Scope

- Criteria written as prose paragraphs rather than list items.
