# Story 26-03 — The docs are checked against the code

## User Value

A doc that names a file that moved, a script that was renamed or a page
that no longer exists is reported with its line, before a reader trusts it.
bethl's docs carried stale paths and old infrastructure values until the
maintainer noticed and a 59-file refresh fixed them (2026-11-13).

## Requirements

- `ai-flow docs check [--json] [paths...]`, read-only, over `docs/**/*.md`,
  `README.md`, `RULES.md` by default (`docs.check.include` /
  `docs.check.exclude` in `config.json`):
  - backticked repository paths that do not exist (placeholders `<...>`,
    globs, URLs, and paths under `docs.check.ignorePaths` skipped);
  - `npm run` / `pnpm run` / `pnpm --filter <pkg> run` script names absent
    from the matching `package.json`;
  - relative Markdown links and `#anchors` that do not resolve.
- Each finding: file, line, kind, the missing target, and the closest
  existing path when one is within a small edit distance (renames).
- `doctor` prints the count and the command; never fails on it.
- The command takes `--changed <base>` to check only the docs that mention
  files changed since a base (used by 26-04).

## Acceptance Criteria

- [ ] Given a doc naming `` `src/old.js` `` after a rename to `src/new.js`,
      then the check reports the line and suggests `src/new.js`.
- [ ] Given `pnpm --filter api run seed` and no `seed` script in api's
      `package.json`, then it is reported.
- [ ] Given a link to `other.md#missing`, then the anchor is reported.
- [ ] Given `<placeholder>/path` and `https://…` in backticks, then nothing is
      reported.
- [ ] Given `--changed develop`, then only docs mentioning a file changed
      since `develop` are checked.

## Edge Cases

- Paths relative to a doc's own folder vs the repository root: both tried.
- Monorepo packages: script names resolved against the filtered package.

## Out of Scope

- Meaning drift (a value that changed but a path that still exists): left
  to the closure process (26-04), which proposes.

## Security

- Read-only; no command from a doc is ever executed.
