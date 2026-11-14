# Story 13-11 — A wrapped criterion is read whole

## Status: in-progress

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

- [x] A criterion is its bullet line plus every following line indented
      deeper than the bullet — wrapped words, plain sub-steps, a fenced
      block read whole — up to the next checkbox, a heading, or a line at or
      left of the bullet, whitespace-normalised. Rewording a word on a continuation line, or
      adding a clause on a new continuation line, raises `criteria-changed`
      (tests with the reworded word on the continuation line).
- [x] Re-wrapping a criterion without changing its words, and ticking it,
      stay silent (CRLF included).
- [x] A `## Spec Change` that holds only an HTML comment or whitespace is
      not a reason, as for `## Policy Change` (`coverage-gate.js`); strict
      still fails.
- [x] The report pairs a changed criterion with its most similar old one,
      or lists removed and added criteria apart when no pair is clear; an
      added criterion with no pair is shown. Removing one of two identical
      criteria is reported.
- [x] Open-criterion detection (`coverage-gate.js`, which also reads
      `criterionItems`) behaves as before. Existing tests stay green,
      unmodified. CHANGELOG `[Unreleased]` → Fixed.

## Spec Change

Criterion 1 reworded after the independent review (P1-1): "not itself a list
item" would have let a criterion's plain sub-steps (story 16-02's "see it
fail") change unseen; a deeper-indented sub-step now belongs to the
criterion.

## Out of Scope

- Criteria written as prose paragraphs rather than list items.

## Result

- `bin/lib/spec-drift.js`: `criterionItems` returns `whole` (bullet plus
  continuation lines); drift compares `whole` as a multiset and pairs by word
  similarity. `bin/lib/coverage-gate.js`: comment-only `## Spec Change` is no
  reason.
- Tests: `test/criteria-drift.test.js`, 9 new cases (reworded continuation
  word, added clause, strict failure, re-wrap + tick + CRLF silent, nested item
  and heading not absorbed, comment-only Spec Change, pairing, no-pair, removed
  duplicate), then 6 from the review (sub-step removed under strict,
  sub-step reworded, list-marker re-wrap silent, indented sub-heading, fenced
  block, tab indent), then 2 from the re-review (unclosed fence and a
  four-backtick fence leave the next criterion open). Existing cases unmodified; `test/acceptance-criteria.test.js`
  green.
