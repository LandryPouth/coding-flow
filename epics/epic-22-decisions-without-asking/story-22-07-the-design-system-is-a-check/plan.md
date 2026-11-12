# Story 22-07 — Plan

## Implementation Context

- **Execution mode**: STANDARD — adds a verify phase; no new trust boundary.
- **Depends on**: 22-03 (ladder rung detection); 19-01 (verify output shape)
  if landed, otherwise the current runner.
- **Likely files**: `bin/lib/conformance.js` (new: rule load, glob match,
  added-line scan), `bin/lib/verify.js` (phase after commands, evidence
  field), `bin/lib/config.js` (schema), `bin/lib/ladder.js` (rung `gate`),
  `bin/ai-flow.js` (`conformance --all`), `test/conformance.test.js` (new).
- **Search anchors**: `validation.quality`, `diffScope`, `addedLines`,
  `evidence`, `requireTestChange`.
- **Scout pre-step**: yes — find how verify computes the story diff and where
  evidence fields are written.
- **Areas to avoid**: the coverage gate; command execution (conformance runs
  in-process, it executes nothing).

## Technical Notes

- Added lines from `git diff --unified=0 <base>...` hunks; reuse the base
  verify already resolves.
- Globs: reuse the existing matcher if one exists, otherwise a small
  `*`/`**` matcher (zero dependency).
- Regexes compiled once; a per-rule timeout is not needed for line-sized
  input.

## Decisions

- **Added lines only**: the gate judges what the story wrote; legacy code is
  a report (`--all`), never a blocker — otherwise the first rule blocks every
  story.
- **Patterns, not a linter**: zero dependency and stack-agnostic; anything
  that needs syntax stays in the project's own lint command.
- **Inline opt-out with a reason**: the same contract as `## Test
  Exemption` — a recorded claim, not a mute button.

## Test Plan

Temp git repos with a base commit and a story commit; table tests per
criterion; manual bethl pass.

## Acceptance Traceability

- 1–5 → `test/conformance.test.js`
- 6 → observed YYYY-MM-DD in `## Result`

## Commands

```bash
npm test
```
