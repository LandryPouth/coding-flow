# Story 15-01 — The guard's tests assert what they claim

## Status: in-progress

Experiment 1 of the Uncle Bob study (30 sampled mutants on epic 05's
`guard.js` lines, 27 killed) left two non-equivalent survivors. Re-checked
2026-10-18: the guard behaves correctly (`cp key .ssh`, `mv key .ssh`,
`cp -r a b .ssh` are denied when `.ssh/` exists), but **no test asserts it**,
so the directory-destination branch can be broken silently; and sed tests
assert `deny` only — `shellWriteTargets` is asserted for one command in the
whole suite, so a `sedFiles` that over-collects or misses an operand passes.

*(QUICK — tests only, plus the probe re-run.)*

## Acceptance Criteria

- [x] Given a project with an existing `.ssh/` directory, then `cp key .ssh`,
      `mv key .ssh` and `cp -r a b .ssh` are each asserted `deny`, and
      `cp key notes` (no such directory) is asserted against its real target.
- [x] Given sed forms (`sed -i s/a/b/ x y`, `sed -i -e s/a/b/ -f s.sed x`,
      `sed --in-place=.bak s/a/b/ x`, `sed -n p x` with no `-i`), then
      `shellWriteTargets` returns exactly the edited operands (and nothing
      for the read-only form).
- [x] Given the study's mutation method re-run on the two survivor sites
      (`base !== null` → `===` in the directory-destination check;
      `let script = false` → `true` in `sedFiles`), then both mutants are
      killed; the result is recorded here.
- [x] `npm test` green; no change to `bin/lib/guard.js`.

## Result

`test/guard-shell.test.js` gains two tests; `bin/lib/guard.js` is unchanged.

- `cp`/`mv` onto an existing `.ssh/` assert the target set (`.ssh/key`,
  `.ssh/a`, `.ssh/b`) as well as `deny`: `.ssh` is blocked by name, so a
  `deny` alone passes whether or not the directory was seen — that is why the
  mutant survived. `cp key notes` targets `notes` and is allowed.
- The four sed forms assert `shellWriteTargets` exactly: `[x, y]`, `[x]`,
  `[x]`, `[]`.

Mutation re-run (2026-11-10, each applied to `guard.js`, run, then restored
with `git checkout`):

| Mutant | Result |
|---|---|
| `base !== null` → `base === null` (directory destination) | killed (1 fail) |
| `let script = false` → `true` (`sedFiles`) | killed (1 fail) |

### Verify history

- 17:29 — green, `Coverage: verified` (95.9 % of the scope's added lines).
- 17:40 — red on `test/pinned-claude-skills.test.js:52`, outside this
  story; passes 3/3 alone (logged in `docs/DOGFOODING.md`).
- 17:51 — NOT PROVEN: all commands green, but `functionSize.enforce` found
  `bin/lib/shell-writes.js` unlisted in the lcov. That stub came from 15-02's
  `fee15eb`, committed to `develop` mid-run; this story does not touch it.
  Left `in-progress` until that is settled.
- 19:06 (review) — NOT PROVEN again, same cause. The story has no worktree,
  so its scope is all of `develop` since the fork point `4c7280c` (26 commits,
  96 files), not its own commit `948cf54`. That scope also carries the
  "1 deleted test" warning: `test/check-function-size.test.js`, deleted by
  14-07's `57fd789` and documented in its spec. Both mutants re-run on a
  scratch copy: killed (tests 26 and 27), 48/48 green without them. Review
  verdict: pass, no fix in the diff. Settles once 15-02 fills
  `shell-writes.js`.
