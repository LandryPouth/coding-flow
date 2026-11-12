# Epic 19 — The judge holds

## Goal

`verify` is a judge an unattended loop can trust: a red names the tests that
failed and why the run stopped; a failure that is noise is told apart from a
real one without ever turning red into green silently; heavy runs queue
instead of killing each other; a long run does not hold an agent hostage;
mechanical failures are fixed before they are judged; the project's slower
tiers run when the risk asks for them; and in a driven run the agent cannot
make the judge pass by editing the tests it is judged by.

## Why

- **A quarter to a third of the reds are noise.** 27 of 115 red trees on bethl
  (23 %) and 17 of 52 on ai-learn (33 %) went green with no change. bethl
  39-02 again on 2026-11-12: red on a `@workspace/clips` timing test the epic
  never touched. Each costs 3–9 minutes and an agent turn hunting a cause that
  does not exist (DOGFOODING 2026-11-12, high).
- **A red says `Failed: @workspace/clips#test`**, not which test. The agent
  reads a 300 KB evidence file or reruns.
- **Runs die of the machine, not the code.** bethl lost 12 of ~37 verifies on
  epics 37–38 to the agent tool's 590 s timeout, memory kills (exit 143) and
  code changed mid-run; WSL has 14 GB and a `next dev` takes 5.5.
- **Lint is 38 % of bethl's failing commands** (49 of 130 red runs), almost all
  mechanical.
- **The slow tier is outside the judge.** bethl's `test:integration` is not in
  `verify`; STRICT stories ran it by hand, or not.
- **Agents game visible tests.** ImpossibleBench: up to 54 % cheating when a
  test contradicts the spec; making tests read-only blocks edits at no
  performance cost; more retries raise cheating (research report). The factory
  (epic 20) is the first time no human watches the agent between two verifies.

## Scope

**In scope**

- Failure extraction for the runners the projects use (node:test, jest,
  vitest, turbo-prefixed output) and the stop cause (exit code, signal,
  timeout, OOM 137/143).
- A flaky ledger and a bounded same-tree retry, both visible in evidence.
- A machine-wide queue for heavy verifies, gated on free memory.
- `verify --detach` / `--wait`.
- `validation.fix` pre-steps.
- Declared tiers, and which tiers a risk level requires.
- Test protection by the guard during driven runs, and the escape-hatch rule
  in `/flow-run`.

**Out of scope**

- Quarantining a test automatically (a proposal for the maintainer, epic 23).
- Any change to the coverage gate's thresholds.
- Browser automation; the `browser` tier is a declared checklist the agent
  fills, judged by its presence.

## Backbone

`Backbone: a red names its tests → noise is told apart → runs queue for the machine → a long run detaches → fixers run first → the risk picks the tiers → tests are protected when nobody watches`

### Story dependency tree

```text
s1
└── s2

s3
└── s4

s5
└── s6

s7
```

s2 needs s1's parsed test names to recognise the same test failing then
passing. s4's detached job goes through s3's queue. s6 extends the
`validation` config shape s5 adds. s7 is the guard and `/flow-run` only.

## Stories

1. **story-19-01-a-red-names-its-tests** *(STANDARD — walking skeleton: parsed failures and stop cause in evidence, the terminal and the journal)*
2. **story-19-02-noise-is-told-apart** *(STRICT — touches the path to a verdict)*
3. **story-19-03-one-heavy-verify-per-machine** *(STANDARD)*
4. **story-19-04-a-long-verify-detaches** *(STANDARD)*
5. **story-19-05-fixers-run-before-the-checks** *(STANDARD)*
6. **story-19-06-the-risk-picks-the-tiers** *(STRICT — changes which commands prove a story)*
7. **story-19-07-tests-are-read-only-when-nobody-watches** *(STRICT — guard)*

## Decisions

- **A retry is a second observation, never an override.** A command that fails
  then passes on the same tree (same treeToken, same untracked digest) is
  recorded with both attempts and the failing test names; the verdict line says
  `green after retry`, the journal counts it, and the ledger remembers the
  test. Default: one retry of the failed command only, in driven runs; zero in
  interactive runs unless configured. A red that is red twice is red.
- **The ledger informs, it never excuses.** A known-flaky test failing again is
  labelled as such and flagged when it lies outside the story's diff; it still
  fails the run when it fails twice. Quarantine is a maintainer decision.
- **The queue is a lock file under the user's cache dir plus a free-memory
  check**, no daemon (entry 2). A waiting verify prints why and how long it
  has waited; the wait is recorded.
- **Fixers may change files.** Their changes are listed in the evidence and
  left in the tree for the agent or driver to commit; a fixer that fails is a
  red like any other command.
- **STRICT requires the `integration` tier when one is declared.** A project
  that declares none gets a one-line notice, not a failure.
- **Test protection is mechanical first, prose second.** In a driven run the
  guard refuses edits and deletions of test files that exist at the diff base
  unless the story's `## Test Exemption` names the file; new test files stay
  free. `/flow-run` gains the escape hatch: a test that contradicts the
  acceptance criteria makes the story `blocked` with the contradiction written
  down, never "made to pass".

## Readiness

`ready`. Assumptions (defaults, open to veto): retry count 1 in driven runs and
0 interactive; free-memory threshold 3 GB, configurable in `harness.json`;
heavy = any verify whose commands include a test command.
