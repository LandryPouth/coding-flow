# Story 14-05 — Learn: the developer pins a flow with a test

`/flow-recover learn` — the ownership mode. The developer picks a flow from
`docs/recovery/map.md`, **predicts** what it does (inputs, effects, failure
cases), the agent traces the actual path with `path:line` steps, the gaps
between prediction and trace are discussed, and the flow is **pinned by a
characterization test the developer writes or approves**. The test is both
the learning artifact and what makes a later refactor of that flow provable
(story 14-04). `docs/recovery/ownership.md` lists pinned flows (flow → test
file) and unknown flows. No scoring, no quiz loop: one flow per session,
stop when it is pinned.

*(QUICK — a skill section, a file format, eval prompts; no CLI change. Needs
s1.)*

## Acceptance Criteria

- [x] SKILL.md has a `## Learn` section ≤ ~60 lines: predict → trace →
      compare → pin → record, with the rule "the developer writes or
      approves the assertion; the agent never invents expected values it did
      not observe in the trace".
- [x] `ownership.md` format documented in the skill: `### <flow>`,
      `- Pinned by: <test path>`, `- Entry: path:line`, `- Unknown:` lines;
      and the "unknown flows" list.
- [x] `evals/cases/flow-recover.json` gains two positive prompts ("help me
      understand how payments work in this code I didn't write", "walk me
      through the auth flow so I can own it") and a negative owned by
      `flow-run` ("add a test for the login bug").
- [x] Replay on the fixture: one flow pinned; the new test is counted as test
      strengthening by `ai-flow verify` (existing behavior), recorded here.
- [x] `plugin check` and `test/skill-evals.test.js` green.

## Status: done

## Test Exemption

`evals/cases/flow-recover.json` is the only file the gate reads as behavior,
and it is test input: `test/skill-evals.test.js` routes every prompt in it
(the two new positives failed at rank 7/8 before the description changed,
and pass now). The rest of the diff is skill prose and the changelog. A test
asserting the skill's text would test narrative, which this repository
refuses. Logged in `docs/DOGFOODING.md` (2026-11-09).

## Result

- `SKILL.md` gains `## Learn` (55 lines): pick → predict → trace → compare →
  pin → record, the "developer writes or approves; never an unobserved
  expected value" rule, and the `ownership.md` format with `## Unknown flows`.
  A `Verification` box checks the pinned test ran and its values were observed.
- The description names the learn mode; without it both new positives ranked
  7th/8th behind `flow-run`. After: all 29 positives route, rank-1 82.8%, the
  `flow-run` negative holds.

### Replay on the fixture (2026-11-09)

Copy of `evals/recovery/fixture/` in a throwaway repository, branch
`pin/test-function`, flow `POST /scripts/test-function` (R-03, entry
`server.js:25`). Expected value observed by running
`runRuntime("evaluate", …)` first: `{ ok: false, output: "" }`. Pinned in
`spec/test-function.spec.js`.

- `npm test` (`node --test`): 1 test, 1 pass — the pin.
- `ai-flow verify --base main`: passed (1 command); coverage `not-required`
  (risk low, no story), so the report never prints the word.
- `scanTestWeakening` on that diff: `strengthened: ["spec/test-function.spec.js"]`,
  no finding; `classifyChangedFiles`: no behavior file. So the pin counts as
  strengthening and a pin-only branch passes at any risk.
- Found on the way: the fixture's `node --test` default pattern does **not**
  run `spec/slug.spec.js` or `spec/format.spec.js` — the pin ran only because
  its name matches `test-*`. Step 5 now says to check the pin is among the
  tests that ran.

