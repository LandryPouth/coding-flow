# Story 15-05 — Mutation probe, opt-in, high-risk diffs only

**Only if story 15-04 says go.** Otherwise close it with "not built, see
15-04".

## User Value

On a high-risk diff — and on a refactor claim — a project that opts in learns
whether its tests would notice the changed lines being broken, with the
surviving mutants named, before a reviewer has to find the weak assertion by
hand.

## Requirements

As the study's wave 5, unchanged unless 15-04's numbers say otherwise:

- `harness.json` `mutation: { command, maxMutants }` (`command` takes
  `{files}`); off when absent.
- Runs only when the diff risk is `high`, or under `--claim refactor`;
  sites drawn from the diff's added lines; deterministic sampling seeded by
  the tree token; executed in a throwaway worktree (14-03's runner), never in
  the user's tree.
- Evidence `mutation: { killed, survived: [{ file, line, operator }],
  durationMs }`. Survivors are a **contrary signal** under the existing
  `NOT PROVEN` — no new verdict word. A `## Mutation Exemption` names
  equivalent mutants.
- Printed limits: a non-compiling mutant counts as killed in compiled
  languages; equivalent mutants exist; strings and comments are skipped by
  heuristic.

## Acceptance Criteria

- [ ] Given a throwaway repo with a high-risk diff and a test that misses a
      `<` → `<=` change, then the survivor is listed with file and line.
- [ ] Given a `medium` diff and no claim, then no mutation runs.
- [ ] Given the same tree twice, then the same sites are sampled.
- [ ] Given a `## Mutation Exemption` naming a survivor, then the signal is
      excused and the reason recorded.
- [ ] No worktree remains after any run; the user's tree token is unchanged.

## Result
