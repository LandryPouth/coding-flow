# Dogfooding log

> Every time using Coding Flow costs more than it returns, it gets written down
> here. Not bug reports — **friction**: the moments where the tool was in the
> way, technically working as designed.

## Why this file, and why during a feature freeze

A tool whose entire argument is *"evidence beats assertion"* cannot decide what
to build next from imagination. This is the instrument that makes the freeze
mean something: the freeze is not a pause, it is the period where real use
produces the list.

The signal to watch for is not a crash. It is the thought:

> *"Coding Flow is wasting my time here."*

That sentence is a more important defect than any missing feature — because the
end of that road is a developer who turns the gate off, and a gate that is off
protects nothing. **A gate that fires on a case the developer cannot legitimately
fix is a gate they learn to switch off.**

Also worth recording, and easy to miss: the times a gate fired and was *right*.
A friction log that only collects complaints will talk you into removing checks
that are doing their job.

## How to record one

One row per incident, newest first. Keep it short; the value is in the volume and
the honesty, not the prose.

- **Repository** — where it happened. Entries from a project that is not
  `coding-flow` are worth more, because they were not designed by the author.
- **Surface** — which part: guard, coverage gate, risk scoring, verify, ship,
  doctor, install, skills.
- **Problem** — what actually happened, in one sentence.
- **Severity** — `low` (mildly annoying) · `medium` (cost real time) · `high`
  (a case with no legitimate fix, or a wrong verdict).
- **Workaround** — what you did to get moving. `disabled the gate` is the most
  important value this column can hold; never leave it out to look better.
- **Resolution** — the fix, the decision not to fix, or `open`.

Anything that reaches `high` and has no resolution is the next thing to work on,
ahead of whatever the roadmap says.

## Log

| Date | Repository | Surface | Problem | Severity | Workaround | Resolution |
|---|---|---|---|---|---|---|
| 2026-08-18 | coding-flow | coverage gate | A `.d.ts` in the diff can never appear in a coverage report, so it read as uncovered and blocked the run. Same for build config, migrations, and generated code. | high | Declare an exemption, or turn `requireTestChange` off. | Fixed: `nonBehaviorGlobs` now excludes declarations, config, migrations, and generated files — they still raise risk, they are just no longer asked for line coverage. |
| 2026-08-18 | coding-flow | verify output | `1 test file(s) changed` and `92% of the added lines are executed` printed in the same voice, so a proxy read as a measurement. | medium | Read `coverage.mode` out of the evidence JSON. | Fixed: the rung is named (`verified` / `evidence` / `exempted` / `not-required` / `missing`) in the terminal, the evidence, the PR body, and the batch report. |

## What is not friction

Keep these out, or the log stops being useful:

- a test that failed because the code was wrong — that is the tool working;
- a gate that blocked a change that genuinely needed a test;
- a feature you wish existed. Wishes belong in an issue. This file is for the
  cost of the tool as it stands.
