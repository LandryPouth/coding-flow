# Plan — 13-11 A wrapped criterion is read whole

## Decisions

- **`criterionItems` keeps `text`, adds `whole`.** `text` stays the bullet
  line, so the open-criteria count and `## Deferred Criteria` matching in
  `coverage-gate.js` (a deferred name must *contain* the criterion) behave
  exactly as before; only the drift check reads `whole`.
- **What a continuation is** (revised after review P1-1). Every non-blank
  line indented deeper than the bullet belongs to the criterion — wrapped
  words and plain (non-checkbox) sub-steps alike, so removing a step such as
  16-02's "see it fail" is a change. A checkbox line starts its own
  criterion; a heading (up to 3 spaces of indent) or a line at or left of the
  bullet's indent ends it. A fenced block (``` or ~~~) inside a criterion is
  read whole up to its closing fence. Tabs count as 4 columns.
- **Accepted limits (review P2-4, P2-6, P2-7).** Lazy (unindented)
  continuation lines are not read — out of scope with prose criteria. An
  indented paragraph after a blank line is merged into the criterion above
  it, as Markdown renders it. A criterion added alone now raises
  `criteria-changed` (`(added) → new`), where the old pairing only reported
  removals: adding a requirement is a spec change too.
- **Multiset comparison.** Base and HEAD criteria are compared as lists with
  multiplicity, so dropping one of two identical criteria is reported.
- **Pairing.** Every removed × added pair is scored by word Jaccard
  similarity; the best pairs are taken first, and only at ≥ 0.5 shared words.
  Unpaired: `old → (removed)` and `(added) → new`. The old order-based pairing
  could pair unrelated criteria and never showed an added one.
- **`## Spec Change` comment stripping** reuses the `## Policy Change` rule
  (an unclosed comment hides the rest).
