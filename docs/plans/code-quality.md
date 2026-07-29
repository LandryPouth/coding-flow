# Code quality & DRY

> Implementation plan for adding a code-quality concern to coding-flow **without
> diluting its spine**. The spine is *proof*, not *advice*: a guardrail belongs in
> the harness only if it is executed and captured verbatim. Quality splits into two
> kinds that must be routed differently.

## Thesis

Code quality is not a new pillar. It is a **context-efficiency multiplier** that
serves the tool's #1 promise (small blast radius, cheap stories, reliable
one-pass). Duplication is a token tax on every future story; low complexity and
stable conventions let `agent-context-scout` find *the* edit point instead of N
copies. So quality is on-brand — but only through the existing seams.

Guiding split:

| | Deterministic quality | Judgment quality |
| --- | --- | --- |
| Examples | lint, typecheck, format, complexity, dead code, **duplication (jscpd/similarity)**, coverage thresholds | right abstraction level, naming intent, justified coupling |
| Nature | executable, reproducible, verbatim-capturable | subjective, contextual, non-falsifiable |
| Home | **the harness** (`verify` / `evidence` / `audit --check` / `ship`) | **an advisory validator skill** |

**Non-negotiable:** quality-as-gate only for the deterministic subset;
quality-as-judgment stays advisory. A subjective metric must never become a
fake-precise merge blocker — that erodes the "proven ≠ asserted" moat.

## The DRY hazard (design decision, not code)

DRY is the most misapplied principle, and worse with an agent. An agent
optimizing "zero duplication" produces premature abstraction, god-utils, and
couples things that merely *looked* similar — increasing the blast radius of every
future story, against promise #1.

Decision: **DRY enters as a signal, never as a rule.**

- Duplication above a threshold triggers a *review*, not an auto-refactor.
- `conventions.md` frames it as: rule of three; "duplication is cheaper than the
  wrong abstraction" (Metz); quality = context efficiency.
- No rule anywhere says "eliminate duplication" or "be DRY".

## Non-negotiable constraints (inherited from the project)

- **Zero runtime dependencies in the CLI.** The harness does not bundle a linter
  or a duplication detector. It *orchestrates the project's own* tools via declared
  commands (`eslint`/`biome`/`ruff`/`jscpd`/`tsc`…). Language-agnostic. The tool
  does not *judge* quality; it *executes* what the project declared and captures the
  proof.
- **Nothing blocks by surprise.** Quality commands only gate a story if the project
  declared them; absent config → advisory only.
- **Idempotence + `--dry-run`.** No hidden side effect.
- **Evidence is the truth, not the narrative.** Verbatim capture of tool output,
  truncated but never reworded.

## Implementation order

```
Tier 1 (executed)  ── config seam + verify capture ── audit --check ── ship surface
Tier 2 (advisory)  ── /quality-check + /agent-validator-quality
Tier 3 (rules)     ── conventions.md + AGENT_RULES.md + harness.json thresholds
```

Tier 1 is the real value and ships first. Tier 2 depends on nothing. Tier 3 is
documentation + optional risk signals.

---

## Tier 1 — Executed quality (the real apport)

**Intent.** Make lint/typecheck/format-check/duplication first-class validation
commands, so they flow through the existing proof pipeline with **no new concept**.

- `lib/config.js`: `validation.commands` already exists. Document a `quality`
  bucket (or just let projects add the commands). Example resolved config:
  ```json
  { "validation": { "commands": [
      "npm run lint", "npm run typecheck",
      "npm run format:check", "npx jscpd --threshold 0 src"
  ] } }
  ```
- `lib/harness.js` (`verify`): already runs `validation.commands` and captures exit
  codes verbatim into `.coding-flow/runs/*-verify.json`. No change needed beyond
  making sure a non-test command (lint/jscpd) is treated as a first-class check, not
  filtered as "not a test".
- `audit --check`: unchanged — a red lint/dup run is already a red `verify`, so the
  CI gate covers quality for free.
- `ship`: unchanged — the per-command table already surfaces which quality command
  failed in the PR body.

**Acceptance:** in a throwaway repo, declaring a failing `jscpd`/lint command makes
`verify` red, `audit --check` fail, and `ship` show the failing command. Removing it
turns everything green. Verified via exit codes + file content, never reasoning.

## Tier 2 — Advisory quality (judgment)

**Intent.** Mirror the existing `*-check` skills and deep validators.

- `skills/quality-check/SKILL.md` — quick advisory pass (mirror of
  `security-check`/`architecture-check`/`tests-check`). Reads `conventions.md`,
  flags duplication clusters, high-complexity spots, naming/coupling smells. Output
  is a **review**, never an edit.
- `skills/agent-validator-quality/SKILL.md` — deep validator (mirror of the 3
  existing validators). Escalation target from `quality-check` when a story
  introduces new patterns, wide duplication, or a refactor.
- Wire both into `run-story` STANDARD/STRICT pipelines as optional steps, and into
  the escalation rules (`quality-check → agent-validator-quality`).

**Acceptance:** skills exist, pass `doctor` frontmatter checks, and never modify
application code.

## Tier 3 — Rules & signals

- `conventions.md`: a "Code quality & DRY" section framing the DRY decision above.
- `AGENT_RULES.md`: guidance that quality serves context efficiency, plus "prefer
  duplication over the wrong abstraction".
- `harness.json` (optional): `maxDuplication` / `maxComplexity` thresholds as
  **risk signals** that raise a story's level (mirroring the keyword→risk logic),
  not hard blocks.

**Acceptance:** `conventions.md`/`AGENT_RULES.md` updated by templates; optional
thresholds parsed by `lib/harness.js` and only *raise the recommended mode*.

---

## Explicitly out of scope (do NOT do)

- No "be DRY / eliminate duplication" rule anywhere.
- No subjective quality score as a merge gate.
- No linter/duplication library bundled in the CLI.
- No auto-refactor of detected duplication.

## Resume checklist

- [ ] Tier 1: quality commands flow through `verify` and are captured verbatim.
- [ ] Tier 1: `audit --check` fails on red quality command; `ship` surfaces it.
- [ ] Tier 2: `/quality-check` + `/agent-validator-quality` skills, wired into
      `run-story` + escalation rules, review-only.
- [ ] Tier 3: `conventions.md` DRY framing; optional `harness.json` thresholds as
      risk signals.
- [ ] Behavioral tests on throwaway repos for Tier 1 (green/red toggling).
