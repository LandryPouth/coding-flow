# Story 13-05 — The specification comes before the parser

## User Value

A story that teaches the code to recognise inputs — a shell reader, a path
policy, a config parser, a route scanner — starts from the list of cases, so
review stops discovering the spec one case per pass. And when a story's
acceptance criteria change during its own diff, the evidence says so.

## Requirements

- **`/flow-plan` rule** (Planning Heuristics): for a parser- or policy-shaped
  epic, the adversarial / case corpus is **story 01** (the walking skeleton
  for such an epic is "the corpus runs, red where unhandled"), never the last
  story. Epic 05 is the cited example: corpus last, 10–12 review passes per
  story.
- **Criteria drift signal.** `verify --story` compares the story's
  acceptance criteria at the diff base (`git show <mergeBase>:<path>`) with
  HEAD:
  - ticking `[ ]` → `[x]` or `[~]`: silent;
  - a criterion removed or its text changed: contrary signal
    `criteria-changed`, listing old → new;
  - the story file does not exist at the base (spec born in the same diff as
    its code): signal `spec-in-diff` — "the specifier is the coder".
  Warnings by default, strict fails unless a `## Policy Change` (13-04) or a
  `## Spec Change` section explains it.

## Acceptance Criteria

- [ ] Given a story whose criterion "Given X then deny" becomes "Given X then
      warn" on the branch, then `criteria-changed` lists both texts.
- [ ] Given only ticks between base and HEAD, then no signal.
- [ ] Given a story created in the same branch as its code, then
      `spec-in-diff` (warning).
- [ ] Given strict and a `## Spec Change` section, then pass with the reason
      recorded.
- [ ] `/flow-plan` SKILL.md carries the corpus-first rule; its eval case gains
      a positive prompt for a parser-shaped epic; `plugin check` green.

## Edge Cases

- Story-less verify: no story, no signal.
- A story moved or renamed between base and HEAD: compare by the new path's
  history (`git log --follow` once); if not found, `spec-in-diff`.

## Result
