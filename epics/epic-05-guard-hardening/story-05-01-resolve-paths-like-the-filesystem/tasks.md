# Story 05-01 — Tasks

- [ ] Project-root resolution (`.coding-flow` ancestor → git toplevel → cwd), memoised.
- [ ] `resolveTargets`: lexical, real (nearest existing ancestor), primary checkout, `$HOME`.
- [ ] `~`/`$HOME` expansion for shell targets.
- [ ] Wire into `decide` and `decideBash`; reason names link → target.
- [ ] Tests: symlink (Write + Bash), worktree primary `.env`, subdirectory session, `~/.ssh`, new file, outside link, pnpm `node_modules` link.
- [ ] `npm test`; verify; CHANGELOG.
