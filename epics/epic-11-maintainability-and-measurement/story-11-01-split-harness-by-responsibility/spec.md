# Story 11-01 — Split `harness.js` by responsibility

## User Value

A change to coverage rules no longer means reading 2 600 lines that also run
commands and detect secrets; a contributor can test one concern alone.

## Requirements

- Create the modules listed in the epic's Decisions under `bin/lib/`; move
  functions verbatim (plus imports), one module per commit.
- `harness.js` re-exports everything it exported before (other modules and
  tests import from it).
- No behaviour change: no test modified except import paths; the full suite
  green after each commit.
- No circular requires (check with a small script: require each module in a
  fresh `node -e` and assert no partial-export warnings).
- `harness.js` ≤ 600 lines at the end.

## Acceptance Criteria

- [ ] Each new module has at least its existing tests pointed at it directly
      (moved `describe` blocks, same assertions).
- [ ] `git diff --stat` per commit shows moves, not rewrites (review with
      `git diff -M --color-moved`).
- [ ] `npm test` green on every commit of the story.
- [ ] `node -e "require('./bin/lib/harness.js')"` and each new module load
      without warnings.

## Edge Cases

- `templates.js` imports config primitives from `harness.js` (comment at the
  top of harness.js): move those primitives to `security-policy`/a
  `harness-config` module first so the dependency points the right way.
