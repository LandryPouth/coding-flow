# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.8.4] - 2026-08-19

### Added

- **Epic `index.md` carries a story dependency tree instead of a `Parallel-safe:`
  line.** The flat line named which stories could run in parallel; the tree makes
  the dependency structure itself visible — sibling branches are the parallel
  stories (one worktree each), and a `──┴──` merge is where one story consolidates
  several. `/flow-plan` teaches and writes the tree with short `s<number>` labels;
  zero CLI.

## [0.8.3] - 2026-08-19

### Added

- **The skills are tested now.** The CLI had 433 tests; the seven skills had none —
  nothing proved that `flow-status` wins *"show me every epic"* while losing *"what
  should I do next"* to `flow-next`. `evals/` adds two deterministic, zero-dependency
  tiers inside the existing `npm test`: an anatomy lint (frontmatter, naming,
  description budget, a required `## Verification` section, one case file per skill)
  and a lexical routing check (a prompt must rank its owner first, must not be won by
  a neighbour, and no two descriptions may near-collide). Nothing here ships to npm.
  See [`evals/README.md`](evals/README.md).

- **A `## Verification` section in all seven skills**, anchored to output rather than
  judgment: `/flow-run`'s boxes are the `Coverage:` rung as printed and a captured
  green verify; `/flow-plan`'s notes that criteria written as prose are invisible to
  `verify`. A box you cannot point at output for is not ticked. The lint fails the
  build if a skill drops the section.

- **`/flow-review` now handles its most common case:** reviewing a diff the same agent
  wrote minutes earlier, where re-reading the reasoning that produced the defect
  reproduces the same conclusion. New *Reviewing Your Own Diff* section — write the
  contract before opening the diff, re-derive instead of recall, findings before
  verdict, and when delegating pass the artifact and the contract only, never your
  conclusion. Plus `## Red Flags` and three rationalization rows.

### Changed

- **`/flow-run`'s description no longer carries the intensity decision rule.** It
  spelled out the whole QUICK/STANDARD/STRICT rule, so an agent could pick a mode from
  the description and never load the skill — missing that risk is read from the diff,
  that `requireTestChange` must not be disabled, and what the coverage rungs mean.

- **`/flow-run` and `/flow-review` descriptions carry the words users say.** The eval
  found *"code this story, this one touches permissions"* routing to `flow-status`,
  because `flow-run` said "alters an authorization decision" and never "permissions".
  *"is this diff safe to ship"* lost to `flow-ship`, because `flow-review` never said
  "diff". Routing rank-1 went 77.3% → 86.4%.

## [0.8.2] - 2026-08-19

### Fixed

- **`upgrade` now re-wires the guard hook.** The hook command hard-codes the absolute
  path of the binary that wrote it, so upgrading the package left that path pointing
  at the *old* copy — an npx cache directory keyed to the old version keeps existing
  and keeps working. `init` refreshed the wiring; `upgrade` never did. The effect was
  that an installed project silently kept enforcing with the version it was set up
  with, forever, and **every guard fix would ship to npm and reach nobody**. Found by
  reading a real project's `settings.json`: it was executing 0.7.0 two releases later,
  with the pre-`Bash` matcher, so shell redirections were not intercepted at all.

  `upgrade` also promotes a matcher we shipped as a default before it covered `Bash`.
  A matcher you customised is still your decision and survives untouched. Opt out with
  `upgrade --no-guard`.

- **`report` no longer buries the failure it exists to carry.** The output filter
  matched `/fail/`, and test names are prose: `ok 395 - verify in an uninitialised
  directory fails cleanly` is a **pass**, and it was being promoted to the top of the
  bug report while the real failure was nowhere on the page. Passing lines, progress
  lines and zero counters are now excluded — and `not ok`, TAP's actual failure
  marker, was missing from the signal list entirely, so the one line naming the broken
  test was dropped from every report ever generated.

- **The failure is selected from the whole output, not from the tail.** Only the last
  4 KB of a command's output was retained, and a verbose runner pushes the failure out
  of that window long before the end — the report would honestly say `# fail 1` and
  nothing else. Failing runs now record the lines that name the failure, chosen while
  the full stream is still in memory. Older evidence files fall back to the same
  selection over the tail. `verify` prints them too, instead of the tail of `stderr`,
  which is empty for every runner that reports on stdout.

### Added

- **A green verify lists the acceptance criteria still unticked.** `verify` proves
  that the declared commands ran and passed; it has never had anything to say about
  the story's own claims, so a story could go green with every criterion
  unimplemented. The unticked ones are now printed under the verdict.

  This is information, not a gate: it adds no configuration, cannot change the exit
  code, and prints nothing on a red run or a fully ticked story. It deliberately does
  **not** bind a criterion to a named test — that binding would be authored by the
  same agent that writes the code, so it could only raise what the tool asserts on the
  agent's own word. See `docs/design-decisions.md` entry 9, which also records why the
  full Claim Check subsystem was started and abandoned.

## [0.8.1] - 2026-08-18

### Fixed

