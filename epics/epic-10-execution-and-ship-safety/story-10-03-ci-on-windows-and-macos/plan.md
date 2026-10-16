# Story 10-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `.github/workflows/test.yml`, tests that fail on the new
  runners, `README.md`.
- **Technical notes**: iterate with a draft PR (`gh pr create --draft`) and
  `gh run watch`; the suite is zero-dependency, no install step.
