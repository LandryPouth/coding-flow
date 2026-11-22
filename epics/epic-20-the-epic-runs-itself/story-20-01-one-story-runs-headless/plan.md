# Story 20-01 — Plan

## Implementation Context

- **Execution mode**: STRICT — walking skeleton: preflight → place/lock →
  agent process → CLI verify → run report.
- **Likely files**: `bin/lib/run.js` (`RUN_DRIVERS`, `run`, `verifyStoryEntry`),
  `bin/lib/drivers/claude.js` (new: preflight, argv, result parsing),
  `bin/lib/guard.js` (Status refusal in driven mode),
  `bin/lib/worktree-plan.js` (place), `bin/lib/worktree.js` (lock),
  `bin/lib/claude-plugin.js` (plugin namespace), `bin/lib/config.js`
  (`run.*` keys), `templates/.claude/skills/flow-run/SKILL.md` (`## Driven
  mode`), `evals/benchmark/run.js` (already drives `claude -p` and reads
  `total_cost_usd` — reuse its parsing), tests `test/run.test.js`,
  `test/run-driver-claude.test.js` (new, stub binary on PATH).
- **Search anchors**: `RUN_DRIVERS`, `total_cost_usd`, `CLAUDECODE`,
  `isUnattended`, `claimChainIfPossible`.
- **Scout pre-step**: yes — read `evals/benchmark/run.js` and the 2026-11-10
  session notes for the verified headless facts before writing argv.
- **Areas to avoid**: other hosts' drivers; parallelism.

## Technical Notes

- Verified facts (docs dated 2026-11-10, re-check on install): permission
  modes default/manual, acceptEdits, plan, auto, dontAsk, bypassPermissions;
  `--max-turns` → subtype `error_max_turns`; `--max-budget-usd` is a
  client-side estimate that can overshoot and counts subagent spend → subtype
  `error_max_budget_usd`; JSON has `total_cost_usd`, `session_id`; `num_turns`,
  `is_error`, `permission_denials` documented in the SDK result — check the CLI
  shape; hooks from `.claude/settings.json` run in `-p`; a PreToolUse deny
  works via exit 2 or `permissionDecision: "deny"`; plugin skills are
  namespaced (`/coding-flow:flow-run`); `--bare` skips hooks, CLAUDE.md and
  skills; `--permission-prompts none` removes AskUserQuestion — check it
  exists on the installed version.
- Billing: on the maintainer's subscription (design-decisions entry 15);
  the report records cost regardless.
- bethl lessons encoded: the worker never runs verify (verify while code
  changes was wasted twice on 39-02), never sets `done`, never self-reviews.

## Decisions

- **The CLI verifies, not the agent**: what the agent says is not evidence.
- **Self-test before every batch, cached briefly**: a guard silently inactive
  in headless mode is worse than no run.

## Test Plan

Stub `claude` script on PATH that records argv/env and writes a canned JSON
result and a file change; preflight refusal matrix; guard refusal of a Status
line under `AI_FLOW_DRIVEN`; one manual real run recorded in `## Result`.

## Acceptance Traceability

- 1–3 → `test/run-driver-claude.test.js`
- 4 → `test/guard.test.js::driven status line`
- 5 → `scripts/skill-evals.js`, `test/ceremony.test.js`
- 6 → observed YYYY-MM-DD in `## Result` (manual real run)

## Commands

```bash
npm test
```
