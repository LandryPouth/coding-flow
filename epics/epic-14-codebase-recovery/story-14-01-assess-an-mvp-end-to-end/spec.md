# Story 14-01 — Assess an MVP end to end

## User Value

A developer types `/flow-recover` in a repository they built fast and left,
and gets `docs/recovery/map.md` and `docs/recovery/findings.md`: the system's
entry points and trust boundaries, and a ranked list of findings, each with a
state and a `path:line` trace — plus, per dimension, what was examined and
what was not. Nothing in the application is modified.

## Requirements

### `ai-flow recover scan [--json]` — the deterministic half (read-only)

- Stack: reuse `bootstrap`'s `scanProject` (ecosystems, workspaces, scripts).
- **Hotspots**: per tracked code file, lines × churn (`git log --numstat`
  added + deleted), top 15; whether any test file sits next to it or imports
  its basename (test map from `testGlobs`).
- **Test map**: test files per top-level code directory; directories with
  code and no test listed.
- **Secrets**: tree scan with `security-policy` (heuristic allowlist applied,
  13-02's fix included); **history** scan of added lines (`git log -p --all
  -U0`) with `exact` patterns only: pattern name, path, first commit, count —
  **never the matched value**, in text or JSON.
- **Tracked sensitive files**: `blockedPaths` / `sensitiveGlobs` that are
  tracked (`.env.example` excepted).
- **Size**: files over 500 lines.
- Bounded: history scan capped (default last 2 000 commits, flag to change),
  duration printed. Exit 0 whatever it finds: it reports, it does not judge.

### `/flow-recover` skill — assess mode

- **Front matter description** that triggers on "I built this with an agent /
  months ago / before launch — what is wrong, insecure, risky" and not on a
  diff review (`flow-review`) or brownfield docs before planning
  (`flow-plan`).
- **Method**: run the scan; then complete the **inventories** per dimension
  (design doc table: security, data, reliability, architecture, operations,
  comprehension), each row ending in a state; stack hints say where to look,
  never what to conclude.
- **States**: `suspected`, `confirmed` (trace of `path:line` steps from input
  to effect), `refuted` (the trace that refutes), `mitigated` (by what, in
  code or deploy config), `accepted` (reason, owner, `Revisit:` date),
  `false-positive` (tool bug — say so), and per dimension `examined /
  tool-checked / not examined`.
- **Dossier format** (`docs/recovery/findings.md`): one `### R-NN — title`
  block per finding with field lines `- State:`, `- Dimension:`,
  `- Severity:` (impact × reachability, one line), `- Location:`
  (`path:line`, one or more), `- Trace:`, `- Next:`; ends with the dimension
  table. `map.md`: entry points, trust boundaries, data stores, external
  calls, critical flows, each with `path:line`.
- **Public repository rule**: check visibility (`gh repo view --json
  visibility`; if unknown, ask); for public or unknown, open security
  findings' trace goes to `.coding-flow/recovery/findings.local.md`
  (git-ignored by the skill), the tracked file keeps ID, title, state.
- **Never**: modify application code in assess; state "secure" or
  "production-ready"; send requests to a deployed system.
- **Fix mode, minimal for now**: one finding per branch, test first, story-less
  `ai-flow verify`; `/flow-review` with Security Deep for a security finding.
  (Red-at-base and refactor claims arrive with s3, s4.)

### Fixture and registration

- `evals/recovery/fixture/`: a ~10-file synthetic Node app reproducing the
  field test — an id route with no owner filter, a caller-controlled fetch, a
  "test-function" endpoint that cannot execute, a secret fallback with
  `NODE_ENV=production` in its Dockerfile, a `password="$(…)"` script, two
  test files that touch neither auth nor ownership — and
  `evals/recovery/expected.md` listing the expected states.
- Registered like every skill: `templates/.claude/skills/flow-recover/`,
  `skills/` via `plugin sync`, `evals/cases/flow-recover.json`,
  `templates/CLAUDE.md` list, `bin/lib/skills.js` listing text,
  `test-support/commands-only-suite.js` `SKILLS`, README / QUICKSTART
  (as an optional, any-time skill, not a workflow stage).

## Acceptance Criteria

- [ ] Given the fixture committed in a throwaway repo, when `ai-flow recover
      scan --json` runs, then it lists the largest/churned file as a hotspot
      with no test, the code directories without tests, the `$(…)` line as
      **not** a secret, and exits 0.
- [ ] Given a throwaway repo where a commit added an AWS key and a later
      commit removed it, then the history section reports the pattern name,
      path and commit, and neither the text nor the JSON output contains the
      key.
- [ ] Given any repository, then `recover scan` writes no file (tree token
      identical before and after) and `--help` acts on nothing.
- [ ] `test/layering.test.js` classifies `recover` as a layer and stays green.
- [ ] `evals/cases/flow-recover.json` has ≥ 3 positive prompts and negatives
      owned by `flow-review` ("is this diff safe to merge") and `flow-plan`
      ("document this repo's architecture before we plan the next feature");
      `node bin/ai-flow.js plugin check` and `test/skill-evals.test.js`
      green.
- [ ] A blind `/flow-recover` assess on the fixture (fresh session, no hint)
      reaches every state in `evals/recovery/expected.md`; the transcript's
      result (states reached, time, tokens) is recorded in this story's
      Result. Anything missed is fixed in the skill text before done.

## Edge Cases

- No git history (fresh clone with `--depth 1`): churn reported as
  unavailable, not zero.
- A monorepo with several ecosystems: scan per member as bootstrap does.
- Binary and > 1 MB files skipped by the secret scan, and counted as skipped.

## Out of Scope

- `status` reading the dossier (s2); proof semantics for fixes and refactors
  (s3, s4); learn mode (s5); scanners (s6); CRAP (s7).

## Result
