# Plan — Pivot to Product B: the trust layer for unattended agent runs

Status: proposed (not started)
Version target: **0.4.0** (breaking; a real pivot, not a patch)

> **One-sentence product.** *Run Claude Code unattended, and get a proof you can
> trust that the work actually ran and passed.*

This plan is the reference for a major repositioning. It is written to be executed
in **risk-ascending batches**, each independently shippable and test-gated, so the
project is never left broken and can stop after any batch with a coherent result.

---

## 0. The decision, stated once

Coding Flow has two products fighting inside it. We **choose B** and cut what only
serves A.

- **A — planning structure against prompting fatigue** (the Spec Kit lane).
  Commodity, well-served, undifferentiated. We do **not** compete here.
- **B — trustworthy proof of what an unattended agent actually did.** Emerging,
  under-served, and the only place our evidence spine (`guard`, `verify`, `audit`,
  `trace`, `ci`, freshness/`stale`) is a real moat.

The center of gravity moves from the **plugin** (interactive) to the **CLI/npm**
(headless). The plugin stays as optional interactive sugar.

### What we are explicitly NOT doing

- Not deleting the depth. STANDARD/STRICT rigor becomes **opt-in and demoted**, not
  amputated. The simple user stops seeing it; the hard case still activates it.
- Not becoming a smaller Spec Kit (that throws away the moat).
- Not validating with 5 users first — the author has decided to build the pivot.
  (The risk this transfers is recorded in §9.)
- Not touching the storage seam / `github` backend (deferred, out of scope).

### Guiding invariants (hold after EVERY batch)

1. `npm test` green. Update tests **in the same batch** as the code they cover.
2. Plugin parity: `ai-flow plugin check` in sync; any skill add/remove/rename
   happens in **both** `templates/.claude/skills/` (source of truth) and `skills/`.
