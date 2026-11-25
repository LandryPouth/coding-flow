# Story 29-06 — A long command cannot outrun the guard

## Status: planned

29-04's series 2 round 3 review measured lines under the 256 KB cap that cost
the guard more than the hook's 60 s timeout (`.claude/settings.json`), so the
timeout — not the guard — decides, and the call can run unchecked. Measured at
~262 KB: `git checkout -- sub/qN;` × 7 000 → 105 s (a `git status` per
segment), `git zzN;` × 11 000 → 98 s (an alias lookup spawn per segment),
`cd dN && rm c.txt;` × 11 000 → over 120 s (quadratic `realpath`/`lstat`),
and `aliases…; rm sub/*.txt` → 48 s. Pre-existing at 3c90919 (no cap at all)
and on 29-03's frozen side, which 29-04 must not edit: hence its own story.

*(STRICT — guard. Added 2026-11-25 from 29-04's series 2 round 3: the
whole-call time is a guard-wide fail-open, not one reader's.)*

**Implementation Context**:

- One deadline over the whole `decideBash`, enforced through the host the
  readers call (`gitAlias`, `gitTop`, `exists`, `readSmall`) and through the
  frozen judge's git budget (`gitBudget` in `destructive-judge-29-03.js` is
  outside its pinned blocks only by what `use` hands in: decide how the
  deadline reaches it without editing a pinned block, or re-pin with the
  maintainer's agreement).
- When the deadline runs out the call is **refused**, as `TOO_LONG` is — not
  unchecked, which `standard` lets run.
- Caps: segments per line, `cd` depth, distinct `realpath` calls per call.
- Files: `bin/lib/guard.js`, `bin/lib/destructive.js`, the frozen judge's
  hand-in, `test/guard-evasion.test.js` (or a new `test/guard-deadline.test.js`),
  `docs/rules-and-limits.md` (the row 29-04 added: the hook timeout can decide).

## Acceptance Criteria

- [ ] Given each of the three measured shapes (`git checkout -- sub/qN;` ×
      7 000, `git zzN;` × 11 000 with no such alias, `cd dN && rm c.txt;` ×
      11 000) on a throwaway repository, when the guard CLI decides it, then
      it answers in under 20 s and refuses it.
- [ ] Given `aliases…; rm sub/*.txt` (the 48 s shape), then it is refused in
      under 20 s.
- [ ] Given any line under the cap, the hook's 60 s timeout never decides:
      the guard's own deadline (well under 60 s) refuses first.
- [ ] Given 29-03's and 29-04's everyday lists (Lens B), then every command is
      decided as before, and the per-call latency stays within noise.
- [ ] Given `docs/rules-and-limits.md`, then the row "a call whose reading
      costs more than the hook's 60 s timeout" states the new bound.

## Commands

```bash
npm test
```
