# Story 13-03 — Coding Flow proves itself at `verified`, and its security core runs STRICT

## User Value

The tool's own claim — "proof, not the agent's word" — holds at its strongest
rung on its own repository, and a change to the code that decides what an
agent may write gets the independent review STRICT demands.

## Requirements

- **lcov in this repository's validation.** `.coding-flow/config.json`
  `validation.commands` runs the suite with native coverage writing
  `coverage/lcov.info` (a path already in the default `coverageReports`):
  `node --require ./scripts/test-env-guard.js --test
  --experimental-test-coverage --test-reporter=spec
  --test-reporter-destination=stdout --test-reporter=lcov
  --test-reporter-destination=coverage/lcov.info`. `coverage/` git-ignored.
  `npm test` (and CI, which runs it on Node 18/20/22) is unchanged.
- **The security core is high-risk here.** This repository's
  `.coding-flow/harness.json` `highRiskPaths` gains `bin/lib/guard.js`, `bin/lib/harness.js`,
  `bin/lib/security-policy.js`, `bin/lib/policy.js`,
  `bin/lib/coverage-gate.js`, `bin/lib/evidence.js`, `bin/lib/identity.js`,
  `bin/lib/policy-fingerprint.js`, `templates/.opencode/**` (the generated
  guard plugin), `bin/lib/opencode.js`, `bin/lib/codex-settings.js`, `bin/lib/codex-probe.js` — the files that decide a denial or a proof.
- **Evidence is not writable by the agent's tools, by default.** The default
  `blockedPaths` gains `.coding-flow/runs/**` and `.coding-flow/ledger.jsonl`.
  The CLI writes them through `fs`, which the guard never judges; an agent's
  Write/Edit or a shell redirect into them is denied. Existing installs whose
  `harness.json` lists `blockedPaths` explicitly are told by `doctor`, not
  rewritten.

## Acceptance Criteria

- [x] Given this checkout, when `ai-flow verify` runs on a branch adding a
      tested line in `bin/lib/`, then coverage tier is `verified` (diff-lines
      from a fresh `coverage/lcov.info`).
- [x] Given a branch touching `bin/lib/guard.js`, then the evidence risk is
      `high` and the recommended mode `strict`.
- [x] Given a fresh install in a throwaway repo, when the guard evaluates a
      Write to `.coding-flow/runs/x-verify.json` or `echo {} >
      .coding-flow/ledger.jsonl`, then both are denied; `ai-flow verify`
      still writes its run file.
- [x] Given an install whose `harness.json` has an explicit `blockedPaths`
      without the new entries, then `doctor` reports a warning naming them
      and the file is not modified.
- [~] `npm test` green on Node 18 (the lcov command is only in
      `validation.commands`, run by `verify` on the maintainer's Node 22).

## Edge Cases

- The lcov reporter needs Node ≥ 20: `verify` on Node 18 here fails the
  command with Node's own error, which is acceptable for this repository's
  maintainer config and must be stated in `docs/contributing.md`.
- A stale `coverage/lcov.info` from a previous run must not count: the
  existing freshness check (report older than the run) applies.

## Out of Scope

- Changing the default `highRiskPaths` for users (they have no `bin/lib/guard.js`).

## Result

Verified here: `Coverage: verified` (100 % of added lines, lcov via native coverage); preflight reads risk `high`, mode `strict` once the security core is in `highRiskPaths`; the guard refuses Write and redirects into `runs/` and the ledger; `doctor` warns (glob-aware) without rewriting. Criterion 5 left `[~]`: only Node 22 is installed here, Node 18 was not run (CI covers it; the lcov command is only in `validation.commands`).

Deviations: a `mkdir coverage` prep command (Node does not create the report directory) and `timeoutMs: 1200000` on the coverage run (the suite takes 5-8 min under load here). The two evidence entries are exempted from the commit-time blocked-path check (`ship` commits run files on purpose) and from the Codex sandbox profile/probe (the sandbox would also bind `ai-flow verify`): on Codex the proof stays writable; the guard refuses writes, not deletions. Independent review found no blocker; its fixes (glob-aware doctor, Codex limit stated, tests, extra highRiskPaths) are in.

### Rollback Notes

`git revert`; existing installs' `harness.json` is never rewritten, so nothing to undo on their side.

## Status: done
