# Story 16-02 — A bug fix starts red, in every mode

## Status: planned

Today the "negative evidence" paragraph in `/flow-run` (`A bug fix carries
negative evidence`) sits under STRICT, while most bug fixes are routed to
QUICK/FAST. Pocock's `diagnosing-bugs` phase 1 says to build a loop that can
go red before forming any hypothesis. The paragraph moves out of STRICT and
becomes that loop, in every mode (the maintainer's decision, 2026-11-10).

*(QUICK: prose and evals only.)*

**Implementation Context**:

- Files: `templates/.claude/skills/flow-run/SKILL.md`, which is at 474 of its
  500 lines, so the move must not grow it past the ceiling, and
  `evals/cases/flow-run.json`. Then `plugin sync`.
- Anchors: `A bug fix carries negative evidence`, `### QUICK / FAST`.
- Do not touch: `bin/lib/red-at-base.js`, which this story does not change.

## Acceptance Criteria

- [ ] Given `flow-run/SKILL.md`, when a story fixes a bug, then the steps
      every mode reads (not the STRICT section) say, in order:
      - reproduce the symptom with a loop that can go red (a test first,
        otherwise a command) before any hypothesis or fix;
      - see it fail;
      - fix;
      - see the same loop go green.
- [ ] Given a project that declares `redAtBase.command`, when a bug fix of
      any mode is verified, then the skill asks for `ai-flow verify --story
      <dir> --red-at-base` as well as the ordinary verify. Without that
      command, the red output is quoted in `## Result`.
- [ ] Given a bug that cannot be reproduced, then the skill says to stop and
      say so in `## Result`, never to fix it blind.
- [ ] Given `npm test`, then the skill evals, `plugin check` and the
      500-line ceiling pass.

## Commands

```bash
npm test
```

## Result
