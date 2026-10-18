# Story 13-04 — The bar does not move silently

## User Value

When an agent makes a check pass by loosening the check — a lower coverage
threshold, a disabled lint rule, a relaxed dependency rule, an edited
`harness.json` — the evidence says so, instead of recording a green run
against a lower bar.

## Requirements

- New `policyGlobs` in `harness.json` (default: `**/.eslintrc*`,
  `**/eslint.config.*`, `**/.prettierrc*`, `**/tsconfig*.json`,
  `**/jest.config.*`, `**/vitest.config.*`, `**/.c8rc*`, `**/.nycrc*`,
  `**/.dependency-cruiser.*`, `**/importlinter*`, `**/pyproject.toml`,
  `**/setup.cfg`, `.coding-flow/harness.json`, `.coding-flow/config.json`).
- A diff touching a `policyGlobs` file is a **contrary signal**
  `policy-changed`, listing the files. Warning by default; under strict
  (`failOnContrarySignals` or STRICT risk) it fails unless the story or
  `--policy-change "reason"` declares a `## Policy Change` section, recorded
  verbatim (same shape as `## Test Exemption`).
- These files remain non-behavior for the coverage gate (no test demanded
  for a lint config); the signal is separate.

## Acceptance Criteria

- [ ] Given a branch lowering `minPatchCoverage` in `.coding-flow/harness.json`,
      then the evidence carries `policy-changed` naming the file (warning).
- [ ] Given the same under strict, then verify fails; with a `## Policy
      Change` section it passes and the reason is in the evidence.
- [ ] Given a branch adding a rule to `.eslintrc.json`, then the same signal
      (direction is not judged: tightening is also reported, and costs one
      sentence).
- [ ] Given no policy file in the diff, then no signal and no change to any
      existing verdict.

## Edge Cases

- `package.json` is not in the defaults (too noisy: every dependency bump).
  A `"jest"` key inside it is out of scope.

## Result
