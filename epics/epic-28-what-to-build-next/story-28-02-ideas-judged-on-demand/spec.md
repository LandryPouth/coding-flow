# Story 28-02 — Ideas judged on demand

## User Value

When the maintainer wants a real opinion on what to build next, one command
reads the scanned candidates and the code in a fresh context, ranks them by
value to the product, and adds the ideas only reading the code can find — a
model nobody uses, a notification type never sent, a page nothing links to —
each one pointing at the file that proves it.

## Requirements

- `/flow-plan --ideas` (section of the `flow-plan` skill, opt-in): reads
  `ai-flow ideas --json`, `docs/project-context.md`, the roadmap and targeted
  code searches; writes at most 3 new ideas and a ranking of the existing
  `proposed` ones back through `ai-flow ideas add` / `ai-flow ideas rank`.
- Every added idea carries `source: repo-observed:<path[:line]>` or
  `user-stated:<date>`; `ai-flow ideas add` rejects a line without one, and
  rejects a path that does not exist.
- Each idea names its riskiest assumption with a Cagan risk type (value,
  usability, feasibility, viability) — one line.
- The ranking is advisory: it reorders the Ideas block of `next`, nothing
  else. No idea is planned by the pass.
- Budget: the pass stops after ~8 searches / ~12 files (the scout budget of
  `/flow-run`) and says so if it stopped early.

## Acceptance Criteria

- [ ] Given `ai-flow ideas add` with no source, when it runs, then it exits non-zero and the ledger is unchanged.
- [ ] Given `ai-flow ideas add` with `source: repo-observed:missing/file.ts`, when it runs, then it exits non-zero.
- [ ] Given a ranking written by `ai-flow ideas rank <id> <id> <id>`, when `next` shows the Ideas block, then it follows that order.
- [ ] Given a fixture repo with an enum value never referenced outside its declaration, when `/flow-plan --ideas` runs (recorded run), then one added idea points at that declaration.
- [ ] Given the pass, when it ends, then no epic or story file was created.

## Out of scope

- Web research, user interviews, personas.
