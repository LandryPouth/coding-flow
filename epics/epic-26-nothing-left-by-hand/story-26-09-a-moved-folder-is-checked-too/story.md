# Story 26-09 — A moved folder is checked too

Split from 26-03 at its review cap (round 4 on real docs). Not new scope:
the folder half of what 26-03 checks file by file.

## Acceptance Criteria

- [x] Given a doc that names only a folder (`packages/geo`), when that folder is moved or deleted and `docs check --changed <base>` runs, then the doc is read and its stale mention reported, as the full check does. (A mention matches when a changed path starts with the mention plus `/`.)
- [x] Given a path under a folder git recorded as moved (`packages/geo/dist`), then it is judged even when it is git-ignored, and the suggestion names the new folder.
- [x] Given a backticked name that is a local or remote branch (`docs/topic-branch`, `origin/docs/x`), then it is not reported as a missing path; a missing path next to the word "branch" still is (review round 1: no word rule).
- [x] Given this repository and bethl's docs (read-only copy), then no finding appears that 26-03 did not report, other than the folder mentions above.

## Commands

```bash
npm test
```

## Status: in-progress

## Result

- Criterion 1 → `test/docs-check.test.js` "--changed reads a doc that names only a folder moved or deleted since the base": `changedPlaces()` adds every folder of a changed path, so a mention equal to one of them keeps the doc.
- Criterion 2 → "a git-ignored path under a moved folder is judged and points at the new folder": `movedUnder()` walks a missing path's gone ancestors; the nearest one git recorded renamed gives the suggestion, and the finding is exempt from the git-ignore filter. A deleted folder is unchanged (still skipped when ignored).
- Criterion 3 → "a backticked branch name is not reported as a missing path": a local/remote branch name (`git for-each-ref`, read only when a path is about to be reported), never for a path git recorded moved or deleted; "a missing path next to the word branch is still reported" covers the four round-1 sentences and a deleted folder that shares a branch's name.
- Criterion 4, measured with the 26-03 code (`git archive HEAD`) vs this one: this repository 32 → 32 findings, identical; bethl (read-only `git clone --no-hardlinks` copy) 33 → 32 in round 1 (`docs/GENERATED_REPORT.md:5` gone through the word rule), 33 again in round 2 — no finding 26-03 did not report. In a second copy with `git mv packages/geo packages/geodata` committed: `--changed develop` now also reads `docs/geo/research.md:143` (missed before), and the full check adds `docs/DOGFOODING.md:85 packages/geo/dist -> packages/geodata/dist` (true positive: prose about the moved package's build output). No false positive seen.
- Tests fail before (3/3 new ones red on the 26-03 tree) and pass after.
- Round 2 (fix of round 1): word rule dropped; the branch lookup no longer runs for a path git recorded moved/deleted; a moved folder's ignored path is reported whether or not suggestions are asked (doctor). New tests "a missing path next to the word branch is still reported" and "doctor counts a git-ignored path under a moved folder, as docs check does" fail on the round-1 tree (`git archive c52a6cf` + new test file: 0/4 sentences reported; doctor no `docs_stale`) and pass after; removing the `!recorded && !moved` guard turns the first red again. `docs check` round 1 → round 2: this repository 32 → 32, identical (the two live shapes, docs/DOGFOODING.md:76 and docs/plans/uncle-bob-gauntlet.md:92, name paths that exist); bethl clone 32 → 33, the one added being `docs/GENERATED_REPORT.md:5 docs/complete-documentation` — not silenced by the branch lookup: that branch was merged (PR #63) and deleted, so no ref names it. Back to 26-03's 33 for bethl; the limit is stated in docs/rules-and-limits.md.


## Review findings

### Round 1 — FAIL (false positives and false negatives on real repositories)

- [x] P1 bin/lib/docs-check.js:615 (`BRANCH_WORD` `/\bbranch(?:e|es)?\b[^`.!?]{0,24}$/i`) silences real broken paths: "Branch protection is in `.github/rules.yml`", "The branch's spec: `docs/spec.md`", "Le module est branché dans `docs/module.md`" (`\b` before `é`), "85 % branches on `docs/gone/`"; it also runs after `recorded`, hiding paths git recorded as deleted/renamed; live shapes here: docs/DOGFOODING.md:76, docs/plans/uncle-bob-gauntlet.md:92 — fix: drop the word rule, keep the `for-each-ref` lookup (a name that IS a local or remote branch); if a word rule stays, only a label right before the span (`Branch(e)?\s*\**\s*:\s*$`), never for a path with a file extension nor one git recorded; tests for each of the four sentences above (reported) and for a real branch name (not reported).
- [x] P2 doctor.js:514 calls `scanDocs` with `suggest: false`, so a moved folder's ignored path falls back to the generated filter: `docs check` reports `packages/geo/dist`, doctor's `docs_stale` count omits it — make the moved check independent of `suggest`; test.
- [x] P2 an ignored path under a deleted (not moved) folder is still skipped — say it plainly in docs/rules-and-limits.md.

Held: bethl clone `git mv packages/ui packages/design` → 32/32 under `--changed`, same as full, all pointing at the new folder; `git rm -r` → 32 `deleted in`; the 3 new tests fail on 26-03 code and on targeted mutations; develop merge no-op, 34/34.

### Round 2 — PASS (the branch lookup and the docs vs code) — lands

- [x] P2 criterion 3 narrowed in round 1: a backticked name is silenced only when it is a branch git knows; bethl's `docs/GENERATED_REPORT.md:5` names a deleted branch and is reported again — accepted by the orchestrator: a word rule silenced real broken paths (round 1 P1); the limit is stated in docs/rules-and-limits.md.
- [x] P3 `./docs/feat` is not stripped before the branch lookup (reported, while `docs/feat` is silenced) — left: it errs toward reporting.

Held: deleted/renamed/moved paths reported even when a branch has the name; detached HEAD and plain clones agree; a `--single-branch --depth 1` clone gives the same 32 findings here (no branch names in CI); one cached `for-each-ref`, bethl in 3.1 s; doctor and `docs check` both 44 after `git mv packages/geo packages/geodata`; rules-and-limits rows true; both new tests fail on the round-1 code and under targeted mutations.
