# Plan — 29-02 The agent is held before it stops

## Implementation Context

- Mode: STANDARD. Scout: no.
- Likely files: `bin/lib/harness.js` (new `hook`, `install`, `mode`
  subcommands — or a sibling `harness-hooks.js` if `harness.js` grows past
  its role), `bin/lib/settings.js` (managed block next to the guard's
  `PreToolUse`), `bin/lib/doctor.js`/`report.js` (count `unchecked`),
  `bin/lib/config.js` (`harness.mode`, `harness.maxFeedbackCycles`), docs.
- Reuse: 29-01 `scan.js` API (not the CLI through a child process), the
  guard's wiring and `unwire.js`.
- Check Claude Code's current hook contract (`PostToolUse`
  `hookSpecificOutput.additionalContext`, `Stop` exit 2, `stop_hook_active`)
  with ctx7 before coding.

## Decisions

_(to fill)_

## Test plan

- Unit: mode × outcome table (finding / clean / tool error) for both hooks;
  cycle counting per session; feedback rendering cap.
- Integration: install twice, uninstall, user hooks preserved; a fixture
  session replaying hook JSON on stdin.

## Acceptance Traceability

_(to fill)_

## Commands

```
npm test
npm run lint
```
