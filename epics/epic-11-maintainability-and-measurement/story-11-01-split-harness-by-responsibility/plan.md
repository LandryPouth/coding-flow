# Story 11-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Order of extraction** (leaves first): harness config primitives →
  `security-policy` → `diff-scope` → `risk` → `validation-run` →
  `coverage-gate` → `evidence` → `harness-report`.
- **Prerequisite**: epics 05–09 landed (they reshape these functions; moving
  them first would conflict with every one of them).
