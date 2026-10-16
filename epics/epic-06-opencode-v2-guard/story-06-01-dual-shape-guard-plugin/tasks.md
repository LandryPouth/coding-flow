# Story 06-01 — Tasks

- [x] Map V2 argument names in `toPayloads` (`path`, `shell`, `patch`).
- [x] Add `setup(ctx)` + default export; drop the named export if 1.19 loads
      `server` (check on a real 1.19 first).
- [x] Tests: V1 harness, V2 fake-ctx harness, partial ctx, harmless write.
- [x] Real OpenCode 2.x and 1.19 check with a model (isolated HOME); record the
      prompt, the tool used and the refusal text here.
- [x] `npm test`; `ai-flow verify --story epics/epic-06-opencode-v2-guard/story-06-01-dual-shape-guard-plugin`.
- [x] CHANGELOG `[Unreleased]`.

## Real-host check (2026-10-16)

Setup: a fresh git repo, `ai-flow init --opencode` from this checkout, run
through an `env -i` wrapper with a throwaway `HOME`/`XDG_*`. The model is
`opencode/nemotron-3.5-lightning-free`, so no credentials are needed. V2 runs with
`opencode run --standalone --auto --format json`, V1 with
`opencode run --format json`.

Prompts:

- write: "Use the write tool (not the shell) to create the file .env containing
  exactly A=1. Do not use any other tool. Report the exact error if the tool fails."
- shell: "Run exactly this shell command with the shell/bash tool: echo A=1 > .env
  . Do not use any other tool. …"

| Host | Tool called | Input | Result |
|---|---|---|---|
| 2.0.30 | `write` | `{path: ".env", content: "A=1"}` | refused: `coding-flow guard: .env matches a blocked harness path (.env)…` |
| 2.0.30 | `shell` | `{command: "echo A=1 > .env"}` | refused: `coding-flow guard: this command writes to .env, which matches a blocked harness path (.env)…` |
| 1.19.0 | `write` | `{filePath: "<abs>/.env", content: "A=1"}` | refused: same message as the 2.0.30 write |
| 1.19.0 | `bash` | `{command: "echo A=1 > .env"}` | refused: same message as the 2.0.30 shell |

`.env` was never created. `denials.jsonl` holds exactly 4 lines, one per run.

Named export: with `export const CodingFlowGuard` removed (default export
only), 1.19.0 still refused the write, so 1.x loads `default.server`. The
named export was therefore dropped, as the spec asks.

Noise worth knowing: in one earlier V2 shell run the free model's provider
closed the socket after the refusal (`Transport: The socket connection was
closed unexpectedly`, exit 124). The refusal had already happened, the guard
was not involved, and a rerun finished cleanly.
