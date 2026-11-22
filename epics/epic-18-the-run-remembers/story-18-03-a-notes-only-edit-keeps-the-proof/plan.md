# Story 18-03 — Plan

## Implementation Context

- **Execution mode**: STRICT. Changes what counts as stale proof.
- **Likely files**: `bin/lib/evidence.js` (`storyDigest`, freshness at
  ~line 349), `bin/lib/story.js` (section resolution for single-file and
  three-file stories), `test/evidence-freshness.test.js`,
  `test/cache-replay.test.js`.
- **Search anchors**: `storyDigest`, `storyText`, `fresh`, `## Result`.
- **Scout pre-step**: no.
- **Areas to avoid**: the tree token and `untrackedDigest` — only the story
  digest changes.

## Technical Notes

- bethl 39-01/39-02: the orchestrator committed notes after verify and the
  proof went stale each time; the DOGFOODING bilan lists it under P1.
- Keep the old function as `storyDigestV1` for evidence without a version.

## Decisions

- **Exclusion list, not inclusion list**: unknown sections count.
- **Acceptance-criteria ticks still restale**: they are claims (entry 9);
  18-06 makes them bind.

## Test Plan

One fixture story; for each excluded and each counted section, an edit and
the expected fresh/stale outcome; legacy evidence fixture.

## Acceptance Traceability

- 1–3 → `test/evidence-freshness.test.js::notes-only edits`
- 4 → `test/evidence-freshness.test.js::legacy digest`
- 5 → `test/cache-replay.test.js::notes-only replay`

## Commands

```bash
npm test
```
