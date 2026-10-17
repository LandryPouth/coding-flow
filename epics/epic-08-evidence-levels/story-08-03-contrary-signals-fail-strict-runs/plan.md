# Story 08-03 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/harness.js` — `deletedFilesInDiff` (~1932),
  `scanTestWeakening` (~1960), `printWeakenedTests` (~2207),
  `printOpenCriteria` (~2230), `readAcceptanceCriteria`, evidence assembly
  (~2308); `bin/lib/status.js`; tests.
- **Search anchors**: `weakenedTests`, `acceptanceCriteria`, `unchecked`.

## Result

`evaluateContrarySignals` (`harness.js`) collects deleted test files and open criteria on every green run and judges them under `mode: strict`, or a high-risk story with `failOnContrarySignals: true`; `ok` now also requires `contrary.ok`. Elsewhere they are warnings: summary `passed, with warnings (...)`, `status --json` `warnings`. Escapes lower the claim only: a `## Test Exemption` naming the file (full path, or an unambiguous bare name), `[~]`, or `## Deferred Criteria`. Renames are not deletions (`--find-renames`). Evidence stores `contraryPolicy` (mode, flag, risk inputs) and reuse requires it to match.
An independent adversarial review found loose exemption / deferred matching, a stale-proof hole on the risk inputs, count-only failure details and "FAILED" labels on a not-proven PR body; all fixed with tests.

### Rollback Notes

`git revert` of the story commit. Evidence carrying `contrary` / `contraryPolicy` is ignored by older readers; older evidence is re-run once.

### Known gaps

- `ai-flow worktree land` verifies with coverage skipped, so contrary signals are not judged there (they are per-story, like coverage).
- `run --epic` judges each story on the whole branch diff, so a deleted test fails every story in the batch (same shape as the coverage gate).
- A later plain `verify` can reuse a proof earned with `--test-exemption` (pre-existing, same as the coverage exemption).
