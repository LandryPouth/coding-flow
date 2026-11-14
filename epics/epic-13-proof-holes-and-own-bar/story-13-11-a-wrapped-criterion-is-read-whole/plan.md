# Plan — 13-11 A wrapped criterion is read whole

## Decisions

- **`criterionItems` keeps `text`, adds `whole`.** `text` stays the bullet
  line, so the open-criteria count and `## Deferred Criteria` matching in
  `coverage-gate.js` (a deferred name must *contain* the criterion) behave
  exactly as before; only the drift check reads `whole`.
- **What a continuation is.** A non-blank line indented deeper than the
  bullet, not itself a list item (`-`, `*`, `+`, `1.`, `1)`) nor a heading.
  Blank lines inside the item are skipped (a paragraph after a blank line,
  still indented, belongs to the item, as in Markdown); a line at or left of
  the bullet's indent ends it. Lazy (unindented) continuation lines are not
  read — out of scope with prose criteria.
- **Multiset comparison.** Base and HEAD criteria are compared as lists with
  multiplicity, so dropping one of two identical criteria is reported.
- **Pairing.** Every removed × added pair is scored by word Jaccard
  similarity; the best pairs are taken first, and only at ≥ 0.5 shared words.
  Unpaired: `old → (removed)` and `(added) → new`. The old order-based pairing
  could pair unrelated criteria and never showed an added one.
- **`## Spec Change` comment stripping** reuses the `## Policy Change` rule
  (an unclosed comment hides the rest).
