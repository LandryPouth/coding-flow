# Hardening roadmap — from the 2026-10-16 audit

Two inputs, cross-checked against each other on 2026-10-16:

1. An external audit of the repository (written by another model from the
   published source only — it could not clone or run anything).
2. Measurements taken on this checkout and on the main dogfood project
   (`bethl`, 526 run files under `.coding-flow/runs/`: 341 verify, 86 evidence,
   99 review), plus adversarial cases replayed against the real
   `bin/lib/guard.js` in a throwaway repository.

Everything below is either **measured** (a number from the runs, or a case run
against the real module) or **read in the code** (with the line). Nothing is
taken from the audit without one of the two.

## What was measured

### Guard (`bin/lib/guard.js`, `evaluate()` called directly)

| Case | Decision |
|---|---|
| Write `.env`, `sub/../.env`; Bash `> .env`, `tee`, `cp`, `mv`, `sed -i`, `dd of=`; NotebookEdit `.env`; AWS key in content | deny (correct) |
| Write to `alias` where `alias -> .env` | **allow** |
| `ln -s .env x && echo A=1 > x` | **allow** |
| `echo A=1 > alias` | **allow** |
| `cd sub && echo A=1 > ../.env` | **allow** — resolved against the root, `cd` ignored |
| `F=.env; echo A=1 > $F` | **allow** |
| `python3 -c "open('.env','w')…"`, `node -e "…writeFileSync('.e'+'nv')"` | **allow** |
| `bash script.sh` (script writes `.env`) | **allow** |
| `git checkout stash@{0} -- .env` | **allow** |
| `echo k >> ~/.ssh/authorized_keys` | **allow** — `~` not expanded |
| Write `/other/checkout/.env` (outside the root) | **allow** — the path is `../…`, no pattern matches |
| Unknown tool name / unparseable input / exception | **allow** (`evaluate` catch → "failing open") |

Two consequences not in the audit:

- A story worktree's `.env` is a **symlink to the primary checkout's `.env`**
  (`worktree.js` `ENV_FILES`). From the worktree, the absolute path of the
  primary `.env` is outside the root and is allowed.
- `root` is the hook's `cwd` (`guardCommand`). A session opened in a
  subdirectory of a monorepo sees the repository's `.env` as `../.env`: same
  "outside the root" hole.

During the measurement session, the guard running in Claude Code refused a
`printf > .env` used to build the fixture — and a `bash setup.sh` doing the same
thing went through. Both behaviours are the current design; only the first is
documented.

### Proof (bethl, 341 verify runs)

- **The diff base is always the default branch.** Five call sites
  (`harness.js` `addedLinesByFile`, `changedFilesForCoverage`,
  `changedLinesForCoverage`, and the two at ~1934/~1963) use
  `defaultBranch(root)`, which is `origin/HEAD` or `"main"`. bethl's stories
  branch off `feature/EPIC-32-geo`. Last verify of story 32-03: **508 changed
  files, 82 test files** — the whole epic plus everything not yet in `main`.
  Replayed: `merge-base main <commit>` → 505 files, 76 commits, 117 of them
  run JSON files. So every story of an epic satisfies the coverage gate with
  any test changed anywhere in the epic, and 71 of 86 evidence files score
  `high` risk from migrations/auth touched by other stories.
- **No run ever measured line coverage.** Coverage modes: `test-file` 185,
  `none` (docs-only) 29, not required 58, pre-gate 69, **line-level 0**.
  `coverage.js` looks for one report at the root (`coverage/lcov.info`…); the
  monorepo writes `apps/api/coverage/lcov.info`, and only the first report
  found is ever read.
- **Green with contrary signals.** 42 `ok` runs carry `weakenedTests` (latest:
  3 test files deleted, 13 assertions removed); 103 `ok` runs have unchecked
  acceptance criteria. Both are recorded, neither changes the verdict.
- **Cache replay is invisible.** Of 318 `npm run test` results with readable
  output, 132 were full turbo cache replays (median 5.9 s); after switching
  to `--force`, median 183 s, max 773 s, two timeouts (exit 124) against the
  fixed 600 s limit (`runValidationCommand`). The evidence does not say which
  results were replays.
