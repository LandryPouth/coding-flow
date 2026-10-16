# Story 05-01 — Tasks

- [x] Project-root resolution (`.coding-flow` ancestor → git toplevel → cwd), memoised.
- [x] `resolveTargets`: lexical, real (nearest existing ancestor), primary checkout, `$HOME`.
- [x] `~`/`$HOME` expansion for shell targets.
- [x] Wire into `decide` and `decideBash`; reason names link → target.
- [x] Tests: symlink (Write + Bash), worktree primary `.env`, subdirectory session, `~/.ssh`, new file, outside link, pnpm `node_modules` link.
- [x] `npm test`; verify; CHANGELOG.
