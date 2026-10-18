# Uncle Bob's gauntlet, clean code and clean architecture — study

**Status: epics 01–12 have landed (0.13.0); re-measured 2026-10-18 — see the
next section, which supersedes the numbers below it where they differ. Planned
as epic 13 (this repository's own bar), story 14-07 (CRAP for users' projects,
inside the recovery epic, `docs/plans/codebase-recovery.md`) and epic 15
(everything else the study recommends).** Written 2026-10-17. Every number below
is either measured on this checkout (its `.coding-flow/runs/`,
`docs/DOGFOODING.md`, `git log`) or comes from an experiment run in a
throwaway worktree.

## Re-measured 2026-10-18, after epics 01–12

| Measure | 2026-10-17 | 2026-10-18 | Reading |
|---|---|---|---|
| Verifies at `verified` | 0 / 158 | **0 / 206** (118 `evidence`, 38 `not-required`, 50 pre-rung) | Unchanged: the strongest rung is still never reached here. |
| Full suite under native lcov (`--experimental-test-coverage --test-reporter=lcov`) | tried on one file | **whole suite: 1 118 tests, 161 s vs 145 s plain (+11 %)**; 96.3 % lines, 85.0 % branches on `bin/` | `verified` is a config change away. |
| Code run in spawned CLI subprocesses counted? | unknown | **yes** — `bin/ai-flow.js`, only ever run as a subprocess by the tests, reports 97 % lines | The open question of experiment 2 is closed. |
| Reviews | 56 / 59 `self` | 62 / 65 `self`, 3 `subagent`; 31 P1 found by review, 0 P0 | Unchanged. |
| Stories recommended STRICT (13 `-evidence` runs carry a mode) | 0 | **1** — story 11-01, `high`, because the file it created, `security-policy.js`, happens to match the default `**/*policy.*`. The three epic-05 guard stories scored `medium`/`standard`: `bin/lib/guard.js` matches no default high-risk path | STRICT reached the security core by a naming accident, never by intent; wave 0 still applies. |
| guard → harness | yes | **no** — `guard` requires `harness-config`, `security-policy`, `util` only | Fixed by 11-01. |
| core → optional layer | yes | **no** — enforced by `test/layering.test.js` (12-03) | Fixed. |
| Require cycles in `bin/lib` | `harness` ↔ `policy-fingerprint` | **none** | Fixed. |
| `harness.js` | 3 233 lines | **563** | Split by 11-01 into `harness-config`, `security-policy`, `diff-scope`, `risk`, `validation-run`, `coverage-gate`, `evidence`, `harness-report`. |
| `shellWrites` (`guard.js:434`) | 322 lines | **331 lines, ~110 decision points, 99 % covered** | Covered but enormous: a CRAP score of ≈ its complexity says "complex", and the epic-05 history says its risk is missing cases, not weak tests. Wave 2's split still stands. |
| Functions over 100 lines (lcov `FN` ranges, nested counted) | 12 top-level | 20 (method differs; not comparable) | Largest: `shellWrites` and its three inner helpers, `worktreeLand` 238, `collectDoctorReport` 221, `evaluateCoverageResult` 199. |
| CRAP-like > 30 | — | 5, all in `guard.js` (shell reading) plus `buildReport` | Coverage is high everywhere; complexity is the signal. |

**New holes, found while re-measuring and in the recovery field test:**

- **A migration-only diff verifies green.** `**/migrations/**` and `**/*.sql`
  are in both `highRiskPaths` and `nonBehaviorGlobs`; the second wins in
  `coverage-gate.js` (~343). Replayed in a throwaway repository: a branch
  adding `ALTER TABLE users DROP COLUMN email;` → `verify` ok, coverage
  `not-required`, reason *"no behavior file changed (docs, story, or lockfile
  only)"* — which is also untrue. Story 13-01.
- **The "Long assigned credential" heuristic matches command substitution**:
  `password="$(aws secretsmanager get-random-password …)"` is reported. Story
  13-02.
