# Plan — 31-02 The reviewer reads one pack

## Implementation Context

- Likely files:
  - a new `bin/lib/review-pack.js`, wired into the CLI under `review`;
  - it reuses 31-01's findings reader and its start-commit and merge-base
    logic;
  - `templates/.claude/skills/flow-review/`, `evals/cases/flow-review.json`;
  - CHANGELOG.
- Search anchors:
  - `review capture` in the CLI;
  - the diff-scope helpers used by `verify` (`diff-scope.js`);
  - any existing function-name extraction (`coverage-gate.js` or the CRAP
    check).
- Execution mode: STANDARD. Scout pre-step: no.
- Avoid: the guard; `review capture`'s evidence format.

## Decisions

- D1: function names come from the hunk headers git already computes
  (`git diff -U0 --function-context` or `diff=javascript`), not from a parser.
  That keeps runtime dependencies at zero, and other languages degrade to hunk
  headers.
- D2: the cut is per file, largest first. Reviewers mostly need the small
  files whole, and the large ones by hunk.
- D3: `--blind` is the default in the skill's guidance, but not in the
  command. A human running the command wants the findings.

## Test Plan

`node:test` on `mktemp -d` repositories: base merges, a generated
`skills/` file, a lockfile, a large diff for the budget, `--file`, `--blind`
and `--findings-only`, a binary file, a rename.

## Acceptance Traceability

(filled by `/flow-run`)

## Commands

```bash
npm test
```
