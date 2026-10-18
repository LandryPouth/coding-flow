# Story 15-01 — The guard's tests assert what they claim

Experiment 1 of the Uncle Bob study (30 sampled mutants on epic 05's
`guard.js` lines, 27 killed) left two non-equivalent survivors. Re-checked
2026-10-18: the guard behaves correctly (`cp key .ssh`, `mv key .ssh`,
`cp -r a b .ssh` are denied when `.ssh/` exists), but **no test asserts it**,
so the directory-destination branch can be broken silently; and sed tests
assert `deny` only — `shellWriteTargets` is asserted for one command in the
whole suite, so a `sedFiles` that over-collects or misses an operand passes.

*(QUICK — tests only, plus the probe re-run.)*

## Acceptance Criteria

- [ ] Given a project with an existing `.ssh/` directory, then `cp key .ssh`,
      `mv key .ssh` and `cp -r a b .ssh` are each asserted `deny`, and
      `cp key notes` (no such directory) is asserted against its real target.
- [ ] Given sed forms (`sed -i s/a/b/ x y`, `sed -i -e s/a/b/ -f s.sed x`,
      `sed --in-place=.bak s/a/b/ x`, `sed -n p x` with no `-i`), then
      `shellWriteTargets` returns exactly the edited operands (and nothing
      for the read-only form).
- [ ] Given the study's mutation method re-run on the two survivor sites
      (`base !== null` → `===` in the directory-destination check;
      `let script = false` → `true` in `sedFiles`), then both mutants are
      killed; the result is recorded here.
- [ ] `npm test` green; no change to `bin/lib/guard.js`.

## Result
