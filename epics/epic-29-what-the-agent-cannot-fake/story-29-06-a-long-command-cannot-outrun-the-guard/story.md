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

Each shape is a line built by `node -e` and handed to the guard CLI as the hook
hands it, timed from the shell, on a throwaway repository with one commit and
`sub/c.txt`, `sub/deep/e.txt` modified (29-04's `subRepo`):

```bash
# SHAPE is the JS expression for the command line; the timing is the wall time of the call.
node -e "process.stdout.write(JSON.stringify({tool_name:'Bash',tool_input:{command:SHAPE}}))" > in.json
/usr/bin/time -f %e node "$CODING_FLOW/bin/ai-flow.js" guard < in.json
```

- [ ] Given `SHAPE` = `Array.from({length:7000},(_, i)=>'git checkout -- sub/q'+i+';').join(' ')`,
      then the call is refused (exit 2) in under 20 s.
- [ ] Given `SHAPE` = `Array.from({length:11000},(_, i)=>'git zz'+i+';').join(' ')`
      (no such alias), then the call is refused (exit 2) in under 20 s.
- [ ] Given `SHAPE` = `Array.from({length:11000},(_, i)=>'cd d'+i+' && rm c.txt;').join(' ')`,
      then the call is refused (exit 2) in under 20 s.
- [ ] Given 5 000 aliases set first (`for i in $(seq 5000); do git config alias.a$i status; done`)
      and `SHAPE` = `Array.from({length:5000},(_, i)=>'git a'+(i+1)+';').join(' ')+' rm sub/*.txt'`
      (the 48 s shape: one alias lookup per segment, then a removal of modified files),
      then the call is refused (exit 2) in under 20 s.
- [ ] Given any line under the 256 KB cap, the guard answers before the hook's
      60 s timeout: a test asserts the guard's own deadline constant is at most
      30 s and that a host whose every call sleeps 50 ms (so a long line would
      take minutes) gets a refusal within deadline + 5 s.
- [ ] Given 29-03's and 29-04's everyday lists (`EVERYDAY` in
      `test/guard-destructive.test.js`, Lens B, and the everyday cases of
      `test/guard-evasion.test.js`), then every command is decided as before
      (`npm test` green), and the median of 20 `ai-flow guard` calls on
      `git status` is no more than 10 ms above the same median on `develop`
      (`for i in $(seq 20); do /usr/bin/time -f %e node bin/ai-flow.js guard < status.json; done`).
- [ ] Given `docs/rules-and-limits.md`, then the row "a call whose reading
      costs more than the hook's 60 s timeout" states the new bound (the
      deadline, in seconds, and that the call is refused when it runs out).

## Commands

```bash
npm test
```
