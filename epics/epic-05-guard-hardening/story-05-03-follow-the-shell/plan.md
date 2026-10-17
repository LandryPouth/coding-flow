# Story 05-03 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/guard.js` — `shellWriteTargets` (~163–221),
  `tokenize` (~142), `isCandidatePath` (~155: today a `$` token is silently
  dropped — that is where `unchecked` comes from), `decideBash` (~298);
  `test/guard.test.js`.
- **Search anchors**: `DESTINATION_LAST`, the `redirection` regex (~172), the
  `split(/\|\||&&|[;|\n]/)` segment loop (~183).

## Technical Notes

- Return shape changes from `string[]` to
  `[{ target, cwd, uncheckedReason? }]`; `shellWriteTargets` is exported and
  used by tests — keep a thin compatibility wrapper or update the tests in the
  same commit.
- Splitting must keep `( … )` boundaries to restore cwd; a simple depth
  counter over the existing tokenizer is enough — no full parser.

## Decisions

- Interpreters: literal match only. Anything smarter is the sandbox this epic
  explicitly refuses to build.