- **Two `high` rows of `docs/DOGFOODING.md` are still open** (`worktree land
  --dry-run` writes; story worktrees invisible to `flow-review`/`status`).
  The log's own rule puts them ahead of any roadmap, this one included.

## Sources, and what they actually say

- **Robert C. Martin, as reported by alexrusin.com** — five narrow agents per
  story: *Specifier* (Gherkin acceptance criteria + QA procedure), *Coder*
  (unit tests + code), *Cleaner* (CRAP analysis, tidy-up), *Hardener*
  (mutation testing, rejects weak tests), *QA* (procedure → script). He does
  not read agent code; he reviews the acceptance tests. Humans own module
  boundaries, enforced by a dependency specification file and a checker.
  Cost: a 5-minute task becomes about an hour. The central lesson: 5–10 page
  prompts were ignored, so **enforcement moved from instructions into
  deterministic tools**. Also: "plan less, iterate more", specs are disposable.
- **explainx.ai** — more cautious. Martin on mutation testing: *"just because
  we can do them doesn't mean we actually should."*
- **`robert-hoffmann/uncle-bob`** — unrelated to Martin; prose skills only,
  nothing executed. Nothing to take.
- **`amazingang/old-coder`** — human-approved SPEC → gauntlet → EVIDENCE
  report; "anything unverified is labeled `unverified`, never `pass`"; "if no
  human approved the spec, say so". The closest to this tool, which already
  has the same honesty rule (`NOT PROVEN`, coverage rungs).

**Overall verdict.** Martin's thesis is this tool's thesis (design-decisions
entry 5: *"a skills layer is a commodity … the enforcement is the product"*).
This is a validation, not a change of direction. What the study adds is where
coding-flow's own dogfood shows the gauntlet's ideas would close a measured
gap.

## What the dogfood says

### Runs on this repository

| Measure | Value | Reading |
|---|---|---|
| Coverage rung of the 158 verifies | **0 `verified`**, 97 `evidence`, 23 `not-required`, 38 pre-rung | The tool has never proven its own strongest rung on itself. |
| Node 22 native lcov (`node --test --experimental-test-coverage --test-reporter=lcov`) | Works, zero dependency (tried on `test/status.test.js`) | `verified` is reachable by configuration. Whether code run in spawned CLI subprocesses is counted is not yet confirmed. |
| Reviews | 59 captured: **56 `self`**, 3 `subagent`; 30 P1 found **by review** | Review is catching what the tests did not. |
| Stories 05-01 / 05-02 / 05-03 | **10–12 review passes each**, ~24 h each, 37 `(story 05-0x review)` fix commits | Epic 04 was created because six passes on story 03-02 was too many. It got worse. |
| `verdict: pass` with an open P1 | 3 | Story 08-04 addresses it. |
| Stories of this repository that ran STRICT | **0** | `bin/lib/guard.js` is not in this repo's `highRiskPaths`, so the independent-review rule never applied to the security core. |
| `DOGFOODING.md` rows about worktrees | **12 of 38**, 10 still marked open in the log | The single largest friction source. |

### What the epic-05 P1s were

Read from the commit subjects: each pass found a **new shell form the guard
did not handle** — `bash -c`, `eval`, heredoc-fed interpreters, quote-spliced
targets, `sponge`, `ed`, `perl -E`, `-t` flag clusters, line continuations.
These are not weak tests. They are **code that did not exist, because the list
of cases (the spec) did not exist.** The review was acting as Martin's
Specifier, one case per pass. And story 05-05, the adversarial corpus, is the
**last** story of the epic: the order is inverted.

### Experiment 1 — a diff-scoped mutation probe

A zero-dependency script took the 1 021 lines `guard.js` gained in epic 05,
found 183 sites matching a small operator table (`===`↔`!==`, `&&`↔`||`,
`<`↔`<=`, `true`↔`false`, dropping a `!`), sampled 30 deterministically, and
ran the guard test files once per mutant in a detached worktree.

