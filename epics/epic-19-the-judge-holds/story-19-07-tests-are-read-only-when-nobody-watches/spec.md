# Story 19-07 — Tests are read-only when nobody watches

## User Value

In a driven run, the agent cannot make the judge pass by editing the tests it
is judged by: the guard refuses edits and deletions of test files that exist
at the diff base, unless the story's `## Test Exemption` names the file; new
tests stay free. And when a test contradicts the acceptance criteria, the
agent stops the story with the contradiction written down instead of "making
it pass". ImpossibleBench: up to 54 % cheating when tests and spec conflict;
read-only tests remove test edits at no performance cost (research report).

## Requirements

- When `AI_FLOW_DRIVEN` is set (20-01 sets it; this story defines it), the
  guard treats a write (Edit/Write/MultiEdit, and shell writes it already
  detects via `shell-writes.js`) to a path that matches `testGlobs` **and**
  exists at the diff base (`git cat-file -e <base>:<path>`) as denied, with a
  message naming the rule and the exemption path.
- Exemption: the story's `## Test Exemption` lists the file (exact path) and
  a reason; the guard reads the active story from the driver's env
  (`AI_FLOW_STORY`) — never from agent-supplied input.
- Deleting or renaming such a file is denied the same way.
- Backstop at verify: in driven mode, a diff that modifies or deletes a base
  test file without exemption is a red (`protected test changed`), covering
  writes the guard cannot see (validation commands, fixers).
- `/flow-run` gains the escape hatch: "If a test contradicts the acceptance
  criteria, do not change the test or special-case the code: write
  `## Needs you` with the contradiction and stop." (one line, under 500).
- Denials go to `denials.jsonl` like other guard denials.
- Interactive runs are unchanged.

## Acceptance Criteria

- [ ] Given `AI_FLOW_DRIVEN` and a test file present at base, when the agent
      edits it, then the guard denies and names the exemption path.
- [ ] Given the same file listed in `## Test Exemption`, then the edit is
      allowed.
- [ ] Given a new test file, then writes are allowed.
- [ ] Given no `AI_FLOW_DRIVEN`, then behaviour is unchanged.
- [ ] Given a driven verify whose diff modifies a base test file without
      exemption (e.g. via a fixer), then verify is red with
      `protected test changed`.
- [ ] Given `/flow-run`, then it carries the escape-hatch rule, and skill
      evals stay green.

## Edge Cases

- Snapshot files (`__snapshots__`) count as tests; regenerating snapshots
  needs an exemption naming them.
- The guard's latency budget: the `git cat-file` call happens only when
  driven and only for test-glob paths; measured with interleaved sampling
  (entry 2's method).

## Out of Scope

- Hiding tests from the agent (hurts legitimate performance per the research).

## Security

- Who: only the driver sets `AI_FLOW_DRIVEN`/`AI_FLOW_STORY` in the agent's
  environment; an agent unsetting them in a shell command does not affect the
  guard process, which reads the hook's own environment. Test that a Bash
  command `AI_FLOW_DRIVEN= …` cannot bypass.
- Hostile input: paths normalised and resolved inside the repo before
  matching; symlinks resolved.
- Proof: guard tests + the verify backstop.
