# Story 07-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/harness.js` — one `filterScopedFiles(files,
  config)` applied where 07-01 produces the changed-file set (single choke
  point); `DEFAULT_HARNESS_CONFIG` / harness config primitives (top of
  harness.js — `templates.js` creates the file from them);
  `bin/lib/doctor.js`; tests.
- **Areas to avoid**: `findSecretsInContent` and the `secrets` /
  `sensitive-files` checks — they keep scanning everything.