**27/30 killed in 5 minutes (~10 s per mutant).** The three survivors:

| Site | Verdict |
|---|---|
| `strictOutcome`, `let strict = false` → `true` | Equivalent mutant (overwritten before use). |
| `sedFiles`, `let script = false` → `true` | Weak assertion: tests assert `deny`, never the set of paths found. |
| directory-destination check, `base !== null` → `===` | **Real gap**: `cp X existing-dir` without a trailing slash is never tested; every test uses `sub/` or `.`. |

The double-edged conclusion: the probe is feasible zero-dependency, fast here,
and finds real gaps — but it **would have found none of the epic-05 P1s**.
Mutation tests the tests of code that exists; it cannot reveal missing code.
Mutation (Hardener) and spec-first (Specifier) cure two different failures.

### Experiment 2 — a CRAP-like score from lcov alone

lcov already carries function starts (`FN`), branches (`BRDA`) and line hits
(`DA`). A 30-line script computes per function `comp² × (1 − cov)³ + comp`
with no language parser. On one test file's coverage the top entries were
plausible: `readHarnessConfig` (complexity 26), `resolveDepsStrategy` (53 %
covered), `applyDeps` (12 %). **Limit:** V8 reports block coverage, so
"branches" approximates decision points; the score is a heuristic and must be
labelled as one. The same `FN` ranges also give function length in any
language that emits lcov.

## Clean code and clean architecture — in the tool itself

| Finding | Measure |
|---|---|
| God module | `harness.js`: 3 233 lines, fan-in 11, 38 commits since 2026-08-01 of which 13 fixes |
| **The security core depends on the god module** | `guard.js` → `harness.js` |
| **The core depends on an optional layer** (Dependency Rule inverted) | `harness.js` → `story.js`, `speckit.js` |
| Cycle | `harness.js` ↔ `policy-fingerprint.js` (worked around with a lazy `require`) |
| Function size | 593 top-level functions, median 13 lines, p90 50; 59 over 50 lines, 12 over 100 |
| Hotspots | `shellWrites` **322 lines**, `guard.js` 25 fixes in 32 commits; `worktreeLand` 238, `autoLandIfChainFinished` 164, `landCleanup` 104 |

Friction and review passes concentrate where the functions are largest —
Martin's "messy code slows agents", measured on this repository.

Stories 11-01 (split `harness.js`) and 12-03 (layering test) already point the
right way. This study adds one criterion: **split along the Dependency Rule,
not only along responsibilities.**

```text
policy (pure)    harness.json loading, globs, secret patterns, risk rules, coverage rungs
use cases        guard evaluate, verify, coverage gate, review capture
adapters         git, fs, command runner, lcov parser, host plugins (Claude / OpenCode / Codex)
optional layers  stories / epics / speckit, worktrees, ship, skills
```

Rules that follow:

- The guard depends only on policy and path resolution — never on `harness.js`.
- Shell reading (`shellWrites`) becomes a pure module whose executable spec is
  the story 05-05 corpus.
- Story 12-03's test **is** Martin's "dependency specification file and
  checker", applied to the tool. A require-graph checker is ~30 lines,
  zero-dependency.
- A **size ratchet** in this repository's `validation.quality`: no function
  touched by a diff may grow past a threshold; existing large functions are
  grandfathered. Debt stops growing without a big-bang refactor.

## Clean code and clean architecture — in users' projects

`templates/RULES.md` already states good rules (*keep functions small*, keep
business logic out of UI, one bounded context per epic). They are prose, and
prose is exactly what Martin found agents ignore. Turning them into signals:

