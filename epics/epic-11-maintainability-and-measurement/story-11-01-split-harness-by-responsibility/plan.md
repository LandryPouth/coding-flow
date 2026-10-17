# Story 11-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Prerequisite**: epics 05–09 landed — done, merged to `main` by PR #53
  (2026-10-17). Start from an up-to-date `main`/`develop`.
- **Order of extraction** (leaves first, each one commit, `npm test` before
  the next):
  0. The shared story readers into `story.js` (no new module).
  1. `harness-config` — then point `templates.js`, `uninstall.js`,
     `policy-fingerprint.js` (drop its lazy `require`) at it.
  2. `security-policy` — then point `guard.js` at `harness-config` +
     `security-policy`; `guard.js` no longer requires `harness.js`.
  3. `diff-scope`
  4. `risk`
  5. `validation-run`
  6. `coverage-gate`
  7. `evidence`
  8. `harness-report`
- **Technique**: cut the block, paste it into the new file with the requires it
  needs, `module.exports` the moved names, require them back in `harness.js`
  and keep its export list unchanged. Importers other than the ones above keep
  importing from `harness.js`; repointing them is optional, not required.
- **Load check** after each commit:
  `for m in bin/lib/harness.js bin/lib/<new>.js; do node -e "require('./$m')"; done`
  — any stderr output (a circular partial export) stops the story.

## Commands

```bash
npm test
git diff -M --color-moved=zebra HEAD~1
wc -l bin/lib/harness.js
```

## Risks

- A moved function that read module-level state (`cwd` from `context.js`,
  a constant) must import the same binding, not copy its value.
- `verifyStoryOnce` touches every concern: it stays in `harness.js`; if it
  keeps the file above 600 lines, move it to `evidence` and say so here.
