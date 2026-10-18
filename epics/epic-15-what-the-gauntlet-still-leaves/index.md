# Epic 15 — What the gauntlet still leaves

## Goal

Everything `docs/plans/uncle-bob-gauntlet.md` recommended that epics 13 and
14 do not carry is planned here: the guard tests pin what they claim, the
largest function in the tool is split under a proven refactor claim, humans
own module boundaries in users' projects, mutation testing earns its place
(or is dropped) on evidence, and the study's own success measures are
re-taken.

## Why

Epics 13 and 14 took waves 0, 1, 3 and 4 and the ratchet half of wave 2.
Cross-checked against the study on 2026-10-18, still unplanned:

- **Experiment 1's two non-equivalent survivors, still open on this
  checkout**: `cp X existing-dir` without a trailing slash has no test (the
  guard denies `cp key .ssh` correctly — checked — but the mutant on the
  directory-destination branch survives because nothing asserts it), and
  sed tests assert `deny`, never the set of targets `sedFiles` finds
  (`shellWriteTargets` is asserted for one command in the whole suite).
- **Wave 2, the split**: `shellWrites` is 331 lines, ~110 decision points.
  The study wants it a pure module whose spec is the 05-05 corpus.
- **Users' projects, items 2 and 3**: boundaries through per-stack recipes,
  and a human-approved `## Boundaries` section in `/flow-plan`.
- **Wave 5**: the mutation probe, conditioned on an offline replay on bethl.
- **How to tell it worked**: review passes per STRICT story (12 → ≤ 3),
  share at `verified` (0 %), P1s caught by verify vs review — never
  re-measured once the work lands.

## Scope

**Out of scope** — the refusals stand (five agents per story, persona
prompts, signed evidence, a native import-graph or CRAP parser). The worktree
layer's open question is answered by s6's measurement, not by a story here.

## Backbone

`Backbone: the guard's tests assert what they claim → its largest function is split and the split proven behavior-preserving → users' boundaries are owned by a human and checked by their own tools → mutation is tried on a real project before it is built → the study's measures are re-taken`

### Story dependency tree

```text
s1

s2

s3

s4
└── s5

s6
```

External prerequisites: `s2` needs 13-06 (size ratchet) and 14-04
(`--claim refactor`); `s3` needs 13-04 (`policyGlobs`, so loosening a
boundary rule is reported); `s5` needs 14-03 (throwaway-worktree runner) and
14-04 (its first consumer is a refactor claim). `s6` runs last, after
everything else in epics 13–15 has landed.

## Stories

1. **story-15-01-guard-tests-pin-what-they-claim** *(QUICK — can run now)*
2. **story-15-02-split-shellwrites-under-a-refactor-claim** *(STRICT)*
3. **story-15-03-humans-own-boundaries** *(STANDARD)*
4. **story-15-04-replay-mutation-on-bethl** — go / no-go experiment.
   *(QUICK)*
5. **story-15-05-mutation-probe-opt-in** — only if s4 says go. *(STRICT)*
6. **story-15-06-did-it-work** — re-measure and write it down. *(QUICK)*

## Decisions

- **s5 is conditional.** If the bethl replay finds no real gap (a survivor
  that is neither equivalent nor already known), s5 is closed as "not
  built, see 15-04" and the study's wave 5 is marked refused with the
  numbers. Martin's own caution applies: *"just because we can do them
  doesn't mean we actually should."*
- **The split is the claim's acceptance test.** Splitting `shellWrites`
  without `--claim refactor` would prove nothing new; with it, the tool's
  most complex function becomes the evidence that the claim works.
