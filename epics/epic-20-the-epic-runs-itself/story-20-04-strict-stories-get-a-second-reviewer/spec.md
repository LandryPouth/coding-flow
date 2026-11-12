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
- The reviewer emits findings JSON; the CLI records them with `review found
  --from` (18-04), reviewer `process`.
- If any P0/P1/P2: one fix process (`/coding-flow:flow-run` in driven mode
  with the findings as input and the decisions the project allows,
  epic 22); then one verify; then each finding `resolve`d by the fix
  process's notes (`fixed` / `documented` / `rejected` with reason). P3s are
  recorded, fixed if the fix pass chooses.
- Capture: verdict `pass` only if no open P0/P1; else the story is `blocked`
  with the open findings.
- On pass: the CLI writes `## Status: done` (not the agent), runs `worktree
  unlock` and `worktree autoland` (20-02 semantics), and records events.
- STANDARD stories: review is skipped unless `run.reviewStandard: true`.

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
