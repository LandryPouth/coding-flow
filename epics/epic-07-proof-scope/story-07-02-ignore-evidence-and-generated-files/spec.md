# Story 07-02 — Evidence and generated files are not "changes"

## User Value

The coverage and risk verdicts are about code a person or agent wrote, not
about the tool's own run files or a regenerated Prisma client.

## Requirements

- `.coding-flow/**` is always excluded from the changed-file sets used by
  coverage, risk, weakening and deleted-test detection (bethl: 117 of 505
  files in one diff were run JSON).
- `harness.json` gains `ignoredPaths` (globs, default `[]`), excluded from the
  same sets. Typical: `apps/api/generated/**`, `**/openapi.json`,
  `**/*.snap` is **not** a default (snapshots are tests).
- Lockfiles keep today's handling (already "no behavior" for the coverage
  gate).
- `doctor` suggests `ignoredPaths` when the last verify's changed files
  contain a directory named `generated`, `__generated__` or `gen` with more
  than 20 files.

## Acceptance Criteria

- [ ] Given a story diff of `src/a.js` + 3 `.coding-flow/runs/*.json`, then
      `coverage.changedFiles` is `["src/a.js"]`.
- [ ] Given `ignoredPaths: ["apps/api/generated/**"]` and a diff of only
      generated files + `schema.prisma`, then behaviour files are
      `schema.prisma` only.
- [ ] Given a generated file matching a high-risk term in its path, when it is
      ignored, then it does not raise the risk.
- [ ] Doctor hint appears for a run with 30 files under `generated/`.

## Edge Cases

- `ignoredPaths` must not affect the **guard** (`blockedPaths` is separate)
  nor secret scanning: a secret in a generated file is still a secret.
