# Story 03-03 — Fix the branch-per-epic policy hint

## Context

`bin/lib/status.js:197-198` prints, when `branchPerEpic` is enforced and the
checkout is on the base branch: *"Create one branch per epic (e.g. `ai-flow
worktree add --story <dir>`)"* — but `worktree add --story <dir>` creates a
worktree/branch named after a *story* directory, not an epic. The example
command contradicts the policy it explains. Fix the text only; the
underlying policy fields (`policy.enforced`, `policy.branch`, `policy.onBase`
in `bin/lib/policy.js`) are correct and unchanged.

## Acceptance Criteria

- [ ] Given `branchPerEpic: true` in `.coding-flow/config.json` and the
      current checkout is on the base branch, when `ai-flow status` prints
      its policy reminder, then the example command it shows creates one
      branch/worktree for the whole epic — not a command scoped to a single
      story.
- [ ] Given the same setup, when `ai-flow status --json` is inspected, then
      the underlying policy fields (`branchPerEpic`, `branch`, `onBase`) are
      unchanged — this story only fixes the printed reminder text, not the
      policy data.

## Commands

```bash
npm test
```

## Result

*(filled by /flow-run after implementation)*