1. **CRAP and function size on the diff, from lcov.** Language-agnostic for
   anything that emits lcov (Jest, Vitest, c8, coverage.py, JaCoCo via
   conversion). Report the functions **the story touched** with a CRAP above
   30 (Martin's threshold) or that grew past N lines. A ratchet, not a
   refactor mandate. The tool computes it, not the agent, so it may lower a
   verdict without breaking the direction rule (entry 9). Depends on epic 09
   making coverage measurable at all.
2. **Boundaries.** Start with a per-stack recipe through `validation.quality`
   (dependency-cruiser, import-linter, ArchUnit, ESLint `complexity` /
   `max-lines-per-function`) plus detection of those rule files being
   loosened (wave 3). A native checker limited to the diff's added import
   lines stays an option to be measured first — path aliases make it harder
   than it looks for an uncertain gain.
3. **`/flow-plan`: humans own boundaries.** A `## Boundaries` section in an
   epic's `index.md`, approved by the human, which feeds the dependency
   configuration.

## The other tool's three recommendations

| Recommendation | Verdict | Reason |
|---|---|---|
| Mutation testing (`--mutation`, a `VULNERABLE` status) | **Taken, reshaped** (wave 5) | Fills a measured gap, but no new verdict vocabulary — entry 9 showed two vocabularies for one question hurt readability. Survivors are a contrary signal under the existing `NOT PROVEN`. |
| A "cynical senior" persona in `/flow-review` | **Already done** | Story 04-04: a fresh subagent, given only the artifact and the contract, with adversarial framing. A persona is more prose, the thing Martin dropped. |
| Signed, tamper-proof evidence | **Refused** | The agent runs as the same OS user: it can read the key and call `node` to sign. A signature proves who wrote a file, not that tests ran (epic 08's out-of-scope note). `ai-flow ci init` replays verify on a clean checkout; for a team, make it a required branch-protection check. The real local gap is narrower: `.coding-flow/runs/**` is not in `blockedPaths` (wave 0). |

## Programme, after epics 01–12

| Wave | Content | Measured premise | Cost |
|---|---|---|---|
| **0 — config only** | On this repository: native lcov in `validation.commands`; `bin/lib/guard.js`, `policy.js`, `harness.js` in `highRiskPaths`; `.coding-flow/runs/**` in the default `blockedPaths` | 0 `verified`, 0 STRICT, evidence files writable by the agent's Write tool | Minutes |
| **1 — spec first** | (a) `/flow-plan` rule: for a parser- or policy-shaped story, the adversarial corpus is the **first** story, not the last. (b) A criteria-drift signal: compare the acceptance criteria at the story's diff base (epic 07) with HEAD; ticking is silent, removed or reworded criteria are reported, and a spec born inside the diff is reported as "the specifier is the coder" (old-coder's rule) | 10–12 review passes, P1s that were spec gaps | S |
| **2 — the tool's architecture** | 11-01 split along the Dependency Rule, 12-03 layering test, size ratchet in this repo's `validation.quality` | guard → harness, core → layers, a 322-line function | M |
| **3 — the bar does not move** | `policyGlobs` in `harness.json`: a diff touching lint config, coverage thresholds, dependency rules or `harness.json` is a contrary signal; strict fails unless a `## Policy Change` section explains it (lowers the claim, so the direction rule allows it). Also fix `nonBehaviorGlobs`, which today makes `**/*.config.js`, `**/.eslintrc*` and `tsconfig*.json` invisible to every signal | Hole read in the default config | S/M |
| **4 — lcov signals for users** | CRAP and size ratchet on the diff | Experiment 2 | M |
| **5 — mutation probe** | Opt-in via `harness.json` (`mutation: { command, maxMutants }`), `high`-risk diffs only, sites drawn from the story's added lines, deterministic sampling seeded by the tree token, executed in a throwaway worktree (never in the user's tree), result stored as `mutation: { killed, survived[], durationMs }`, `## Mutation Exemption` for equivalent mutants | Experiment 1: 90 % killed, ~10 s/mutant here. **Replay offline on bethl first** (183 s suite median, so a targeted test command is mandatory); drop it if it finds no real gaps there | L |

