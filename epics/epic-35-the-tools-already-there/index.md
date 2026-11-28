# Epic 35 — The tools already there

## Intent

- Problem: a worktree `ai-flow` creates never shows in Herdr's sidebar, so a maintainer running parallel stories inside Herdr cannot see or reach them there (user-stated, binah-shelf, 2026-11-28).
- Actors: the maintainer, the agents running stories, Herdr (a terminal multiplexer for coding agents).
- Success signal: inside Herdr, `worktree add` / `place` make the story appear in the sidebar; `remove` / `land` take it away.
- Appetite: 1 story.
- No-gos: no dependency, no required tool, no change of the worktree layout (siblings stay). Must not change: everything outside Herdr behaves exactly as before.
- Assumptions: Herdr's CLI (`herdr worktree open`, `workspace close`) is stable enough to call best-effort — feasibility, tested by story 01.

Coding Flow stays independent and dependency-free, and it integrates with the tools it meets when they are there (user-stated, 2026-11-28).

## Backbone

Backbone: a worktree is created → it shows where the maintainer works → it is removed → it goes away there too.

## Stories

1. [story-35-01-worktrees-show-in-herdr](story-35-01-worktrees-show-in-herdr/story.md) — inside Herdr, worktrees open in its sidebar and close with them *(STANDARD)*

## Readiness

ready — no open question would change implementation.
