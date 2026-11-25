# Story 26-04 — Tasks

- [ ] Closer role, allowed paths, closure commit.
- [ ] Base queue for every epic land; park on red.
- [ ] Cleanup: worktrees, branches, servers, registry.
- [ ] Print the landed epic's open `before: deploy` items after the closure
      (26-07: `openDeployTodos` + `printDeployTodos` in `bin/lib/todo.js`, as
      `worktree land` does through `sayDeployTodos`).
- [ ] Note from 26-03 (review round 1): `ai-flow docs check` exits 0 clean,
      1 on findings, 2 when it cannot run as asked; `--changed <base>` reads a
      doc only when it names a changed path, so a changed doc whose new link
      points nowhere is skipped — run it without `--changed` at closure, or
      pass the changed docs as paths.
      The pnpm short form (`pnpm --filter X generate`, no `run`) is out of
      26-03's scope; it found little on bethl.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Result

### Rollback Notes