Known limits of wave 5, to be printed rather than hidden: in compiled
languages a non-compiling mutant counts as killed; equivalent mutants exist;
the textual operator table skips strings and comments heuristically.

## Refused

- **Five agents per story.** The measured complaint was 1h30 per story
  (entry 1); Martin's own figure is 5 min → 1 h. Waves 1 and 3 give the same
  separation deterministically.
- **Persona prompts**, for the reason in the table above.
- **Cryptographic signing of evidence.**
- **A native multi-language import-graph analyser, or native CRAP from a
  parser.** One parser per language breaks zero-dependency; lcov and existing
  tools cover it.

## Programme as planned, 2026-10-18

The waves above, re-cut against the re-measurement. Wave 2's split along the
Dependency Rule is done (guard decoupled, layering test, no cycle); what is
left of it is the size ratchet and `shellWrites`.

| Where | Content | Wave |
|---|---|---|
| epic 13, s1–s2 | migrations are behavior; secret heuristic false positive | bugs, ahead of everything |
| epic 13, s3 | lcov in this repo's validation, its security core in `highRiskPaths`, `.coding-flow/runs/**` blocked by default | 0 |
| epic 13, s4 | the bar does not move: policy-weakening signal, config-like `nonBehaviorGlobs` | 3 |
| epic 13, s5 | spec first: corpus-first rule in `/flow-plan`, criteria-drift signal | 1 |
| epic 13, s6 | size ratchet on touched functions | 2 (ratchet) |
| epic 14, s7 | CRAP and size from lcov for users' diffs and hotspots | 4 |
| epic 15, s1 | Experiment 1's two survivors pinned by tests (`cp X existing-dir`, sed targets) | 5 (findings) |
| epic 15, s2 | `shellWrites` as a pure module, proven by `--claim refactor` | 2 (split) |
| epic 15, s3 | users' projects: `## Boundaries` in `/flow-plan`, per-stack boundary and complexity recipes | users, items 2–3 |
| epic 15, s4–s5 | mutation probe: offline replay on bethl, then opt-in only on a go | 5 |
| epic 15, s6 | re-take *How to tell it worked* | — |

Wave 4 moved into the recovery epic because its first consumer is the
recovery scan's hotspot ranking. Epic 15 holds everything else the study
recommended: the split and the mutation probe both wait for 14-04
(`--claim refactor`), the place they pay most; s5 is built only if s4's
replay on bethl finds a real gap.

## Open question

The worktree layer is 12 of 38 friction rows and holds three of the six
largest functions. Martin would say *plan less*. If the friction persists once
epics 02/03 are stable, the answer is to make the layer optional (in the
spirit of epic 12), not to extend it.

## How to tell it worked

All readable from `.coding-flow/runs/`:

- review passes per STRICT story — **12 today**, target ≤ 3;
- share of P1s caught by `verify` rather than by review;
- share of verifies at `verified` — **0 % today**;
- surviving mutants per story;
- new worktree rows in `docs/DOGFOODING.md`.

## Reproducing the measurements

The two experiments and the run analysis were scratch scripts, not committed.
Their method is fully described above; to re-run:

- **Runs:** group `.coding-flow/runs/*.json` by suffix (`-verify`, `-review`),
  then count `coverage.tier`, `reviewer`, `verdict`, `findingCounts.p1` per
  `story`.
- **Mutation:** `git worktree add --detach <tmp> HEAD`; take the `+` lines of
  `git diff -U0 <base> HEAD -- bin/lib/guard.js`; for each sampled site, apply
  one operator swap, run `node --require ./scripts/test-env-guard.js --test
  test/guard*.test.js test/opencode-guard.test.js`, record exit code, restore.
- **CRAP:** run a test file with `--experimental-test-coverage
  --test-reporter=lcov --test-reporter-destination=<file>`; per `SF`, split by
  `FN` start lines, count distinct `BRDA` points and `DA` hit ratio per range.
