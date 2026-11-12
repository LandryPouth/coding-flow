# Story 24-05 — Verify runs on a trusted runner

## User Value

In team mode, the proof a merge waits for is a verify run on a runner the
team trusts, not the evidence file on someone's laptop: `ai-flow ci` runs
verify for the PR's stories and re-checks the evidence the PR claims, and the
PR shows both.

## Requirements

- `ai-flow ci --verify-claims`: for each story the PR touches, runs `verify
  --story` on the runner (config commands only, never `plan.md` commands —
  story 10-02), and compares with the evidence file committed or attached in
  the PR (treeToken, storyDigest, verdict).
- Outcomes per story: `confirmed` (runner green, claim matches), `claim
  mismatch` (claim green, runner red, or tree differs), `no claim`.
- A GitHub Actions workflow template (`templates/.github/workflows/
  coding-flow-verify.yml`, opt-in via `ai-flow ci init`) runs it on
  `pull_request` with read-only permissions and posts a check summary.
- The PR body section written by `ship` gains the runner result when
  available.
- Runner evidence is written to the job's artifacts, not committed.

## Acceptance Criteria

- [ ] Given a PR whose committed evidence says green and a runner verify that
      is red, then the outcome is `claim mismatch` and the job fails.
- [ ] Given matching claim and runner green, then `confirmed`.
- [ ] Given a story with `plan.md` commands only, then the runner refuses to
      execute them and reports `no runnable commands`.
- [ ] Given the workflow template, then it uses `permissions: contents: read`
      (plus checks write) and `pull_request`, never `pull_request_target`.

## Edge Cases

- Fork PRs: run without secrets; stories needing secrets report `skipped
  (secrets)`, never green.

## Out of Scope

- Other CI providers (documented as follow-ups).

## Security

- **Untrusted code**: PR code runs in CI; `pull_request` (no secrets for
  forks), never `pull_request_target`; read-only token.
- **Commands**: only from the base branch's `config.json` when the PR changes
  `config.json` validation commands (a PR cannot redefine its own checks);
  plan.md commands never run.
- **Forgery**: a committed evidence file is a claim; only the runner's verdict
  is proof; mismatches fail the job.
- **Secrets**: none needed for verify; if a project adds some, they are not
  exposed to fork PRs.