- **A test file that only got weaker no longer counts as "a test changed."** The
  `evidence` rung is earned when a behaviour file and a test file both appear in the
  diff, and the *direction* of the test change was never read — so the cheapest way
  past the gate was to touch a test, and deleting an assertion, adding `.skip`, or
  removing the file outright all count as touching one. An agent does not have to be
  adversarial to land there: "the test was failing, so I removed the assertion" is an
  ordinary move.

  Three signals are now read over the diff of files matching `testGlobs`: a test file
  **deleted**, **skip/only markers added** (`.skip(`, `.only(`, `xit(`,
  `@pytest.mark.skip`, `t.Skip(`, `#[ignore]`, …), and a **net decrease in assertion
  count**. `.only` counts as weakening because it does not skip the test it marks —
  it silently skips every other test in the file.

  The fix is deliberately narrow. It is **not a new gate and adds no configuration**:
  a diff whose test changes are exclusively weakening lands exactly where a diff with
  no test change lands (`NOT PROVEN`, same `## Test Exemption` escape), and it rides
  on `requireTestChange` so there is no second switch to turn off. Neutral edits — a
  rename, a typo — still count as strengthening: this reads direction, not effort.

  Weakening is **reported at every rung, including `verified` and including under a
  declared exemption**, in the terminal and in the evidence JSON. A measured 92%
  standing next to three deleted tests is still three deleted tests; letting a good
  number hide that would be the dishonesty the coverage rungs exist to prevent.

  These are regexes over a diff, not a parse: they cannot distinguish a weakened test
  from a legitimately refactored one, which is exactly why the finding informs the
  rung and reports itself rather than blocking on its own. See
  [`docs/design-decisions.md`](docs/design-decisions.md) entry 8.

## [0.8.0] - 2026-08-18

**The first release decided by evidence rather than by judgement.** Thirteen days
of real use on a project this tool did not design (`imob`, 110 recorded runs) said
it was wrong about one thing and slow about another. The wrong thing was costing
whole hours per story; the slow thing was costing milliseconds. Everything below
follows from reading `.coding-flow/runs/` instead of reasoning about it — which is
also why the release adds the command that makes those runs readable by somebody
who is not the author, and why the tool is finally installed on itself.

### Added

- **`ai-flow report` — one file a user can send back.** Guard denials, verify
  failures with the lines that explain them, the risk/coverage/mode distribution,
  and install health, collected from what the harness already recorded. It exists
  because the alternative is a description: someone who hits a bad gate remembers
  that "it blocked something", not which pattern fired on which path — and a tool
  whose argument is that executed proof beats assertion cannot collect its own bug
  reports by assertion. **Redacted by default**: paths are relative to the project,
  the home directory and username are masked, and no secret value is ever recorded
  (only the name of the pattern that matched). `--raw` keeps everything for your own
  repositories, `--json` for machines, `--out FILE` to write it.
- **Guard denials are recorded.** A refusal used to be exit 2, a line on stderr,
  and then nothing — so the one event most worth keeping, the guard being *wrong*,
  left no artifact to argue with. One redacted JSONL line per denial in
  `.coding-flow/denials.jsonl`, capped, and best-effort by construction: it cannot
  throw, cannot delay the decision, and cannot change it. A test asserts the
  refusal and the allow both survive an unwritable log.
- **The friction log ships with the enforcement layer.** `docs/DOGFOODING.md` was
  full-install only, on the reasoning that `--minimal` promises no files beyond the
  guard and the harness. That held while the only user was the author. An
  enforcement layer handed to someone else with no return channel is a gate they
  can only switch off, never argue with — so the manual half (the log) now ships
  wherever the automatic half (`report`) does. `--minimal` still lays down no
  `RULES.md`, no `epics/`, no skills, and no other `docs/`.
- **Coding Flow is installed on Coding Flow.** The config existed but declared no
  validation commands and had never produced a run, which is worse than not
  installing it: it looked like dogfooding. It now declares `npm test`, and the
  first real verify caught a regression that the per-file runs had missed.

### Fixed

- **Prose no longer forces STRICT.** `scoreStoryRisk` substring-matched 17 terms
  over the whole story text, and one hit meant `high` — so `auth` fired on
  "author", `token` on "design tokens", and `migration` on a story titled *color
  migration*. Because `combineRisk` takes the higher of the two scores, the story
  side was pinned at `high` and the diff-derived score could never win: 39 of 39
  recorded evidence records ran at STRICT, paying TDD, Security Questions and a
  mandatory deep review for hero recompositions and video players. Matching is now
  whole-word, and prose tops out at `medium`; only `scoreDiffRisk` — which reads
  what the change actually touches — can reach `high`. Replayed over the same 39
  records, STRICT drops from 100% to 31%, and the 12 that remain are genuine
  (`schema.prisma`, `migration.sql`, `auth.controller.ts`). A story that names a
  risk still raises a quiet change to `medium`, so the coverage gate keeps firing
  exactly where it fired before.

### Changed

- **The guard dispatches before the rest of the CLI loads.** It runs before every
  Write, Edit and Bash, so it paid for all 21 lib modules — `ship`, `worktree`,
  `doctor`, `templates` — plus `crypto` (OpenSSL bindings) reached through
  `util.js`, none of which it uses. Argument parsing moved above the requires and
  `guard` now returns from its own branch; `crypto` and `child_process` load where
  they are called. Overhead above bare Node startup: 67.8 ms → 26.2 ms, measured
  interleaved. `test/guard.test.js` pins the module graph so it cannot creep back.
- **`flow-run` and `flow-review` carry a Common Rationalizations table**, and
  `flow-run` a Red Flags section — the anti-excuse prose that was already spread
  through both skills, gathered where an agent reaches for the excuse.