3. `doctor` stays green on a fresh `init` (it validates required files + that each
   installed skill's frontmatter `name` matches its folder).
4. No new **npm runtime dependency** (zero-dep stance preserved). The one new
   *external* prerequisite (`claude` CLI, Batch 4) is optional and degrades.
5. Version parity (`package.json` == `plugin.json` == `marketplace.json`) — bump
   all three together, once, in Batch 6.

---

## 1. The hard architectural decision (read before anything)

`ai-flow run --unattended` is the feature that *defines* B and it **does not exist
today**. Today the "run" lives entirely in the `run-story` **skill** (a prompt);
the CLI only offers `harness verify`, `status`, `ship`. So the CLI has never had to
**drive an agent**. This is new, and it is the highest-risk work in the plan.

**Design: the CLI orchestrates, an external agent binary executes.**

- `run` shells out to the **`claude` CLI in non-interactive print mode**
  (`claude -p "<prompt>" --output-format json`, one invocation per story), loops
  over the selected stories, runs `ai-flow harness verify` between each, stops on a
  red verify or a declared stop-condition, and emits **one** aggregated proof report.
- This adds an **external-tool dependency on `claude`** for the unattended path
  only — *not* an npm dependency. Detect it (`claude --version`); if absent, `run`
  degrades to printing the ordered prompts for a human to paste (still useful).
- The whole evidence spine (`verify`, `guard`, `audit`, `status`) keeps working
  **without** `claude` present, exactly as today.

This trades the "pure zero-dependency" elegance for the product. That trade is the
whole point of the pivot; make it consciously, in code comments and the README.

**De-risking:** Batch 4 ships `run` in two steps — first a deterministic,
agent-free skeleton (`--dry-run` prints the plan + prompts, runs verify), then the
`claude -p` wiring behind a `--unattended` flag marked **preview**. If the wiring
proves unreliable, we ship everything else and keep `run` at the skeleton stage; the
0.4.0 story still holds (see §9 kill-switch).

---

## 2. Batch 1 — Merge the rules files (low risk)

**Goal:** `PROJECT_RULES.md` + `AGENT_RULES.md` → a single `RULES.md`; drop the
redundant `AGENTS.md` (Claude Code first; keep only `CLAUDE.md`).

**Files**
- `templates/`: create `RULES.md` (union, de-duplicated); delete `AGENT_RULES.md`,
  `PROJECT_RULES.md`, `AGENTS.md`.
- `templates/CLAUDE.md`: import becomes `@RULES.md` (was `@PROJECT_RULES.md` +
  `@AGENT_RULES.md`).
- `bin/lib/templates.js`: update the installed-file spec list (~line 43) and any
  required-file constant.
- `bin/lib/doctor.js`: update the required-files list.
- `bin/lib/uninstall.js`: update the removed-files list.
- Every SKILL.md that says "Read PROJECT_RULES.md / AGENT_RULES.md" → "Read
  RULES.md" (both trees; grep first).
- Tests: `templates.test.js`, `cli.test.js` (any hardcoded file names), doctor tests.

**Done when:** `init` on a clean dir lays down `RULES.md` + `CLAUDE.md` only; doctor
green; `npm test` green.

---

## 3. Batch 2 — Collapse story artifacts 6 → 3 (medium risk)

**Goal:** per-story files go from `story.md / tasks.md / tests.md / decisions.md /
implementation-notes.md` (+ epic `index.md`) to **`spec.md` / `plan.md` /
`tasks.md`**. `spec.md` = what & acceptance; `plan.md` = how + decisions +
risks/rollback (folds `decisions.md`); `tasks.md` = the checklist + the executed
outcome (folds `implementation-notes.md` as a "Result" section). Tests live inside
`plan.md`/`tasks.md`, not a separate file.

**Files**
- Blueprint skills: collapse `blueprint-{story,tasks,tests,decisions,epic-index,
  implementation-notes}` → two skills that emit the 3 files (or fold into `plan`).
- `plan-epic` / `write-story` skills: reference the 3-file layout.
- `templates/examples/epic-01-*`: regenerate to the new layout.
- `bin/lib/status.js`, `bin/lib/harness.js`, `bin/lib/trace.js`: anywhere that reads
  `implementation-notes.md` for status/evidence/trace now reads the `Result` section
  of `tasks.md` (grep `implementation-notes` / `decisions` / `tests.md` across `bin/`).
- `bin/lib/harness.js` `verify` command-discovery: it reads the `## Commands` block
  of `tests.md` today → point it at `plan.md`/`tasks.md` (§ keep config
  `validation.commands` as the primary source; the markdown block is fallback).
- Tests: `status-evidence.test.js`, `harness-verify.test.js`, `trace.test.js`,
  `status.test.js` — update fixtures to the 3-file layout.

**Done when:** a story folder has exactly `spec.md / plan.md / tasks.md`; `status`,
`verify`, `trace` resolve against the new layout; `npm test` green.

**Risk note:** this batch touches the status/evidence resolution — the moat. Change
fixtures and resolution together; run the full suite before moving on.

---

## 4. Batch 3 — Consolidate skills & kill the multi-agent theater (medium risk)

**Goal:** from 31 skills to a small flat set. **Rename, don't delete** where a
capability survives; fold the rest into `run`/`review`.

**Target skill set (both trees):**

| Skill | Absorbs |
| --- | --- |
| `setup` | (keep) |
| `plan` | `plan-epic`, `agent-planner`, `write-story`, `blueprint-*`, `grill-me`, `bootstrap-brownfield` (as sections/steps) |
| `run` | `run-story`, `quick-story`, `implement-slice`, `tdd`, `agent-worker-*`, `agent-context-scout` (as an inline mode) |
| `verify` | (new thin skill) explains `ai-flow harness verify` + the proof |
| `review` | `review-codebase`, `architecture-check`, `tests-check`, `e2e-check`, `quality-check`, `security-check`, `agent-validator-*` (as opt-in depth sections) |
| `ship` | thin skill around `ai-flow ship` |

- **No `agent-*` names survive.** Frontmatter `name` must equal folder name (doctor
  enforces this) — so renaming = new folders in **both** trees + `plugin sync`.
- Depth (STANDARD/STRICT, deep validators, context scout) becomes **sections inside
  `run`/`review`**, opt-in, not top-level skills. Nothing capable is lost; it stops
  being a separate front-door item.
- `bin/lib/skills.js`: update the macro list.
- `bin/lib/commands.js`, `bin/lib/templates.js` cheat sheet: update skill references.
- `README.md` skills catalog + `.claude-plugin/*` descriptions: new set.
- Tests: `plugin.test.js` (parity is automatic via sync, but re-run), `cli.test.js`
  (`list-skills` count/names), any test asserting a skill name.

**Guardrail against the "skills get longer" regression:** the modes stay short
sections in `run.md`; the fused `run` must be shorter than the *sum* of the chain it
replaces (single preamble, not ten). Record before/after line counts in the PR.

**Done when:** `.claude/skills/` holds the small flat set; doctor green (name==folder);
`plugin check` in sync; `list-skills` reflects the new set; `npm test` green.

---

## 5. Batch 4 — `ai-flow run`: the product (high risk, staged)

> **Status: 4a DONE (2026-07-31). 4b DEFERRED per the §8 decision.** `bin/lib/run.js`
> ships the deterministic orchestrator with the pluggable-driver seam (`--driver`,
> default `none`; agent drivers reserved and fail cleanly). `run.test.js` covers
> dry-run, pass, fail→exit 1, skipped-not-failed, the driver seam, and the empty
> case. 4b (`--unattended` → `claude -p`) stays a reserved seam, not built.

**Goal:** the CLI can drive a run and emit one trustworthy proof report.

**New module `bin/lib/run.js` + `run` in the dispatcher.**

**Step 4a — deterministic skeleton (no agent):**
- `ai-flow run --epic <dir>` / `--story <dir>`: resolve the ordered stories,
  build the per-story prompt from `spec.md`/`plan.md`, and with `--dry-run` print
  the ordered prompts + the stop-conditions + the verify commands that *would* run.
- Between stories, call the existing `harness verify`; stop on red or on a declared
  stop-condition; aggregate results.
- Emit **one** report: `.coding-flow/runs/<run-id>.json` (+ a human summary), with
  provenance (commit/branch/author/dirty) and per-story verify result.
- Tests: `run.test.js` — dry-run ordering, stop-on-red, one aggregated report, no
  `claude` binary required.

**Step 4b — unattended wiring (preview):**
- `ai-flow run --unattended`: detect `claude` (`claude --version`); for each story,
  invoke `claude -p "<prompt>" --output-format json` in the repo (or a `--story`
  worktree), then `verify`, then continue/stop per the loop above.
- If `claude` is absent: print the ordered prompts and exit 0 with a clear "no agent
  driver found" note (graceful degradation).
- Flag it **preview** in `--help` and the report. Do not lead the README with it
  until it is proven on a real repo.
- Tests: mock the driver (a fake `claude` on PATH via a temp shim) to assert the
  loop, stop-on-red, and report shape — never call the real model in tests.

**Done when:** `run --dry-run` and `run` (skeleton) are solid and tested;
`--unattended` works end-to-end on one real repo (manual), documented as preview;
`npm test` green.

---

## 6. Batch 5 — Harden the spine for headless (low/medium risk)

> **Status: DONE (2026-07-31).** The `ci init` workflow now verifies per story via
> `run` (falling back to repo-wide `harness verify` for global-config projects),
> then `audit --check`, all pinned to the exact published version. This closed a
> real gap: the old repo-wide `harness verify` found *no* commands for a
> story-based repo that declares them in each `plan.md`. `ci.test.js` asserts the
> `run` wiring and that no unpinned reference can leak into the workflow. Deferred
> as optional (not needed for a coherent gate): a `run --format md` renderer —
> `ship` already attaches verify evidence to PRs and `audit --export` already
> produces the markdown view, so the schemas already agree at the evidence level.

**Goal:** make the proof trustworthy when nobody is watching.

- **Pin enforcement everywhere** headless: `ci init` template and any `npx` call in
  generated CI use `@landry_pouth/coding-flow@<version>` (already done for the guard
  hook; extend to the CI workflow and `run`'s own self-references).
- **`ci init`** template updated to run `ai-flow run` (or `verify` + `audit --check`)
  on a clean checkout — the non-gameable gate is the headline of B.
- **One report format**: the `run` report and `audit --export` agree on schema so a
  reviewer/CI sees the same proof. Add a `--format json|md` if useful.
- Tests: `ci.test.js`, `audit.test.js`, `evidence-freshness.test.js` extended for the
  run report + pin assertions.

**Done when:** a generated CI workflow replays a pinned `run`/`verify` + `audit
--check` and fails on red/stale/missing proof; `npm test` green.

---

## 7. Batch 6 — Reposition (docs + version, do LAST so docs match reality)

**Goal:** the surface now *describes what shipped*, CLI-first.

- `README.md`: rewrite around the one-sentence pitch; **CLI/CI first**, plugin as an
  optional add-on second (invert today's plugin-Step-1 ordering). Lead with
  `npx … run` and `audit --check` in a CI snippet. First line of the README states
  the **product-vs-personal-tool** decision (see §8).
- `package.json` / `.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json`:
  new description (the one sentence) + **bump all three to 0.4.0 together**.
- `docs/QUICKSTART.md`, `docs/contributing.md`: CLI-first flow; document `run`.
- `docs/migration.md`: **breaking-change guide** — the 0.3 → 0.4 file renames
  (`RULES.md`, 3-file stories, skill set), how `upgrade` handles them, and what a
  user must do by hand. This is mandatory: existing installs must not silently break.
- Tests: `plugin.test.js` version-parity assertions pass at 0.4.0.

**Done when:** version parity at 0.4.0; README leads with the CLI; migration guide
covers every rename; `npm test` green.

---

## 8. The decision line (put it in the README, first paragraph)

> **Decided (2026-07-31): "Personal tool + competence signal."** Rationale: the
> daily driver is a $20 Claude plan plus DeepSeek for bulk work — a budget that
> does not support routine token-heavy *unattended* Claude runs, and a workflow
> that is already multi-model. So we ship the spine and build `run` (4a) with an
> **agnostic, pluggable driver seam** (the valuable part for a multi-model user),
> but treat the Claude-only unattended path (4b) as optional/deferred. The README
> reposition (Batch 6) must open with this line.

Write one of these two, explicitly, before any refactor code:

- **"Product."** → you will seek users, keep the preview `--unattended` path a first-
  class roadmap item, and measure adoption. Batches 4–5 are the priority.
- **"Personal tool + competence signal."** → you keep it excellent for yourself,
  ship the spine, and treat `--unattended` as optional. Batches 1–3 + 6 suffice; 4–5
  are optional polish.

Everything downstream (how much time, whether to chase `--unattended`) follows from
this line. Do not skip it.

---

## 9. Risk register & kill-switch

| Risk | Mitigation |
| --- | --- |
| `--unattended` (Batch 4b) proves flaky | **Kill-switch:** ship Batches 1–3, 4a, 5, 6 without 4b. `run --dry-run` + a solid spine + CLI-first docs is *already* a coherent 0.4.0. B's promise degrades to "drive the loop, prove each step" — still real. |
| Skipping the 5-user validation (author's call) | This plan builds before demand is confirmed. If Batch 6 ships and nobody bites in ~1 month, that is the signal — treat it as the deferred validation, and do **not** keep adding surface. |
| Status/evidence resolution breaks in Batch 2/3 | These touch the moat. Change fixtures + resolution together; never move on with a red suite; the batches are ordered so the risky ones (2, 3, 4) sit between safe ones. |
| Anthropic ships "verified runs" natively and eats B | Accept it as possible (recorded last conversation). The `product` vs `personal-tool` line (§8) is how you hedge: if it's a personal tool + portfolio, native absorption is fine. |
| Breaking existing 0.3 installs | Batch 6 migration guide is mandatory; `upgrade` must rename, not duplicate; test upgrade on a real 0.3 install before tagging. |

---

## 10. Sequencing

```
Batch 1 (rules)  →  Batch 2 (3-file stories)  →  Batch 3 (skills)
       →  Batch 4a (run skeleton)  →  Batch 4b (unattended, preview)
       →  Batch 5 (headless hardening)  →  Batch 6 (reposition + 0.4.0)
```

- Strictly sequential 1→3 (each changes the layout the next assumes).
- 4a before 4b, always. 4b is optional per §8/§9.
- 6 is always last (docs must not describe unshipped behavior).
- One PR per batch, each with green tests and a before/after note. Do not batch two
  together — the whole point is to never be able to lose the project in one step.

## 11. Definition of done (the pivot)

- README opens with the one-sentence pitch and the §8 decision line.
- The default path a new user sees is `npx … init` then `ai-flow run` — plugin is
  clearly optional.
- `.claude/skills/` is a small flat set, no `agent-*` names, no separate deep
  validators at the front door.
- A story is 3 files; the rules are one `RULES.md`.
- `run` produces one pinned, provenance-stamped proof report; `ci init` gates on it.
- `npm test` green throughout; version parity at 0.4.0; migration guide complete.
- Nothing capable was deleted — depth is opt-in, machinery is hidden, not amputated.
