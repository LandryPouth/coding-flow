# Story 16-02 — A bug fix starts red, in every mode

## Status: done

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

- [x] Given `flow-run/SKILL.md`, when a story fixes a bug, then the steps
      every mode reads (not the STRICT section) say, in order:
      - reproduce the symptom with a loop that can go red (a test first,
        otherwise a command) before any hypothesis or fix;
      - see it fail;
      - fix;
      - see the same loop go green.
- [x] Given a project that declares `redAtBase.command`, when a bug fix of
      any mode is verified, then the skill asks for `ai-flow verify --story
      <dir> --red-at-base` as well as the ordinary verify. Without that
      command, the red output is quoted in `## Result`.
- [x] Given a bug that cannot be reproduced, then the skill says to stop and
      say so in `## Result`, never to fix it blind.
- [x] Given `npm test`, then the skill evals, `plugin check` and the
      500-line ceiling pass.

## Commands

```bash
npm test
```

## Result

The negative-evidence rule left STRICT and became `## A Bug Fix Starts Red`
in `templates/.claude/skills/flow-run/SKILL.md`, read in every mode: the
four-step loop in order, `verify --red-at-base` when `redAtBase.command` is
declared, the red output quoted in `## Result` otherwise, and an
unreproducible bug stops the story (also listed under Stop Conditions).
QUICK / FAST points at it. `test/bug-fix-starts-red.test.js` (4 tests, red
first) holds the text; `evals/cases/flow-run.json` gains a crash-report case;
`skills/` regenerated. The skill is 345 lines. Review (PASS, 5 P2) fixed: STRICT keeps its red-at-base bar, a copy or typo change is not a bug fix, TDD names the mandatory loop, an unreproducible bug is `blocked`.
