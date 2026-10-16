# Story 09-02 — Record cache replays

## User Value

The evidence says whether "tests passed" means "the tests ran" or "turbo
replayed a previous run", so the developer can stop forcing a full run on
every verify and force it only where it matters.

## Requirements

- After each validation command, inspect its full output (not only the
  stored tail) for:
  - turbo: `Cached:\s+(\d+) cached, (\d+) total` → `full` when equal,
    `none` when 0, else `partial`; `>>> FULL TURBO` → `full`;
  - nx: `Nx read the output from the cache` / `[existing outputs match the
    cache` / `[local cache]` → `partial` or `full` from the summary line when
    present.
  Otherwise `unknown`. Store as `results[i].cache`.
- `verify` output: `npm run test — ok (replayed from cache: 12/12 tasks)`.
- `harness.json` `freshTestsFor: ["high"]` (default `[]`): for those risk
  levels, a validation command whose result is `full` replay does not count
  as executed proof → `ok: false` with the advice to re-run with the tool's
  force flag (or `verify --no-cache` + config `validation.freshCommands`
  alternative, see below).
- `config.json` `validation.freshCommands` (optional): commands used instead
  of `validation.commands` when the story's risk is in `freshTestsFor`
  (e.g. `npm run test -- --force`). This replaces bethl's "force on every
  run".

## Acceptance Criteria

- [ ] Fake command printing a turbo summary `Cached: 5 cached, 5 total` →
      `cache: "full"`; `2 cached, 5 total` → `partial`; no summary →
      `unknown`.
- [ ] `freshTestsFor: ["high"]`, high-risk story, full replay → `ok: false`
      with advice; with `freshCommands` configured, those run instead and
      `ok: true`.
- [ ] Low-risk story with full replay → `ok: true`, output says replayed.
- [ ] The cache state is part of the evidence JSON and of `ship`'s PR body
      evidence section.

## Edge Cases

- ANSI colour codes in turbo output: strip before matching.
- Output larger than the tail cap: scan the full buffer before truncating
  (the buffer is already in memory in `runValidationCommand`).
