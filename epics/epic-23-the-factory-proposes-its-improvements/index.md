# Epic 23 — The factory proposes its own improvements

## Goal

After every epic, a watcher in a fresh context reads the numbers, not the
sessions, and writes at most three proposals to improve Coding Flow — each
with its evidence, the concrete change, the metric that must move and the risk.
The maintainer accepts or refuses. An accepted proposal runs as an experiment
(a new gate starts in shadow), is measured, and is confirmed or reverted, and
the revert is recorded so the watcher sees its own misses. The tool learns; it
never edits itself.

## Why

- The maintainer asked for a tool that learns from its runs across projects
  and proposes its own improvements (2026-11-12).
- Every self-improving system in the research gained only under a strong,
  hidden evaluator, and every one that could touch its own judge learned to
  fool it (the Darwin Gödel Machine faked test logs and bypassed its
  hallucination detector). Production systems stop at "agent proposes, human
  promotes".
- `docs/DOGFOODING.md` is the manual version of this loop: 50+ rows written by
  hand, from memory, when someone noticed.
- `evals/benchmark` and `docs/experiments` already define how to compare the
  tool with and without a change.

## Scope

**In scope**

- `/flow-improve` (machinery skill): fresh context, reads `ai-flow insights
  --all --json` and sampled events, writes ≤ 3 proposals into the vault.
- `ai-flow proposal check`: a proposal whose change relaxes a gate, deletes or
  weakens a test, raises a budget, widens permissions or touches production is
  classified `maintainer-question`, mechanically.
- Shadow mode for gates in `harness.json`.
- Experiments: flag, benchmark with/without, production window, verdict
  recorded.
- The watcher runs at the end of every driven epic and on demand.

**Out of scope**

- Applying any proposal automatically.
- Changing skills or thresholds from inside a run.

## Backbone

`Backbone: a watcher writes three proposals → some proposals only the maintainer can make → a new gate starts in shadow → an accepted proposal is an experiment → the watcher runs after every epic`

### Story dependency tree

```text
s1
├── s2
└── s4
    └── s5

s3
```

s2 and s4 read the proposal format s1 defines; s5 schedules what s4 measures.
s3 is `harness.json` and the gate evaluation only, disjoint from the rest.

## Stories

1. **story-23-01-a-watcher-writes-three-proposals** *(STANDARD — walking skeleton: insights → fresh-context skill → proposal notes in the vault → listed by `ai-flow proposal list`)*
2. **story-23-02-some-proposals-only-the-maintainer-can-make** *(STRICT — the boundary of what the tool may suggest as routine)*
3. **story-23-03-a-new-gate-starts-in-shadow** *(STRICT — policy)*
4. **story-23-04-an-accepted-proposal-is-an-experiment** *(STANDARD)*
5. **story-23-05-the-watcher-runs-after-every-epic** *(QUICK)*

## Decisions

- **The watcher never sees reasoning.** Its input is `insights` output and a
  sample of raw events; never full transcripts of the sessions it judges
  (same independence argument as STRICT review).
- **Proposal format** (a vault note with frontmatter): `title`, `evidence`
  (metric, value, window, run ids, projects), `change` (a diff or a precise
  edit list against coding-flow), `success` (metric, target, minimum runs),
  `risk`, `status` (`proposed → accepted | refused → measuring → confirmed |
  reverted`), `kind` (`routine` | `maintainer-question`).
- **Early proposals are detections, not proofs.** With 274 stories, the watcher
  reports "seen 3 times in 2 weeks, in 2 projects", not "improves yield by
  12 %"; `success` must name how many runs a verdict needs.
- **Shadow gates** log `gate.fired` with `mode: shadow` and never block; their
  precision (fired → test added vs exempted vs overridden) is shown by
  `insights` after N runs; promotion to blocking is a maintainer edit.
- **Cost is a metric too.** The watcher's own tokens are recorded per pass and
  capped by the run budget.

## Dependencies outside this epic

Epic 21 (insights, vault, review and gate metrics); epic 20 s7 (end-of-epic
hook).

## Readiness

`ready`. The vault path (epic 21 maintainer to-do) must exist before s1's
end-to-end check.
