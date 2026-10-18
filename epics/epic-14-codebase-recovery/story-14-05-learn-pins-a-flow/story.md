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

- [ ] SKILL.md has a `## Learn` section ≤ ~60 lines: predict → trace →
      compare → pin → record, with the rule "the developer writes or
      approves the assertion; the agent never invents expected values it did
      not observe in the trace".
- [ ] `ownership.md` format documented in the skill: `### <flow>`,
      `- Pinned by: <test path>`, `- Entry: path:line`, `- Unknown:` lines;
      and the "unknown flows" list.
- [ ] `evals/cases/flow-recover.json` gains two positive prompts ("help me
      understand how payments work in this code I didn't write", "walk me
      through the auth flow so I can own it") and a negative owned by
      `flow-run` ("add a test for the login bug").
- [ ] Replay on the fixture: one flow pinned; the new test is counted as test
      strengthening by `ai-flow verify` (existing behavior), recorded here.
- [ ] `plugin check` and `test/skill-evals.test.js` green.

## Result
