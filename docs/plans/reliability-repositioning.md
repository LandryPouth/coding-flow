# Reliability repositioning + distribution cleanup

**Status: implemented** on branch `refactor/reliability-repositioning` (134/134
tests green, plugin skills in sync). All 10 items done; item 8 took the lighter
"fallback note" path rather than churning 9 skill files; item 10 ships the
benchmark *framework* only (no fabricated numbers). Historical `run-story-secure`
mentions in other `docs/plans/*` were left as design-record.

Implementation plan for the 10 changes agreed after two external reviews of the
tool. Guiding rule throughout: **subtract / layer / reframe — never amputate.**
The machinery (verify, guard, audit, trace, CI) stays; what changes is the
*surface*, the *pitch*, and the *distribution wiring*.

Golden invariants (must stay green the whole way):
- `npm test` = 133+ passing after every batch.
- `ai-flow plugin check` stays "in sync" (`skills/` mirrors `templates/.claude/skills/`).
- `plugin.json` / `marketplace.json` version == `package.json` version.

Any skill add/remove/rename happens in **both** `skills/<name>/` and
`templates/.claude/skills/<name>/`.

---

## Batch A — Positioning & docs (text-only, low risk)

**1. Reframe "governance" → "reliability" as the headline.**
- `package.json` `description`: lead with reliability; governance is a sub-clause.
- `.claude-plugin/plugin.json` `description`.
- `.claude-plugin/marketplace.json` top `description` + plugin `description`.
- `README.md:7-22` intro + `README.md:956` "Evidence & Governance Layer" heading →
  keep the section but frame it as the *reliability* layer with governance as the
  enterprise-facing sub-product.

**2. Rewrite the README top.** One-sentence value prop vs. plain Claude Code, then
the ~5 public entries, machinery below the fold. Keep the existing "In a hurry"
callout; tighten the four-blocks/Overview so governance vocabulary isn't the first
thing a solo dev meets.

**3. Fix the overclaim.** `README.md:958` and the "non-fakeable" language: state
precisely — verify proves *the agent cannot lie about having run the commands and
their result*, NOT *the code is correct* (the agent still writes code + tests).
Adjust `docs/plans/testability.md` reference wording only if it repeats the claim.

## Batch B — Distribution wiring (mechanical, medium risk)

**4. Kill `npx github:…` → `npx @landry_pouth/coding-flow`.** Package is published,
so github fetch only adds latency and breaks pinning. Targets:
- `bin/lib/context.js:12` `githubNpxCommand` → published-package command.
- `README.md` (~8 spots: 157, 199, 219, 225, 879, 898, 904, 1080-1084) + the
  "GitHub distribution via npx" section reframed to note npm is primary.
- `docs/QUICKSTART.md:11`, `docs/plans/testing-and-ci.md`, `docs/sdd-vs-plugins.md`.

**5. Pin the CLI version to the package/plugin version where it must match.**
- `.claude-plugin/hooks/hooks.json`: `... coding-flow@<version> guard`.
- `bin/lib/settings.js` `guardCommandString()`: `@${packageJson.version}`.
- `bin/lib/ci.js`: pin verify/audit invocations to the version.
- Leave user-facing `flow:*` scripts and doc examples on unpinned latest (they
  *want* fixes; reproducibility that matters is the guard + CI).
- **New test** in `test/plugin.test.js`: the version pinned in `hooks.json` equals
  `package.json` version (turns the coupling into an enforced invariant).

## Batch C — Surface reduction (structural, higher risk)

**6. Shrink the public skill surface.** `bin/lib/skills.js` already groups; make the
default `list-skills` lead with Macro and clearly mark the rest as
"run for you". `README.md:543` Skills Catalog: collapse the atomic/validator tables
under a single "Under the hood (called by run-story)" fold; keep only Macro up top.

**7. Merge `run-story-secure` into `run-story STRICT`.** `run-story` already has a
STRICT pipeline covering the secure steps.
- Delete `skills/run-story-secure/` and `templates/.claude/skills/run-story-secure/`
  (via `trash`).
- `run-story` SKILL.md: fold the secure required-questions / secure stop-conditions
  into STRICT; replace every "escalate to /run-story-secure" with "use STRICT".
- `bin/lib/skills.js` `skillGroup`: drop `run-story-secure` from the Macro list.
- Sweep all references: `README.md` (40, 60, 552, workflow tables), other skills
  that mention `/run-story-secure`.
- Re-run `ai-flow plugin sync` if needed so `skills/` matches templates, then
  `plugin check`.

**9. `/init` as a plugin skill.** Add `skills/setup/SKILL.md` (+ templates mirror):
a thin skill that runs `npx @landry_pouth/coding-flow init` from Claude Code so the
whole flow is one context (`/plugin install` → `/setup`). Add to skills.js grouping
and README. Keep it advisory (offers to scaffold; does not clobber existing files —
`init` is already non-destructive by default).

## Batch D — CLI invocation consistency

**8. Skills call the CLI consistently.** The 9 skill files using bare `ai-flow …`
assume a global install that a plugin user may not have. Two acceptable fixes;
choose the lighter: prefer wording that already guards ("When `ai-flow` is
available…") and add the npx fallback form once, rather than rewriting every line.
Concretely: keep `ai-flow …` as the primary (works after `init`/link) but document
`npx @landry_pouth/coding-flow …` as the fallback in the "Harness Automation"
preamble of `run-story`. Avoids churning 9 files while removing the ambiguity.

## Batch E — Credibility framework (no fabricated data)

**10. Experiment framework.** Add `docs/experiments/reliability-benchmark.md`: the
methodology (5 tasks: fix / CRUD / refactor / auth feature / cross-module bug),
the metrics (tokens, first-pass success, round-trips, files missed), a results
table left **empty / "pending run"**. DO NOT invent numbers. Link it from the
README as "how we're validating the thesis (in progress)."

---

## Order of execution
A → B → C(6) → C(7) → C(9) → D(8) → E(10), running `npm test` + `plugin check`
after B, after each of C's items, and at the end. Update the README table-of-
contents / internal-docs table for any new/removed doc.

## Explicitly NOT doing (rejected review advice)
- No plugin-only / dropping npm. - No 2-package split. - No `/do` auto-rigor.
- No multi-agent breadth push. These would amputate the differentiator.
