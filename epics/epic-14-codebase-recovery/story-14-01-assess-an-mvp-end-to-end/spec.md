# Story 14-01 — Assess an MVP end to end

## Status: done

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

- [x] Given the fixture committed in a throwaway repo, when `ai-flow recover
      scan --json` runs, then it lists the largest/churned file as a hotspot
      with no test, the code directories without tests, the `$(…)` line as
      **not** a secret, and exits 0.
- [x] Given a throwaway repo where a commit added an AWS key and a later
      commit removed it, then the history section reports the pattern name,
      path and commit, and neither the text nor the JSON output contains the
      key.
- [x] Given any repository, then `recover scan` writes no file (tree token
      identical before and after) and `--help` acts on nothing.
- [x] `test/layering.test.js` classifies `recover` as a layer and stays green.
- [x] `evals/cases/flow-recover.json` has ≥ 3 positive prompts and negatives
      owned by `flow-review` ("is this diff safe to merge") and `flow-plan`
      ("document this repo's architecture before we plan the next feature");
      `node bin/ai-flow.js plugin check` and `test/skill-evals.test.js`
      green.
- [x] A blind `/flow-recover` assess on the fixture (fresh session, no hint)
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

## Policy Change

`evals/recovery/fixture/**` joins `nonBehaviorGlobs`: the fixture is synthetic
input for `recover scan` and the blind assess, never executed by the suite, so
it must not be judged as product code by the coverage gate. No shipped default
changes.

The fixture's test files are `spec/*.spec.js`, not `test/*.test.js`:
`testGlobs` matches both, but `node --test`'s default discovery (`**/*.test.js`,
`**/test/**`) matches only the latter, so the synthetic app stays out of the
project suite and cannot fail it.

## Result

`ai-flow recover scan` and `/flow-recover` shipped as described. Tests:
`test/recover-scan.test.js` pins the fixture hotspot and test gap, the command
substitution not being a secret, history without the matched value, read-only
and `--help`, unavailable history, skipped binaries/large files and the commit
limit. The blind replay reached every expected state in three iterations (the
first two found skill-text gaps: fallback misread, Data/Reliability over-claimed
and the IDOR downgraded); the final run took 131 s and 42,958 context tokens
(4,731 output). `ai-flow verify` passed (coverage 93.9% of 588 added lines); skill evals 8/8, rank-1 85.2%.

Pre-merge review fixes: the fixture tests were moved to `spec/*.spec.js` so
`node --test` no longer executes them; `collectChurn` collapses git's rename
notation (`old => new`, `dir/{old => new}.js`) so churn lands on the current
path; a tracked file deleted from the working tree is no longer counted as a
skipped binary; and `collectRecoveryScan` no longer exposes a `root` option it
did not honour. `test/recover-scan.test.js` gained a regression test for the
rename and the deleted file (13 tests).

### 2026-10-27 re-verification (this checkout)

The story's green verify was captured where it ran on 2026-10-19; this
checkout has no tagged proof (status: in-progress), so `/flow-run` replayed
it. Two attempts, both red, with the failure decomposed — the story's own
work is not what failed:

- **Suite (environment leak).** With this OpenCode session's env inherited,
  `test/guard.test.js`'s five init/upgrade settings tests fail with
  `ENOENT …/claude/settings.json` — `init` resolves its platform from the
  environment and wires OpenCode instead. Under the documented spell
  (`env -u OPENCODE -u OPENCODE_PID`, tasks.md) the suite passes:
  1209/1209, coverage run 197 s. Logged in docs/DOGFOODING.md.
