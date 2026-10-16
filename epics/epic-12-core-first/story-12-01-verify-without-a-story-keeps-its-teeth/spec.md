# Story 12-01 — `verify` without a story keeps its teeth

## User Value

Someone who installs only the core (`init --minimal`) and runs `ai-flow
verify` gets the coverage gate and the diff risk, not just exit codes.

## Requirements

- When `verify` runs with no `--story` and no single story can be attributed
  (today: `"not evaluated (no single story to attribute this run to)"`,
  `harness.js` ~2291):
  - resolve the diff base with `resolveDiffBase` (story-07-01) →
    `scope: "branch"`;
  - risk = `scoreDiffRisk` on that diff only (no story risk);
  - coverage gate evaluated on that diff with the same rules and floors
    (epic-08) as a story run;
  - weakening and deleted-test signals computed on that diff.
- Evidence `story: null`, `diffBase.scope: "branch"`; `audit` and `report`
  count branch-scope runs separately from story runs.
- When the branch **is** the default branch with a clean tree and no base
  (`scope: "working-tree"`, nothing changed), coverage is
  `not-required` with reason "no change to evaluate" — not "not evaluated".

## Acceptance Criteria

- [ ] Repo with only `.coding-flow/config.json` (no `epics/`), a feature
      branch adding `src/auth/login.js` without a test → verify fails the
      coverage gate (risk high from the `auth` path), reason names the file.
- [ ] Same with a test file added → passes at `evidence`; with a fresh lcov
      covering the lines → `verified`.
- [ ] On the default branch with a clean tree → `not-required`, "no change
      to evaluate".
- [ ] A repo with stories still attributes to the story when `--story` is
      given (unchanged).
- [ ] `findReusableVerify` handles `story: null` (reuse keyed on base and
      policy as for stories).

## Edge Cases

- Several stories touched on the branch and no `--story`: still branch
  scope (the evidence never guesses a story).
