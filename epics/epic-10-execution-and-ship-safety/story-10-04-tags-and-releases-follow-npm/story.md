# Story 10-04 — Tags and releases follow npm

GitHub Releases stop at v0.8.3; `package.json`, the Claude plugin manifest and
the CHANGELOG are at 0.12.1. The maintainer publishes on npm by hand and keeps
doing so; this story only makes the tag and the release one command after
that.

*(QUICK — one script and one doctor line for this repository.)*

## Acceptance Criteria

- [ ] `scripts/release.mjs` (zero-dep): reads `package.json` version, checks
      the CHANGELOG has a `## [x.y.z]` section, checks `npm view
      @landry_pouth/coding-flow@x.y.z version` succeeds (published), then
      creates the annotated tag `vx.y.z` if missing, pushes it, and runs
      `gh release create vx.y.z --notes <section>` if no release exists.
      Never runs `npm publish`. `--dry-run` prints the plan.
- [ ] Idempotent: a second run does nothing and says so.
- [ ] `node bin/ai-flow.js doctor` in this repository warns when the
      `package.json` version has no `v` tag.
- [ ] Backfill note in `tasks.md`: which missing versions (0.9.x → 0.12.1)
      got tags/releases (the maintainer decides whether to backfill).
- [ ] `npm run release` alias in `package.json` scripts; CONTRIBUTING/
      `docs/contributing.md` release section updated.

## Status: planned
