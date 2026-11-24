# Story 20-04 — STRICT stories get a second reviewer

## User Value

After a STRICT story's verify is green, the driver launches a second,
read-only `claude -p` process on `/coding-flow:flow-review` with only the diff
and the contract, records its findings as found, gives one bounded fix pass if
there are P0–P2 findings, re-verifies once, records outcomes, and — only then
— the tool writes `## Status: done`, unlocks, and autolands. This is exactly
the loop the orchestrator ran by hand on bethl 39-01 → 39-03 (the independent
review found 2 majors on 39-01, 2 on 39-02, 4 P2 on 39-03 that the worker
missed).

## Requirements

- Reviewer process: `claude -p "/coding-flow:flow-review <story>"` with
  `--allowedTools Read,Glob,Grep,Bash(git diff:*),Bash(git log:*)` (read-only
  set, configurable), `--output-format json`, its own turn and budget caps;
  prompt framing adversarial ("find what is wrong; assume the author is
  overconfident"), no worker reasoning passed.
- The reviewer emits findings JSON **through `--json-schema`** (severity
  P0–P3, file, line, scenario, proposed fix; the same schema for the
  crossing review of 24-02 and the epic review of 20-07): the CLI never
  parses Markdown. Output that fails the schema gets one retry, then the
  review is a tool error, not a pass. The CLI records them with `review
  found --from` (18-04), reviewer `process`.
- **Lenses (STRICT)**: `review.lenses` default `["spec", "security",
  "tests"]` for STRICT — one reviewer process per lens, each told only its
  lens; the CLI merges their findings and dedupes by file and line. One
  generalist reviewer otherwise. Lenses queue on agent slots (24-02) like any
  process.
- **Skeptics on P0/P1**: each P0/P1 finding goes to `review.skeptics`
  (default 2) fresh read-only processes asked to refute it with the code.
  A finding is dropped only when every skeptic refutes it; dropped findings
  stay in the record as `refuted` with the skeptics' reasons, never deleted.
  A fix pass spent on a false P1 is the cost this removes.
- If any P0/P1/P2: one fix process (`/coding-flow:flow-run` in driven mode
  with the findings as input and the decisions the project allows,
  epic 22); then one verify. P3s are recorded, fixed if the fix pass chooses.
- **Review rounds (added 2026-11-22).** A fix is never judged by its fixer's
  notes, nor by the reviewer that found the defect (it ticks its own list
  instead of looking). After each fix pass a **new** reviewer process (fresh,
  same prompt and read-only tools) reviews the story's **whole** diff blind,
  then receives the open findings and marks each `fixed` or still open with
  the code. A round is clean when it finds no P0/P1.
  - Stop: STANDARD after one clean round; STRICT after **two consecutive
    clean rounds** by fresh reviewers, the second under **another lens**
    (security/bypass, then tests/spec) — the rule epic-run already applies
    and story 19-09's skills state.
  - Cap: `review.maxRounds` (default 4). A story still not clean at the cap
    is `blocked` with reason `review-not-converging` and its open findings:
    the story is too large or its design is fragile — split it, not review
    it again.
  - Each round records `review.round` (round number, lens, P0/P1/P2 found,
    how many are new versus already known) so 21-04 can say what each extra
    round buys.
- Capture: verdict `pass` only once the stop rule holds and no P0/P1 is
  open; else the story is `blocked` with the open findings.
- On pass: the CLI writes `## Status: done` (not the agent), runs `worktree
  unlock` and `worktree autoland` (20-02 semantics), and records events.
- STANDARD stories are reviewed too, by one generalist reviewer:
  `run.reviewStandard` defaults to `true` (maintainer practice on bethl: an
  independent review on every story found defects on most of them); QUICK
  and FAST stories are not reviewed. A project sets `false` to save the
  spend.

## Acceptance Criteria

- [ ] Given a STRICT story green after implementation and a stub reviewer
      returning one P1, when the run continues, then a fix process runs, one
      verify runs, and the finding is resolved before capture.
- [ ] Given a reviewer returning no finding, then the CLI writes `## Status:
      done`, unlocks and calls autoland.
- [ ] Given an open P1 after the fix pass, then the story is `blocked` and not
      done.
- [ ] Given the reviewer process argv, then its tools are read-only and its
      prompt contains the diff reference and story path but no worker output.
- [ ] Given a reviewer output that fails the findings schema twice, then the
      review is a tool error and the story is not done.
- [ ] Given a STRICT story, then three lens reviewers run and their
      duplicate findings (same file and line) are merged into one.
- [ ] Given a P1 both skeptics refute, then it is recorded `refuted` with
      their reasons and no fix pass runs for it; given one skeptic upholding
      it, then it stands.
- [ ] Given a STANDARD story and no `reviewStandard` in config, then one
      reviewer runs.
- [ ] Given a P1 fixed by the fix pass, then a new reviewer process (not the
      one that found it) reviews the whole diff, and the finding is marked
      `fixed` by that reviewer, never by the fix process.
- [ ] Given a STRICT story whose first post-fix round is clean, then a
      second fresh round runs before capture; given a P1 in that round, the
      count of consecutive clean rounds restarts at zero.
- [ ] Given four rounds that each report a new P1, then the story is
      `blocked` with `review-not-converging` and no fifth round runs.
- [ ] Given any round, then a `review.round` event records its counts.
- [ ] Given `status` after a pass, then the review shows reviewer `process`
      with found and open counts.

## Edge Cases

- The fix pass changes code the reviewer flagged as out of scope: verify
  catches regressions; the epic review (20-07) sees crossings.

## Out of Scope

- Epic-wide review (20-07).

## Security

- The reviewer cannot write: tools are read-only and the guard still applies.
- Hostile input: findings JSON is validated (schema, severity enum, file
  inside repo) before recording.
- The tool, not an agent, writes `done`: the guard refuses it from agents
  (20-01).