- **`docs/agent-contract.md` states what the core refuses**: the guard stays one
  process per decision (no resident daemon), and policy never moves into a
  `SKILL.md` frontmatter. Skills are behaviour; `harness.json` is policy.

### Added

- **`skills/` and `templates/.claude/skills/` are checked for drift.** Two shipped
  copies of the same seven skills, and nothing compared them until now. Plus a
  500-line ceiling per `SKILL.md`, documented in `docs/contributing.md`.

## [0.7.0] - 2026-08-18

Gaps between what this tool promised and what it enforced, closed. Each was a
place where the README made a stronger claim than the code: a guard that only
watched one of the two write paths, detectors nobody could tune, and a `verified`
label that a change with no test could earn. Then two things that decide whether
any of it gets adopted at all — the smallest install is now the enforcement layer
alone, and the enforcement layer reads somebody else's spec format as readily as
its own.

### Added

- **The guard watches shell writes too.** The PreToolUse hook now matches `Bash`
  alongside the editing tools, and refuses a command that would write to a blocked
  path through a redirection or heredoc (`> .env`, `cat > .env <<EOF`), `tee`,
  `sed -i`, `cp`/`mv`/`ln`/`install`, or `dd of=`. A real credential format in the
  command text is refused as well. It parses shell text, not program semantics —
  a write buried inside `python -c` is still out of reach, and the README now says
  so instead of claiming a leak "can't happen". Existing projects gain the wider
  matcher on the next `init`/`upgrade`, but only if their matcher is one *we*
  shipped; a matcher you customized is left alone.
- **Secret detectors live in `harness.json`.** The patterns are written out in
  full, so a project can read, edit, extend, or delete them. Each carries a
  `precision`: `exact` matches a credential *format* (Stripe, AWS, GitHub, a
  private-key block) and applies everywhere, always; `heuristic` matches a *shape*
  (`password: "…"`) and is relaxed on the paths in `secretScanAllowlist` — docs,
  story files, tests, and fixtures by default. So an example in your documentation
  stops being refused, while an AWS key in that same file still is. A pattern
  written wrong is reported by `harness check` (`scans nothing`) rather than
  silently matching nothing, and never breaks the hook.
- **A coverage gate on `verify`.** On a medium/high-risk story, a green suite is
  no longer accepted as proof on its own: if the branch's diff changes behavior and
  no test file moved, `verify` reports `NOT PROVEN` and exits 1. Executing the
  commands proved they ran; it never proved they covered *this* change, and a suite
  that was already green before the edit says nothing about it. The evidence now
  separates `commandsOk` from `coverage`, and `ship` carries the coverage line into
  the PR body. Narrow by design: low-risk stories, docs/story/lockfile-only diffs,
  and repos where the diff cannot be read never trip it. A change that genuinely
  cannot carry a test declares a `## Test Exemption` section in its story, or
  `--test-exemption "<reason>"` on the command — the reason is copied verbatim into
  the evidence and the PR, so the escape hatch is a recorded claim rather than a
  silent bypass. `requireTestChange: false` disables the gate project-wide.
- **Risk is scored on the diff, not only on the story text.** `highRiskPaths` in
  `harness.json` (auth, migrations, schemas, payments, secrets, webhooks) raises the
  risk on its own, and `preflight`, the recommended mode, and the coverage gate all
  take the higher of the two sources. This closes a hole the previous entry left
  open: risk read only from story prose is risk the agent controls, since it wrote
  the prose — a change to `src/auth/session.js` described as "update the login page"
  used to score low and skip every gate keyed on it. It also decouples the two
  layers: because a diff needs no story to be read as risky, the gate applies to
  work with no story at all, and the proof layer becomes usable on a branch that
  never adopted the `epics/` layout.
- **Line-level patch coverage.** When the validation commands leave a coverage
  report behind, `verify` stops asking the weak question ("did a test file move?")
  and asks the real one: are the lines this change *added* actually executed. LCOV
  (`coverage/lcov.info`) and Istanbul JSON (`coverage-final.json`) are read with no
  dependency, and the uncovered lines are named — `src/auth.js: lines 4-10 not
  executed` — so the failure is actionable rather than a percentage. Under
  `minPatchCoverage` (default 80) the run reports `NOT PROVEN`. The measurement
  degrades honestly instead of guessing: no report, an unparseable one, or one
  written *before* the run started falls back to the test-file heuristic, and a
  stale report is treated as no report at all. Every verdict now records which
  question it answered (`coverage.mode`: `diff-lines`, `test-file`, or `none`).
- **`ai-flow init --minimal`.** The enforcement layer alone — guard hook, harness
  policy, `verify` — with no `RULES.md`, no `epics/`, no skills, and no `package.json`
  edits. The full workflow was the smallest thing you could adopt, which made the
  proof layer unreachable for anyone who did not also want the methodology.
  `doctor` judges a minimal install against what it chose to install rather than
  reporting the absent scaffold as damage, and refuses to `--fix` a workflow into
  existence. A later plain `init` promotes it to `full`, once, and says so.
