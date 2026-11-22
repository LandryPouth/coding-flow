# Story 23-04 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/experiments.js` (new), `bin/lib/proposals.js`,
  `bin/lib/config.js` (`experiments.*`), `evals/benchmark/run.js` (`--flag`),
  `docs/experiments/` (format reference), tests `test/experiments.test.js`
  (new).
- **Search anchors**: `evals/benchmark`, `docs/experiments`, `proposal.*`.
- **Scout pre-step**: no.
- **Areas to avoid**: the benchmark's scoring.

## Technical Notes

- Reuse the format of existing `docs/experiments/*.md`.

## Decisions

- **The tool suggests, the maintainer ends**: verdicts are recorded by a
  human command.

## Test Plan

Fixture insights before/after; benchmark flag with a stub runner.

## Acceptance Traceability

- 1–4 → `test/experiments.test.js`
- 5 → `test/benchmark-flag.test.js` (new)

## Commands

```bash
npm test
```
