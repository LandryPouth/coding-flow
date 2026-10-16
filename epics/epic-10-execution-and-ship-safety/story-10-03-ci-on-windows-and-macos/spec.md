# Story 10-03 — CI on Windows and macOS

## User Value

"Works on Windows/macOS" becomes a measured claim, or the README stops
making it.

## Requirements

- `.github/workflows/test.yml`: keep the Ubuntu × Node 18/20/22 matrix; add
  `windows-latest` and `macos-latest` on Node 22 (`fail-fast: false`).
- Git on the runners: set `user.name`/`user.email` and
  `core.autocrlf=false` in a setup step (tests create repositories).
- Run the full suite; fix what fails **when it is a product bug**; for tests
  that assume POSIX (symlinks without privilege on Windows, `chmod`,
  `/bin/sh`), skip with `{ skip: process.platform === "win32" && "<reason>" }`
  and a one-line reason — never silently.
- README: platform support line reflects what CI covers.

## Acceptance Criteria

- [ ] The workflow runs on the three OSes.
- [ ] All three green, with every skip carrying a reason; the skip list is
      recorded in this story's `tasks.md`.
- [ ] Any product bug found is fixed in this story or logged in
      `docs/DOGFOODING.md` with severity, if too large.

## Edge Cases

- Windows symlink creation needs Developer Mode; the epic-05 symlink tests
  must skip there with that reason.