- **Spec Kit features are read as stories.** A Spec Kit feature directory holds
  `spec.md` / `plan.md` / `tasks.md` — the same three roles this tool already
  resolves — so `verify --story specs/003-albums` works, and in a project with a
  `.specify/` directory `verify` with no `--story` scopes itself to the active
  feature. The feature is resolved the way Spec Kit resolves it
  (`SPECIFY_FEATURE_DIRECTORY`, then `.specify/feature.json`), falling back to the
  branch name and then the most recently edited feature — and the output always
  names which source it used, because a scope that was inferred has to say so.
  Nothing is imported from Spec Kit and it need not be installed. This is an
  adapter, not an integration: the tool does not care how you define the work, only
  whether the execution can be checked.
- **The coverage verdict says how strong it is.** Every result now carries a named
  rung — `verified` (the added lines were measured and enough of them executed),
  `evidence` (a test file moved alongside the change, nothing measured it),
  `exempted` (a declared reason carried it), `not-required`, `missing` — printed by
  `verify`, recorded in the evidence JSON as `coverage.tier`, and carried into the
  PR body and the `run` report. The gate always had these rungs; only `coverage.mode`
  exposed them, so the terminal printed a proxy and a measurement in the same voice,
  and the PR body ticked `✅ 1 test file(s) changed with this story` for a change
  nothing had measured. A tool whose argument is that asserted proof and executed
  proof differ cannot blur that line in its own report. An `evidence` pass also says
  how to earn the stronger word: emit `lcov.info` or `coverage-final.json` from the
  suite the run already executes. Older evidence, written before the field existed,
  is named correctly on read rather than promoted.
- **`docs/agent-contract.md`.** What Coding Flow expects from an agent, stated once
  and agent-neutral: inspect the work item, obey the repository's rules, run
  verification and read what it says, hand over the evidence. Every integration —
  the Claude Code skills today, others later — is a translation of that protocol,
  not a second place to put behaviour. Written now, while there is exactly one
  integration and the coupling is still cheap to see; the test it has to keep
  passing is that deleting every skill changes nothing about what is enforced.
- **`docs/DOGFOODING.md`, installed into every project.** The friction log the
  feature freeze exists to fill: one row per moment the tool cost more than it
  returned. `init` lays it down (`--minimal` does not — it is documentation, and
  minimal installs none), and a new **Tooling Friction** rule in `RULES.md` says
  the row is written *in the same pass*, not reconstructed at the end of a week
  from the two incidents anyone still remembers. `/flow-run` raises it at the
  moment it happens. The row the rule insists on is the one for **disabling,
  relaxing, or exempting a check to keep going** — a gate that gets switched off
  protects nothing, and the switching-off is the measurement, not the thing to
  hide. Ordinary failures stay out: a red suite, or a gate that rightly demanded
  a test, is the tool working. The log is manifest-tracked, so `upgrade` never
  overwrites the rows written into it. This repository keeps its own log the same
  way, seeded with the two entries this release fixes.

### Fixed

- **The coverage gate no longer blocks on changes a test suite cannot execute.**
  Type declarations (`*.d.ts`), build and tool config, SQL and migrations, and
  generated code are now `nonBehaviorGlobs`. A `*.d.ts` was the worst case: erased
  before anything runs, so it could never appear in a coverage report, while its
  `.ts` extension made the report look like it should have covered it — a block
  the developer could only clear with a fake test or by turning the gate off. These
  paths still raise the risk level and still appear in the evidence; they are only
  exempt from "prove a unit test executed these lines", which no coverage tool can
  answer for a DDL file.

## [0.6.0] - 2026-08-17

`ship` used to stop one step short of shipping, and knowing what to do next meant
reading `status` and inferring it yourself. Both are now the tool's job.

### Added