- **`check-function-size.js` (branch debt, not this story's diff).** The
  gate (13-06, landed after this story's proof) flags six functions grown
  since `main` by 13-03 (`f86b52c`) and 13-04 (`2489e3b`) — coverage-gate,
  doctor, evidence, harness, commands — none of which 14-01's two commits
  (`da3c7f1`, `bc36df3`) touch; `recover.js`'s own functions stay ≤ 80.
  Root cause sits outside story scope, so `/flow-run` stopped rather than
  refactoring five proof files inside this story.

Verify evidence from the clean-env replay: `.coding-flow/runs/
2026-10-27T14-01-09-313Z-verify.json` — `Status: blocked` reflects a branch
that cannot pass its current bar until the six-function debt is paid (its
own refactor, belongs with 13-03/13-04's replay or 13-06's story), after
which this story's verify should replay cheap and land.

### 2026-10-27 review fixes

The re-review's one P2: a shallow clone (`--depth 1`) reported churn as
**available** — the one commit's numstat ranks every file by its full size
(lines²), where the edge case above and the skill text promised
"unavailable, never zero". `collectChurn` now returns unavailable when
`git rev-parse --is-shallow-repository` says the clone is shallow
(unsupported gits fail open); the history section still covers the commits
the clone has. Pinned red-first by a regression test in
`test/recover-scan.test.js` (14 tests), and the review pass itself is
captured in `.coding-flow/runs/2026-10-27T14-18-47-730Z-review.json`
(verdict pass, 1 P2, 2 P3).

A second review pass the same day (full suite re-run at HEAD, 1210/1210
under the clean env — the first run to include the shallow-clone fix)
closed its two P3s: the history scan streams its patch text through a
temporary file read chunk by chunk, so a 2 000-commit window can no longer
overflow one buffer and memory stays bounded; and `countLines` counts by
streaming, so a tracked code file over 1 MB — skipped only by the secret
scan — is still a hotspot and still reported as large. Regression tests
pin the size report past the cap and the first-commit semantics when a key
is added twice (15 tests).

### 2026-11-07 re-verification (story scope)

The 2026-10-27 replay was red because the gate judged all of `develop`
against `main`, so `check-function-size` flagged six functions grown by
stories 13-03/13-04 — none of them touched by 14-01. This story forked from
`develop` at `4c7280c`, so verify now runs against that fork point (the
diff-base mechanism's story scope), not the whole unreleased branch:

- `env -u OPENCODE -u OPENCODE_PID -u CLAUDE_CODE_SSE_PORT`
  `ai-flow verify --story <this story>` — **passed**: 4 commands, coverage
  95.4% of 695 added lines, scope story against `4c7280c` (38 files).
- Evidence: `.coding-flow/runs/2026-11-07T01-38-20-969Z-verify.json`.

The six-function debt stays with 13-03/13-04/13-06 and is not paid here; it
would otherwise block every verify run on `develop` against `main`.

### 2026-11-07 review fixes (streaming correctness)

The pre-merge review of the streaming change found two aliasing bugs with one
root cause: `streamLines` and `countLines` carried `pending` as a `subarray`
of the reused read buffer, so the next `readSync` overwrote the bytes before
`Buffer.concat` copied them. `streamLines` lost the start of a line spanning a
chunk boundary (a >256 KiB added line hid its AWS key from the history scan);
`countLines` double-counted newlines after a long line (a 70 000-char first
line turned 1 001 real lines into 2 002).

- Both readers now copy the chunk off the reused buffer before carrying it.
  `countLines` carries nothing between chunks at all — it counts newline bytes
  and remembers the last byte — so its memory is constant however long a line.
- A history line longer than the 1 MiB window is emitted in pieces with a
  64 KiB overlapping tail (wider than any credential format), so memory is
  bounded without losing a secret past the seam. The parser records matches
  per line and finalizes at the newline.
- The history temp file moved into `fs.mkdtempSync` (0700 on POSIX) and is
  removed on return, on throw and on process exit: no predictable name in a
  shared temp dir, no patch text left behind by a crash.
- Regression tests: exact line count with a chunk boundary inside a line, and
  a secret on a 1.3 MB history line that exercises the partial/overlap path
  (`test/recover-scan.test.js`, 17 tests).

### 2026-11-07 review fixes (history parser and scan cost)

A second pre-merge pass on the streaming change found that the history parser
read any line starting `+++ ` as a file header, even inside a hunk. An added
line whose content begins `++ ` (git renders it `+++ …`) was therefore
misclassified: a secret on it was never scanned and every later finding in the
hunk was attributed to a bogus path. Reproduced by committing `++ query`
followed by an AWS key — the finding landed under `path: "query"`.

- A `+++ …` line is a header only before the first hunk (`!inHunk`); inside a
  hunk it is an added line and is scanned as content. Regression test: the key
  on the plain line and on the `++ `-prefixed line is reported under the real
  path (`test/recover-scan.test.js`, 20 tests).
- `countLines` and `streamLines` continue on any positive read, so a short read
  can no longer truncate a file's count or the history stream.
- Hotspots and the large-file report read each tracked code file once
  (`measureCodeLines`) instead of twice.
- A temp patch directory left by a hard kill is removed by the next scan (24 h
  threshold, so a live scan's directory is never touched); the skill no longer
  claims the value is "never stored" — it states where the transient file lives.
- A monorepo test pins bootstrap's member detection and that every member's
  code is scanned.

### 2026-11-07 review fixes (honest scope and quoted paths)

A third pre-merge pass found that a scan which could not see the tree still
read as clean, and that git's C-quoting hid non-ASCII paths from churn and
history.

- When git is unavailable, the text report says `unavailable — no tracked
  files` for hotspots, the test map, tree secrets, tracked sensitive files and
  large files instead of `none`; `secrets.tree.available` carries the same fact
  in JSON and the history section says `not examined`. The skill now writes
  those dimensions `not examined`, never `clean`.
- Git C-quoted paths are decoded as UTF-8 bytes (`caf\303\251.js` →
  `café.js`), so churn lands on the real path and a history finding names a
  path that exists. Renames keep both the arrow (`"old" => "new"`) and braced
  (`dir/{old => new}.js`) forms.
- `compileSecretPatterns` runs once and its invalid entries are surfaced as
  `secrets.invalid` (named in the text): a detector that does not compile now
  reports the defect instead of scanning nothing silently.
- Regression tests: non-ASCII churn and history trace, braced rename, a key
  straddling a stream piece boundary (verified to fail with a zero overlap),
  text-mode git-unavailable, and an invalid detector. The shallow-clone test
  builds its URL with `pathToFileURL` so it is valid on Windows.
  `test/recover-scan.test.js` is now 25 tests.
