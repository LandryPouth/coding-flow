# Plan — 28-01 Ideas from the repo

## Implementation Context

- Mode: STANDARD. Scout: no — `next`'s tier code and 26-07's block are the
  edit points.
- Likely files: the `next` command and its renderer under `bin/lib/`, the
  story/epic readers used by `status`/`verify` (deferred criteria,
  `Assumption (unconfirmed)` from 16-01), a new `ideas` module (ledger parse
  and write, scan, ids), CLI wiring for `ideas` / `idea`, `config.json`
  schema (`ideas.markers`), docs (`docs/rules-and-limits.md`, the `next`
  skill/README).
- Zero runtime dependencies (feature-freeze exception rules apply).

## Technical notes

- Reuse the 26-07 reader of epic indexes and story files; do not parse
  Markdown twice.
- The id hashes the normalized source (`kind` + path + item text, lowercased,
  whitespace collapsed), 6 characters.
- `next` must stay fast: the scan reads Markdown only, plus a bounded
  `git grep` for markers (skipped when `ideas.markers` is empty).

## Decisions

_(to fill during execution)_

## Test plan

- Unit: ledger round-trip, id stability, ordering, status parsing.
- Fixture repos: scan idempotence, killed never re-added, markers outside
  tests only, `next` silent while work exists, three-line cap, `--json`.

## Acceptance Traceability

_(to fill)_

## Commands

```
npm test
npm run lint
```