- **Commands.** 341/341 runs used `commandSource: config` — story-supplied
  commands never ran in practice.
- **Reviews.** 94/99 are `reviewer: self`; one `verdict: pass` carries an open
  P1.
- **Install drift.** bethl's manifest says 0.10.0 while 0.12.1 is current.

### Read in the code (not replayed)

- `findReusableVerify` (`harness.js` ~2344) reuses a green verify when the tree
  token (which excludes `.coding-flow/`), `commandsFingerprint` and the
  untracked digest match. A change to `harness.json` (risk terms, blocked
  paths, coverage reports, mode) does not invalidate it.
- `ship.js:313` stages with `git add -A`.
- The tracked `.opencode/plugins/coding-flow-guard.js` holds
  `/home/landry_pouth/dev/tools/coding-flow/bin/ai-flow.js`.
- GitHub Releases stop at v0.8.3; the package is at 0.12.1.
- OpenCode 2.x does not run the V1 plugin shape: guard absent, "1 plugin
  failed", `.env` written by a real model (measured 2026-10-16 on 2.0.30).

## Where the audit is right, and where the runs disagree

Right, and confirmed: symlink bypass, fail-open, weak `test-file` evidence,
policy changes not invalidating proofs, `git add -A`, tracked absolute path,
release drift.

Corrected by the runs:

- The audit feared **under**-classified risk. bethl shows the opposite failure:
  nearly everything is `high` because the diff is the whole epic. A risk score
  that is always high carries no information; fix the scope first (epic-07).
- The audit ranks story-supplied commands as a P1/P2. They never ran in 341
  runs; the real "commands vs execution" gap is cache replay (epic-09).
- Splitting `harness.js` and tamper-proof evidence matter for a team, not for
  the current single-maintainer use. Kept, last.

## Order

| # | Epic | Why this position |
|---|---|---|
| 1 | `epic-06-opencode-v2-guard` | The guard is fully off on OpenCode 2 today. Small, prototype already validated on V1 1.19 and V2 2.0.30. |
| 2 | `epic-05-guard-hardening` | Closes the measured bypasses; introduces the third decision state other epics reuse. |
| 3 | `epic-07-proof-scope` | Every coverage and risk verdict is currently computed on the wrong diff. Nothing downstream is meaningful until this is fixed. |
| 4 | `epic-08-evidence-levels` | Makes the strength of a proof explicit and ties it to the policy it was produced under. |
| 5 | `epic-09-monorepo-proof` | Turns on line coverage and cache-replay honesty for the project shape actually used. |
| 6 | `epic-10-execution-and-ship-safety` | `ship` scope, CI command policy, cross-OS matrix, releases. |
| 7 | `epic-11-maintainability-and-measurement` | Extraction of `harness.js`, real-agent smoke suite, the benchmark, a status heuristic fix. |
| — | `epic-12-core-first` | The audit's "core first, layers optional": verify keeps coverage/risk without stories, `--help` never acts, minimal stays minimal, a layering test, docs. Its stories slot into the waves below. |

## Parallel waves

`bin/lib/harness.js` is the shared hot spot (epics 07, 08, 09, 10-02, 12-01
all edit it): keep **at most two harness-heavy worktrees open at once**.

| Wave | Run in parallel | Waits for |
|---|---|---|
| 1 | epic-06 · epic-07 · epic-09 · stories 10-02, 10-04, 11-03, 11-04, 12-02 | nothing |
| 2 | epic-05 · epic-08 · stories 10-01, 12-01 | 05: epic-06 landed. 08, 10-01, 12-01: story-07-01 landed |
| 3 | stories 10-03 (CI matrix), 11-02 (host smoke) | 10-03: epic-05 (symlink tests must exist to be skipped on Windows). 11-02: epics 05 and 06 |
| 4 | story 11-01 (split), then 12-03 (layering test), then 12-04 (docs) | everything else landed |

Harness-heavy in wave 1: 07 and 09 (two). In wave 2: 08 and 12-01 compete
with each other and with 10-02 if still open — start 08 first.
