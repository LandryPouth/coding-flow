# Plan — 31-01 A fix round starts from a brief

## Implementation Context

- Likely files:
  - a new `bin/lib/story-brief.js` (the brief, and the findings reader that
    31-02 reuses), wired into the CLI next to `status` and `todo`;
  - `templates/.claude/skills/flow-review/`, `templates/.claude/skills/flow-run/`;
  - `evals/cases/flow-review.json`, `evals/cases/flow-run.json`;
  - `docs/` wherever the epic-run loop is described (search "fix round",
    "SendMessage", "same implementer");
  - CHANGELOG.
- Search anchors:
  - the story readers in `bin/lib/` (`todo.js` from 26-02 reads checkbox
    sections: reuse its Markdown reader, do not write a third one);
  - the verify evidence reader that `status` uses;
  - the start-commit logic in `worktree.js` (`storyBaseRef` or equivalent).
- Execution mode: STANDARD. Scout pre-step: no.
- Avoid: the guard; `verify`'s verdict path.

## Decisions

- D1: findings live in the story files, not in `.coding-flow/runs/`. They are
  part of the story's history, the reviewer of the next round reads them, and
  a fresh implementer gets them through git.
- D2: the budget is in characters, not tokens. That keeps the tool free of
  any tokenizer dependency; 6,000 characters is about 1,500 tokens.
- D3: the cut order is fixed, and open findings are never cut, because a fix
  round exists to close them.
- D4: the changed-files list is `git diff --stat <merge-base(HEAD, base)>..HEAD`,
  so files that merged-in base commits brought do not appear.

## Test Plan

Behavioural `node:test` on `mktemp -d` repositories: a story with two rounds,
merges of the base, a large story for the budget, a one-file story, a story
with prose findings. Assert on stdout and on `--json`, never on wording beyond
the section labels.

## Acceptance Traceability

(filled by `/flow-run`)

## Commands

```bash
npm test
```
