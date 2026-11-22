# Story 21-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Depends on**: 21-02 (its end-to-end check waits for the vault path; the
  code runs against a temp vault in tests).
- **Likely files**: `bin/lib/vault.js` (read side), `bin/lib/insights.js`,
  `bin/lib/patterns.js` (new), `test/insights-all.test.js` (new).
- **Search anchors**: `vault.write`, `insights --json`.
- **Scout pre-step**: no.
- **Areas to avoid**: the sanitizer (21-02).

## Technical Notes

- Pattern keys must be cross-project stable: categories and normalised test
  file basenames, never absolute paths.

## Decisions

- **Two projects = tool problem**: the maintainer's own rule ("vu dans bethl,
  ai-learn et coding-flow").

## Test Plan

Temp vault with two or three fixture projects.

## Acceptance Traceability

- 1–4 → `test/insights-all.test.js`

## Commands

```bash
npm test
```
