# Story 03-02 — Tasks

- [ ] Read `worktree.js`'s `worktreeLand`/`landCleanup` and `audit.js`'s
      `latestVerifyByStoryDir`/`isStale` (targeted discovery — reuse, do not
      redefine "verified").
- [ ] Add a "chain's last not-yet-done story" query over story-03-01's
      dependency graph, with unit tests (chain with an open sibling blocks;
      chain with all done triggers).
- [ ] Wire the post-completion check into wherever a story's `verified`
      state becomes known (`skills/flow-run/SKILL.md`'s completion step, or
      the module it calls) — automatically invoke `worktree land` when the
      check passes.
- [ ] Extend `landCleanup` (or wrap it) to remove the parent
      `<repo>-worktrees/` directory when empty, checked at removal time.
- [ ] Clear the landed chain's entry in story-03-01's placement state on
      success; leave it untouched on failure.
- [ ] Run `npm test`; capture the verify.

## Result

*(filled by /flow-run after implementation)*

### Rollback Notes

*(filled by /flow-run after implementation)*
