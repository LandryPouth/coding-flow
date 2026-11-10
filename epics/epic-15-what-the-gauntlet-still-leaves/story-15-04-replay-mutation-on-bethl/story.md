# Story 15-04 — Replay the mutation probe on bethl: go or no-go

## Status: done

Wave 5 of the study is conditioned on one experiment: does a diff-scoped
mutation probe find **real** gaps on a project the author did not design?
bethl (`~/dev/saas/bethl`, 144 k lines, 183 s median suite) is the dogfood
project; its suite is too slow to run per mutant, so a targeted test command
is mandatory. Offline, in a throwaway worktree — never in bethl's tree.

*(QUICK — an experiment and a write-up; the probe script is committed as a
repository tool so 15-05 starts from it.)*

## Acceptance Criteria

- [x] `scripts/mutation-probe.js` (zero-dependency, the study's method):
      sites from a diff's added lines, the operator table, deterministic
      sampling, one throwaway worktree, a targeted command with `{files}`,
      killed/survived/duration printed.
- [~] Run on three recent bethl stories with high-risk diffs (auth,
      payments or migrations), ≥ 20 mutants each; each survivor classified:
      equivalent, weak assertion, real gap, or not runnable.
- [x] Recorded in `docs/plans/uncle-bob-gauntlet.md` (wave 5 row): kill
      rate, seconds per mutant, survivors by class, and the verdict.
- [x] **Go** iff at least one survivor is a real gap or a weak assertion on
      a high-risk path; otherwise **no-go**, and 15-05 is closed as "not
      built, see 15-04".
- [x] bethl's working tree and branches are unchanged (checked by `git
      status` and `git worktree list` before and after).

## Deferred Criteria

- **Criterion 2, "each survivor classified" into the four classes**: met for
  11 of 19. The other 8 ran, but on code the story did not write (7 lines
  34-03 only re-indented, 1 site relocated onto another occurrence of the
  same line); none of the four classes describes them, and they are recorded
  as what they are rather than forced into one. The verdict does not depend
  on them. Closing it means either agreeing this fifth class with the story
  owner, or 15-05 taking sites from substantive changes so the case cannot
  arise.

## Result

**Go.** The numbers and the per-survivor classification are in
`docs/plans/uncle-bob-gauntlet.md`, Experiment 3; the wave 5 row points there.

- `scripts/mutation-probe.js` + `test/mutation-probe.test.js` (50 tests on
  throwaway repositories: what is and is not a site, seed-stable sampling,
  killed/survived/timeout/compile/error, the repository's status, `.git` and other
  worktrees untouched, revisions and links confined, signals, leftovers of a
  SIGKILLed run, a closed output pipe).
- Stories: 37-03 (`268a8662^..420dbf9e`), 34-02 (`e7c1748a^..e1040e8e`),
  34-03 (`b5b211bd^..b5b211bd`), 80 mutants, 32 s each. 1 real gap
  (`findImageResource` untested), 3 weak assertions on high-risk paths
  (the 100 m presence bound, the 8 MB upload cap, `authenticatedDelivery`),
  2 low-risk weak assertions, 5 equivalent, and 8 outside the criterion's
  four classes: they ran, but not on code the story wrote (re-indented or
  mis-relocated lines) — recorded as such rather than forced into one. The 4 go-deciding survivors
  also survive bethl's whole API unit suite (1 763 tests).
- bethl: `git status`, `git worktree list`, branches and stash diffed
  before/after — identical. The probe ran on a clone of it, so its `.git` was
  never written either. Dependencies were symlinked from it: a live
  directory, where a runner may write caches that `git status` does not see.

Found while running, carried to 15-05 rather than fixed here:

- Re-indented lines count as added (7 of 19 survivors): take sites from
  `git diff -w`.
- `--at` ≠ `--head` relocates by verbatim text and can land on another
  occurrence (1 survivor): relocate by `git blame`.
- bethl's `node_modules` predate its SWC switch (`@swc/jest` missing at
  HEAD), so the mutants ran on `ec8a3e0e`, the commit before it.

Command per story (from the clone; `--at ec8a3e0e`, `--max 30`; the seed
is the revision range as spelled below):

| Story | `--base` | `--head` | `--paths` (under `apps/api/src/`) | `--tests` (under `apps/api/src/`) |
|---|---|---|---|---|
| 37-03 | `268a8662^` | `420dbf9e` | `agent/agent-photos-cron.service.ts`, `agent/agent-photos.service.ts`, `agent/agent-photos.ts`, `agent/agent.controller.ts`, `agent/agent.module.ts`, `agent/agent.service.ts`, `agent/dto/agent-photo.dto.ts`, `agent/dto/public-agent.dto.ts`, `cloudinary/cloudinary.service.ts`, `common/cron-lock.ts` | `agent/agent-photos-cron.service.spec.ts`, `agent/agent-photos.service.spec.ts`, `agent/agent.controller.spec.ts`, `agent/agent.service.spec.ts` |
| 34-02 | `e7c1748a^` | `e1040e8e` | `common/cron-lock.ts`, `property/dto/visit-location-response.dto.ts`, `property/location-access-log-cron.service.ts`, `property/property.controller.ts`, `property/property.module.ts`, `property/visit-access.ts`, `property/visit-location.service.ts` | `property/location-access-log-cron.service.spec.ts`, `property/property.controller.spec.ts`, `property/visit-access.spec.ts`, `property/visit-location.service.spec.ts` |
| 34-03 | `b5b211bd^` | `b5b211bd` | `location/dto/address.dto.ts`, `property/dto/presence-verification.dto.ts`, `property/dto/visit-location-response.dto.ts`, `property/location-access-log-cron.service.ts`, `property/presence-rules.ts`, `property/presence-verification.service.ts`, `property/property.controller.ts`, `property/property.module.ts`, `property/property.service.ts`, `property/visit-location.service.ts` | `property/location-access-log-cron.service.spec.ts`, `property/presence-rules.spec.ts`, `property/presence-verification.service.spec.ts`, `property/property.controller.spec.ts`, `property/property.service.spec.ts`, `property/visit-location.service.spec.ts` |

The shape of each command:

```bash
node scripts/mutation-probe.js --base <first>^ --head <last> --at ec8a3e0e \
  --paths <each source file the story touched> --tests <its spec files> --max 30 \
  --link node_modules --link apps/api/node_modules --link-from ~/dev/saas/bethl \
  --command 'cd apps/api && node_modules/.bin/jest --ci --silent {files}'
```

### Review 1 (independent, fail) — fixed

Three P1s in the probe: `git worktree prune` deregistered the repository's
other stale worktrees; Ctrl-C was counted as a kill and the run went on
(mutants ran under `spawnSync`, so no handler could fire); `--link .` turned
the worktree into a symlink to the user's repository. Now: only the probe's
own worktree is removed; each mutant runs in its own process group, and
SIGINT/SIGTERM/SIGHUP stop it, count nothing and exit 130 after cleanup;
`--link` must name a path inside the worktree, through no symlink. Also fixed:
a timeout kills the whole group; `{files}` is substituted literally; git's
output is pinned (`--no-ext-diff`, prefixes, `core.quotePath`, `-z`,
`--full-tree`, the repository root); multi-line templates are masked; an
added line starting with `++` is not a header; flags are validated; a site
whose text differs in the worktree is `not applied`. Each P1 fix and the
group kill were checked by putting the defect back: the guarding test fails.

### Review 2 (independent, fail) — fixed

Two P0s, both reproduced by the reviewer: with `GIT_DIR`/`GIT_WORK_TREE` set
(a git hook), a failed `worktree remove` fell back to deleting the user's
whole `.git`; and `--link a --link a/b` deleted `a/b` in the user's checkout.
Two P1s: `--link src` wrote the mutants into the user's real files; a
SIGKILL left the worktree registered and the command's group running. Now:
git's location variables are cleared for git and for the command; the
fallback deletes only an admin directory under `<common-dir>/worktrees/`;
links are refused when they overlap or hold a site or test file, and a
mutant is never written through a path that resolves outside the worktree;
the next run removes what a SIGKILLed run left (worktree and process group),
recognised by its temp-directory name and a dead pid. Also: hooks are off
for `worktree add`; nested templates, regex literals and continued strings
are masked; a path with a space keeps its name; a cleanup failure is logged
and never replaces the result; `--timeout` bounds the mutants, not the
baseline; SIGTERM/SIGHUP exit 143/129; the rate is rounded down.

Each fix was checked by putting its defect back in a copy of the script:
every one turns a test red. The bethl numbers were produced by the first
version (`a86fb07`); none of the fixes changes how a mutant that ran to the
end is classified, the 80 sites are all still sites under the final masking,
and the four go-deciding survivors were re-run on their own against the
whole suite. *(Corrected by review 4: "every one turns a test red" was not
true of two guards — a link through a tracked symlink, and a mutant written
through a path outside the worktree — which had no test until then.)*

### Review 3 (independent, fail) — fixed

Two P1s, reproduced by the reviewer: `--base "--output=<file>"` overwrote
any file, even under `--dry-run` (git read the revision as an option); and
`--link .git` handed the command the user's real `.git`, index and refs.
Now a revision starting with `-` is refused and git only sees
`rev-parse --verify --end-of-options` hashes; a link into `.git` is refused.
Also: the next run kills a left process group only while its leader still
works in that run's directory (a recorded pid may have been reused), and
`running` is emptied when a command ends; `--inter-hunk-context=0`, and
context lines are counted anyway; a closed output pipe or a spawn error no
longer ends the run before cleanup; a temp directory inside the repository
is refused; a leftover that cannot be removed is logged, not fatal;
`--json` does not overwrite without `--force`; a test no longer chmods all
of `/tmp`. JSX text and a regex right after `)` are documented limits of the
masking. Each fix was checked by putting its defect back: a test fails.
*(Corrected by review 5: not true of the temp directory inside the
repository, the logged leftover and the emptied `running`, which had no
test until then.)*

### Review 4 (independent, fail) — fixed

Two P1s, both about proof: the guards against a link through a tracked
symlink and a mutant written outside the worktree had no test (removing
both left the suite green, and the first then deleted a real file), and the
SIGKILLed-group test passed with the kill removed (it waited the sleep out).
Both guards now have a test, and the group test fails unless the group is
gone within 5 s. Also: `--timeout` is bounded (past 2^31-1 ms setTimeout
fires at once and every mutant read as a timeout kill); `obj.true`, `$true`
and a non-null `fn!()` are not sites; a `.git` anywhere in a link is
refused; `{files}` receives test files by name, never a helper; SIGHUP is
tested, and the signal tests check the group is gone; output is kept
without quadratic copying; the `/proc` dependency of the left-group kill is
documented. Each fix was checked by putting its defect back: every one,
including the two guards above, turns a test red. *(Corrected by review 5:
the claim held for this round's fixes, but earlier rounds' fixes were
untested — see below.)*

### Review 5 (independent, fail) — fixed

One P1, about proof again: nine behaviours the script claimed had no test —
a temp directory inside the repository refused, a background process killed
when `sh` exits (without it a pass read as a timeout), `not applied` when
the text at the column differs, a leftover that cannot be removed logged
and not fatal, `running` emptied after a command, the narrowed
`SyntaxError:` pattern, mocks/declarations/stories holding no site, `{files}`
replaced literally (a name holding `$&`), the rate rounded down. Two P2s:
timeouts were counted as kills, and a TS code the passing baseline already
printed made every mutant `compile`. Now each of the nine has a test; a
timeout is counted apart and the rate is killed over killed + survived; a
compile line counts only when the baseline did not print it. P3s: a command
that cannot start is `error`, not a kill; `GIT_CONFIG_PARAMETERS`/
`GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n` are cleared for the command; `--json`
refuses a dangling symlink; the dead-pid search uses `process.kill(pid, 0)`;
a second Ctrl-C during cleanup is documented as not interrupting it.

What was checked by putting the defect back, in a copy of the script (never
the checkout): those fourteen changes, one at a time — each turns its test
red (`negcheck6`).

The bethl rate under these rules is 66 % (37/56), the timeouts apart; read
either way they give 64–67 %. The first version counted them as kills and
read 67 %; "67 % is a lower bound", written in review 4, was wrong. The
compile pattern narrowed after the bethl run and the 22 compile mutants'
output was not kept: under today's rules some might read as killed, which
can only raise the 66 %.