- **`ship` commits a dirty tree before it pushes.** The commit message is generic
  (the linked story's title, or the branch name), and it runs behind the same
  secret/sensitive-file scan as `harness check --quick` first — a hit stops the
  commit, nothing partial gets pushed. `--no-commit` restores the old push-only
  behavior.
- **Opt-in auto-merge, gated on captured proof, not on prose.** `autoMergeEpic` in
  `.coding-flow/config.json` (default `false`) lets `ship` merge its own PR via
  GitHub's native auto-merge, but only once **every** story in the current
  branch's epic has an actual captured green `verify` — a story's own
  `## Status: done` does not count on its own here, unlike everywhere else in the
  tool where a human override wins by default. Auto-merge is the one decision that
  puts a PR into the base branch unattended, so it is the one place a written
  label is not enough; an agent (or a less careful reviewer) claiming "done" in
  prose no longer clears this gate. Also skipped on a draft PR or a PR that
  conflicts with the base — a conflict is a human's call. `--auto-merge` /
  `--no-auto-merge` and `--merge-method <merge|squash|rebase>` override the
  config for one run.
- **`ai-flow next`.** `status` describes state; `next` decides. It ranks the exact
  same proof-derived state into the single command worth running right now:
  blocked stories first, then a "done" claim with no captured verify behind it,
  then stale proof, then a proven story with unshipped work, then a planned story
  with no worktree yet. `--all` prints the whole ranked queue, `--json` for
  scripting. It is read-only and scoped to the checkout it runs from — with
  several worktrees open in parallel, each terminal's `next` answers for *that*
  checkout, not a global view across all of them.
- **`/flow-status` and `/flow-next` skills.** The plugin channel is the primary
  way most users reach this tool, and until now `status`/`next` were CLI-only —
  invisible to anyone without `ai-flow` on `PATH`. Both are thin, read-only
  wrappers, reachable any time, not tied to a workflow stage. The front door goes
  from five skills to five-plus-two: the five that follow the workflow stage by
  stage, and two lookups you can reach for whenever.
- **`/flow-plan` gets a stop condition, not a new skill.** Story 01 of a new epic
  must now be a walking skeleton — the thinnest slice that crosses every layer
  the epic will eventually touch, hardcoded beyond that one path — before any
  story enriches it. Every story is also checked against INVEST (Independent,
  Negotiable, Valuable, Estimable, Small, Testable) before the readiness verdict,
  and an epic's `index.md` now carries a one-line `Backbone: <journey>` above its
  `## Stories` list, so story order reads as a position on that journey instead
  of arithmetic numbering nobody re-derives once written.
- **`doctor` warns when an epic passes ~7 stories** (`epic_too_large`) — the
  mechanical half of the same WIP-limit heuristic `/flow-plan` is told to apply,
  re-checked from the actual files on disk rather than trusted to survive a long
  planning session. Advisory only, like the other onboarding warnings.
- **`doctor` warns on duplicate epic/story numbers** (`duplicate_epic_number`,
  `duplicate_story_number`). The number is picked from a local scan of `epics/`
  at plan time — on a team, two people branching from the same base can
  independently land on the same `epic-05-` (or the same story number inside
  one epic) with different slugs. No Git conflict, since the directory names
  differ, but the number stops being unique once both branches merge. There is
  no shared counter to prevent the race, so `doctor` catches it mechanically
  right after the merge instead, while a rename is still a one-line fix.
- **`ship`'s auto-merge now respects story order within an epic.** Story
  branches are cut independently from the base, so nothing previously stopped
  GitHub from merging a later, enriching story before the earlier one it builds
  on. Auto-merge now waits for every story ahead of the current one (by
  directory name) to merge first — the same ordering hazard Walking Skeleton is
  meant to prevent, closed at merge time too.
- **`ai-flow audit --decisions`.** A cross-epic, read-only view of every story's
  recorded `## Decisions` — no new file to maintain by hand, it aggregates what
  the story files already carry, on demand. `--export` writes
  `docs/DECISIONS.md` (generated, never hand-maintained), `--json` for
  scripting. Never touches the run-evidence ledger `audit` otherwise manages.
- **`init`, `upgrade`, and `doctor` report whether `ai-flow` resolves on
  `PATH`.** `init` writes project files but never installs anything
  system-wide, so a bare `ai-flow status` right after a fresh install could
  fail with `command not found` and no explanation. All three now print one
  `PATH:` line answering that directly, and point at `npx
  @landry_pouth/coding-flow <command>` (no install) or `npm install -g
  @landry_pouth/coding-flow` (short form) when it does not resolve. Never a
  warning — an npx-only workflow is the documented default and reports this
  as false on every run by design.

### Changed

- **`RULES.md`** gains one line each on bounded contexts (treat a large repo's
  epic as one bounded context; integrate through an explicit interface, not by
  reaching into another epic's internals) and on mutation testing (an opt-in,
  project-declared `validation.quality` command for STRICT-risk changes, never a
  default `/flow-run` adds on its own) — still comfortably under its 900-word
  budget.

## [0.5.3] - 2026-08-05

Reported from real use: 45–60 minutes for a simple task. Five defects made the
tool report states it had not established; the rest of the release is about what
the tool *demands* rather than what it does. See
`docs/plans/execution-cost.md`.

### Fixed

- **Commands run from a subdirectory now operate on the project.** `cwd` was
  `process.cwd()`, captured once. Run `verify --story epics/x` from `apps/web` and
  the config was looked up in `apps/web`, not found, and the declared validation
  commands were silently replaced by whatever that subpackage's `package.json`
  held — the evidence was then filed under `root: .../apps/web`. A proof that
  quietly proves something else is worse than no proof. The `.coding-flow/`
  marker is now walked upward, and a relocated root is announced on stderr so it
  is never silent.
- **A passing suite that prints a lot is no longer recorded as a failure.**
  `spawnSync` capped output at 10 MB; past that Node kills the child and returns
  `ENOBUFS` with a null status, which was folded into `exit 127`. A green
  `turbo test` over a monorepo came back red, and the story was marked blocked in
  the ledger. The buffer is now 256 MB (`CODING_FLOW_MAX_OUTPUT_BYTES` to
  override), and an overflow reports `toolError` with a null exit code: "the
  harness could not observe this command" is a different claim from "this command
  failed", and both block a verify, but only one means the code is broken.
- **`## Status: done` is finally readable.** The matcher required whitespace
  after `Status`, so the colon form `/flow-run` explicitly mandates never matched.
  The most authoritative of the three status signals — the human override — had
  been inert for its own documented syntax, and a story marked `blocked` after a
  red verify fell through to the prose heuristic. All three forms now work.
- **A crash reports as a bug, not as a stack trace.** There was no top-level
  handler, so any exception reached the user as raw Node output — agents driving
  the CLI reported it as "the tool errored internally", indistinguishable from a
  red suite. `CODING_FLOW_DEBUG=1` still prints the stack.
- **`verify` names where its commands came from.** The fallback from a config
  that was never found to `package.json` scripts was silent, which is how a
  verify ends up proving less than it claims.

### Added

- **An unchanged story is not re-verified.** A green proof is reusable while the
  code it proved has not moved, so `verify` replays it instead of re-running the
  suite. Keyed on the working-tree token, the untracked-file listing, and a
  fingerprint of the command set — change any of the three and it re-executes.
  A cache hit writes **no new evidence**: recording a run that did not happen is
  the one thing this tool must never do. `--no-cache` forces execution.
- **Single-file stories.** A QUICK story is one `story.md`; `spec.md` / `plan.md`
  / `tasks.md` stay the shape for STANDARD and STRICT. Every reader now asks for
  a role rather than a filename, so a single-file story verifies, reaches
  `verified`, and audits exactly like a three-file one — cheaper ceremony,
  identical proof.

### Changed

- **`RULES.md` lost 58% of its words** (1780 → 746). It is imported by
  `CLAUDE.md`, so every word was paid on every turn of every session — and 1094 of
  them restated policy `/flow-run` and `/flow-review` already carry. The two
  copies had already diverged: `RULES.md` still taught `ai-flow harness verify`
  after 0.5.2 promoted `ai-flow verify --story`. A rule written twice is a rule
  that will eventually disagree with itself, and the always-loaded copy wins by
  default. The project constraints — architecture, quality, validation, testing,
  security — are untouched.
- **STRICT is triggered by blast radius, not by subject matter.** The old rule
  escalated on "touches user input, persistence, external integrations", which
  every form and nearly every feature matches; a landing page with a contact form
  bought TDD and E2E. STRICT is now for a change that alters an authorization
  decision, changes a persistence schema, moves money or secrets, or creates a
  **new** externally-reachable trust boundary. The security constraints apply at
  every intensity — what scales is the ceremony, never the constraints.
- **`/flow-review` is opt-in in STANDARD**, and still required in STRICT. A full
  review pass over a diff the same agent wrote minutes earlier mostly re-reads its
  own reasoning.
- **Reports scale with the story.** The 25-field Run Result block stays for
  STANDARD/STRICT; QUICK gets three lines. Sections that would come back empty are
  omitted rather than filled with `-`.
- **Fewer harness calls per story.** QUICK/FAST runs `verify` alone;
  `check`/`evidence` are STANDARD/STRICT, and `preflight` is STRICT only.

### Not done

- Parallel execution of validation commands. Declared command lists are ordered
  (`build` before `test` is legitimate), so running them concurrently would break
  projects to save ~20 seconds the cache already avoids spending at all.

## [0.5.2] - 2026-08-05

### Changed

- **The brownfield scan is machinery, not a command you run.** `ai-flow init` now
  scans the repository itself and reports what it found, so onboarding an existing
  codebase no longer requires a second trip to the terminal. The scan writes
  nothing: it is `readdir` plus a few regexes over `package.json`, regenerable in
  milliseconds and always true at the moment it runs, so persisting it cached
  something cheaper to recompute than to store — and made it an installed file
  that owed a manifest lifecycle it was never part of. `/flow-plan` re-runs the
  scan when it needs the data. `ai-flow bootstrap --scan` stays a public command
  for humans and CI who want the document, and now refuses to overwrite an edited
  one without `--force`.

  What `init` prints is the point. It reports the detected stack **and** that the
  project docs are still empty, ending on `Next: /flow-plan bootstrap` — because
  automating the mechanical half of onboarding is only a win if the user still
  learns that the expensive half, where the model reads the code and writes four
  durable docs, has not run.

- **Five skills instead of six: `/flow-verify` is gone.** It was the only skill
  where the model exercised no judgment — it shelled out to one command and echoed
  the result — and no skill ever called it: `flow-run`, `flow-review`, and
  `flow-ship` all invoke the CLI directly. Verification did not become optional;
  it stopped occupying a slot in a catalog meant for verbs a human initiates.
  **`ai-flow verify --story <path>` is promoted to top level** as the escape hatch
  for re-proving a story that went `stale` after a small edit, and every message
  that asks you to re-verify — `audit --check`, `ship`, the pre-push hook — now
  names it instead of the `ai-flow harness verify` long form. `harness verify`
  still works. `upgrade` removes the skill from installed projects.

- **`ai-flow commands` follows the front door.** `harness check --quick` left the
  daily cheat sheet (it is machinery nobody types) and `verify` took its place.

### Added

- **`doctor` warns when brownfield onboarding never finished.** Existing code
  detected, and `docs/project-context.md`, `docs/conventions.md`, and
  `docs/roadmap.md` all still byte-identical to what `init` installed, now
  produces `brownfield_not_onboarded` pointing at `/flow-plan bootstrap`.
  Comparison is against the manifest's recorded hashes, so it is exact rather than
  a length heuristic, and it stays a warning: an unfinished onboarding is not a
  broken install, and `doctor` keeps exiting 0. Partial progress is not nagged —
  all three docs must be untouched.

- **The scan reads workspace monorepos.** `pnpm-workspace.yaml`, npm/yarn
  `workspaces`, `lerna.json`, `turbo.json`, and `nx.json` are detected, and member
  `package.json` files are read so frameworks are found where they actually live.
  Bounded on purpose: one level of glob, no recursion, at most 50 members.

### Fixed

- **A JavaScript monorepo is no longer called a Python project.** A pnpm workspace
  with no root `package.json` — an ordinary shape — was told "this stack is likely
  Python, Go, Rust, or similar". Naming a stack is a claim, and it now requires no
  JavaScript signal anywhere: no root manifest, no workspace marker, no framework
  found in a member. A genuine Python or Go repository still gets the warning.

- **`--story` no longer scopes silently.** A path that did not resolve, pointed
  outside the repository, or named a directory that is not a story fell back to
  the project-wide commands and then wrote an evidence claiming it had proved a
  story that does not exist — which `audit` ingests as-is, leaving a red ledger
  entry nothing could ever re-verify. `verify` now refuses all three, as `run`
  already did. `--story` with no value at all (`verify --story --json`) is refused
  across every harness subcommand. `preflight` keeps reporting a missing story as
  `(missing)`, which is its designed behavior.

- **The scan no longer reads Coding Flow's own scaffold as project signal.** `init`
  writes eleven `flow:*` scripts, an `examples/` directory, and a `package.json`
  when the repository has none — all of it was being read straight back, so a
  fresh repository reported "13 scripts" and a Python project reported as
  JavaScript. The `packageJsonCreated` flag also stopped being sticky: a greenfield
  repository that later becomes a real Next.js application is now detected instead
  of staying invisible forever.

- **A broken `package.json` is reported as a broken file.** A merge conflict or a
  truncated write used to surface as "no JavaScript signal", sending you to doubt
  the detectors instead of fixing the file. Non-object `scripts` and `dependencies`
  no longer invent signal either — a `scripts` string was walked character by
  character, turning eight letters into eight scripts.

- **`init` and `uninstall` name the files they touch.** `init` reported "Skipped
  existing files: 1" and advised `--force`; on a brownfield repository that file
  is typically the project's own `docs/architecture.md`, so the advice read as
  "overwrite your architecture document". It now lists the paths and frames them
  as kept. `uninstall` lists every file it removes rather than counting them, on
  the one command that deletes.

- **Piping no longer crashes.** `ai-flow status | head` died with an unhandled
  `EPIPE` stack trace over whatever you were reading. A closed pipe is a normal
  end.

## [0.5.1] - 2026-08-05

### Changed

- **The six skills are now `flow-*`: `flow-setup`, `flow-plan`, `flow-run`,
  `flow-verify`, `flow-review`, `flow-ship`.** `run` and `review` collided head-on
  with Claude Code's own built-in skills of those names — `/run` launches your
  app, `/run` executed a story, and nothing in the menu told you which was which.
  The prefix gives every command exactly one meaning. **Breaking:** `/run` and
  friends no longer resolve to Coding Flow; `upgrade` removes the old skill files
  from installed projects (a file you edited yourself is reported and kept).

- **A project installs its skills from one channel, never two.** The skills ship
  both with the plugin (`coding-flow:flow-run`) and as project files
  (`/flow-run`). Installing both gave two names for one skill. `init` now detects
  an installed plugin and skips the project copy; with no plugin it copies them as
  before, so a teammate cloning the repo still gets the workflow. The resolved
  choice is recorded in `.coding-flow/config.json` (`"skills": "plugin" |
  "project"`) and committed, so `doctor`, `upgrade`, and `uninstall` all read the
  same decision and the install cannot behave differently per machine. Override
  with `--with-skills` / `--no-skills` on `init` or `upgrade`.

  An existing project needs no second `init`: it has no recorded choice, so its
  first `upgrade` makes one — detecting, recording it, and pruning the copies
  that would now duplicate the plugin. A project that already recorded a choice
  is never second-guessed, so a teammate upgrading on a machine with the plugin
  cannot delete the skills every other teammate depends on.

  Detection fails toward copying. A plugin counts as installed only when the
  skills it would serve are visible on disk: a corrupt or unfamiliar registry, an
  entry left behind by an uninstall, a half-finished install, and a leftover
  cache directory all resolve to "no plugin", so the worst case is a duplicate
  name and never a project with no skills at all. `test/plugin-detect.test.js`
  pins down each of those cases.

### Fixed

- **The manifest no longer keeps entries for files that are gone.** A locally
  edited template had its previous entry carried forward unconditionally, so a
  removed file stayed listed forever. The carry-forward now requires the file to
  still exist.

## [0.5.0] - 2026-08-04

### Added

- **`/plan` Clarify First now ends with a readiness gate.** After the
  pressure-test interview, `/plan` records an explicit `ready` / `not ready`
  verdict instead of sliding straight into writing stories. `ready` means no open
  question would change implementation; `not ready` holds story writing until the
  blocking item is answered, surfaced to the user as a labeled question, or cut
  out of scope. The verdict — and the blocking item when `not ready` — is recorded
  in the epic `index.md`, so `/run` starts from a plan explicitly judged ready,
  not from silence. This restores the go/no-go that grill-me provided before the
  0.4 consolidation, as a smaller step integrated into `plan` rather than a
  separate skill.

## [0.4.1] - 2026-08-04

### Fixed

- **The guard hook no longer shells out to `npx` on every write.** It previously
  ran `npx --yes @landry_pouth/coding-flow@0.4.0 guard`, which re-resolved
  against the registry on each Edit/Write and could hang to its 30s timeout —
  stalling every write in coding-flow-enabled projects. It now runs the
  package's binary directly: the plugin hook spawns the copy bundled with the
  plugin (`${CLAUDE_PLUGIN_ROOT}/bin/ai-flow.js`, exec form, no registry), and
  the `init`-wired project hook records the path of the binary that ran `init`,
  falling back to the pinned `npx` command only when that path is missing (e.g.
  a shared settings.json). Re-running `init` upgrades an existing project's hook
  in place; the timeout is raised to 60s to cover the fallback's one-time
  download.

## [0.4.0] - 2026-07-31

A consolidation release: the same evidence spine, a much smaller surface. Three
renames make the tool easier to hold in your head. Breaking — see
[`docs/migration.md`](docs/migration.md) (`upgrade` adds the new files but never
deletes the old ones, so a 0.3 project keeps working alongside residue to clean
by hand with `trash`).

### Added

- **`ai-flow run`** — batch story orchestrator: resolves stories (all / `--epic` /
  `--story`), verifies each for real, writes per-story proof plus one aggregated
  `-run.json` rollup, and exits non-zero if any verifiable story failed. Ships the
  `none` driver (verify already-done work); agent execution is a reserved
  `--driver` seam that fails cleanly until wired.

### Changed

- **Rules merged into one file.** `PROJECT_RULES.md` + `AGENT_RULES.md` → a single
  **`RULES.md`** (imported by `CLAUDE.md`).
- **Stories collapsed from six files to three:** **`spec.md`** (what & acceptance),
  **`plan.md`** (how + decisions + `## Commands` + test plan), **`tasks.md`**
  (checklist + `## Result` + rollback).
- **Skills collapsed from ~30 to six:** `setup`, `plan`, `run`, `verify`, `review`,
  `ship`. Depth (STRICT mode, deep validators, the context scout, TDD) is now
  opt-in *sections* inside `/run` and `/review`, not separate skills.
- **CI gate** now replays `run` (per-story verify) or repo-wide `harness verify`,
  then `audit --check`, on a clean checkout — pinned to the published version.

## [0.3.0] - 2026-07-28

Coding Flow is now explicitly a **Claude Code** tool. Support for Codex and other
agents is planned through per-agent targeting, but is not shipped yet.

### Removed

- **The legacy `.agents/` shared skill mirror.** The neutral physical copy of the
  skills (meant for Codex and non-Claude agents) is gone: it was a source of
  confusion and is superseded by the planned per-agent targeting
  (`docs/plans/multi-agent-install.md`). `init`/`upgrade` no longer create
  `.agents/`, and `doctor` no longer requires or checks it. Existing projects keep
  working — `uninstall` still removes any `.agents/` entries recorded in their
  manifest, and a leftover `.agents/` directory is simply ignored.

### Changed

- Repositioned as a Claude Code-first tool: package description, keywords, README
  intro, and the marketplace description now state Claude Code explicitly, with
  Codex flagged as planned.

## [0.2.0] - 2026-07-28

The release that turns Coding Flow from an *AI methodology* into an **evidence &
governance layer** — every advisory guardrail becomes an *executed* one, attached
to a human identity, aggregated into an exportable ledger, and verified out of the
agent's hands. Distributed as a native Claude Code plugin and published on npm.

### Added

- **Guard hook** — deterministic `PreToolUse` hook that enforces the harness
  policy (blocks secrets and writes to protected paths, exit 2). Inactive until
  published; now live via `npx --yes @landry_pouth/coding-flow guard`.
- **Harness `verify`** — actually executes the project's declared validation
  commands and captures verbatim exit codes/output into `.coding-flow/runs/`.
  "Nothing executed" fails as "not verified".
- **Identity** — every evidence run is attached to a resolved human identity, so
  the ledger is auditable rather than anonymous.
- **Audit ledger** — append-only evidence ledger with `audit --export` and a CI
  gate.
- **Trace** — end-to-end chain: story → commits → PR → evidence → tests.
- **Ship** — attaches the latest `verify` evidence to the PR body.
- **Clean-room CI** — GitHub Actions gate that re-runs `verify` + `audit` out of
  the agent's hands.
- **Native plugin packaging** — `.claude-plugin/` manifest + marketplace, so the
  skills and guard hook install via `/plugin marketplace add LandryPouth/coding-flow`.
- **Storage seam + project config** — pluggable epic/story backend, `.coding-flow/config.json`,
  and a `branchPerEpic` policy (local backend; GitHub backend deferred by design).
- **Parallel mode** — `ai-flow worktree add/list/remove` for developing several
  features in parallel without leaving the zero-dependency stance.
- **Test & CI harness** — behavioral `node:test` suite on throwaway git repos,
  GitHub Actions on Node 18/20/22, and a `pre-push` hook.

### Changed

- Repository language translated from French to English for better AI adherence.
- Skill invocation syntax switched from `$skill` to `/skill`.
- Published to npm as `@landry_pouth/coding-flow` (public).

### Notes

- **Zero runtime dependencies** — everything relies on `node:*` built-ins; `git`
  and `gh` stay optional shell-outs with clean degradation.
- The GitHub storage backend (issues/sub-issues) is a proven seam with a clean
  `fail()`; implementation stays deferred until a real need appears.

[0.8.1]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.8.1
[0.8.0]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.8.0
[0.7.0]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.7.0
[0.6.0]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.6.0
[0.5.1]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.5.1
[0.5.0]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.5.0
[0.4.1]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.4.1
[0.4.0]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.4.0
[0.2.0]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.2.0
