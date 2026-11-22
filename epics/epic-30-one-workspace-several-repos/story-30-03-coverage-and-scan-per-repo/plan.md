# Plan — 30-03 Coverage and scan per repository

## Implementation Context

- Mode: STANDARD. Scout: no.
- Likely files: `bin/lib/coverage-gate.js`, `bin/lib/coverage.js`,
  `bin/lib/diff-scope.js` (`changedFilesForCoverage(root, scope)` already takes
  a root — pass the repository path), `bin/lib/scan.js` (29-01), evidence
  fields in `bin/lib/evidence.js`, `bin/lib/workspace.js`.
- Avoid: merging repositories' diffs into one list (that is the bug this
  story prevents).

## Decisions

- Assumption (unconfirmed): a `## Test Exemption` line without a `name:`
  prefix applies to every repository of the story.

## Test plan

- Fixture workspace from 30-01 plus lcov fixtures per repository; cases =
  acceptance criteria.

## Acceptance Traceability

_(to fill)_

## Commands

```bash
npm test
```
