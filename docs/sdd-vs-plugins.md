# From the old SDD to a plugin + governance layer

> Why coding-flow changed nature, what stays the same, and what is left to do for
> the package to be **fully usable and online**.

## TL;DR

- **Before**: coding-flow was an **SDD** (Spec-Driven Development) tool — a
  methodology (epics → vertical stories → skills that plan, write, implement,
  validate) shipped as a **bundle of skills** installed via `npx`. Its value =
  the structure and the discipline.
- **Now**: the SDD methodology **remains the foundation**, but the tool positions
  itself as an **evidence & governance layer** (enforcement, provenance, executed
  proof, audit ledger, traceability, CI gate), and is also **distributed as a
  native Claude Code plugin**.
- **Why**: skill distribution became a commodity (native plugins + marketplaces),
  and the real enterprise blocker is not the methodology but **governance**
  (audit, compliance, proof).
- This is not a rewrite: it is **additive**. The SDD skills still exist; we built
  the proof layer **on top**.

## 1. The old model: SDD (Spec-Driven Development)

SDD is the category of tools where you **describe the intent** (specs, plans,
stories) and an agent **implements** from that description. Examples from the
same family: GitHub **Spec Kit**, **BMAD**, **Kiro**, **OpenSpec**.

coding-flow, in that logic, provided:

- a **format**: epic → vertical story → `spec.md` / `plan.md` / `tasks.md`;
- **skills** (planner, story writer, implementer, validators);
- **rules** and a **security harness** that *scans* (secrets, sensitive files)
  and *estimates* a story's risk;
- a **distribution** via the published npm package (`npx @landry_pouth/coding-flow`).

**Its real value**: imposing structure and discipline on an agent, to avoid
"go-with-the-flow" code. That is useful — but it is what the *whole* SDD category
does.

**Its limits** (what triggered the pivot):

1. **Proof relied on the agent's assertion.** "It's done", "the tests pass":
   nothing *executed* it nor *signed* it. Yet the same AI writes the code **and**
   the tests — a "green" proves almost nothing.
2. **The harness was advisory.** It scanned *after the fact* and *flagged*; it
   *prevented* nothing. A secret could still reach the disk.
3. **Distribution was a treadmill.** Every release = re-ship the skills bundle.
   Barely differentiating, costly to maintain.

## 2. What changed in the ecosystem (the "why")

Three shifts, all in 2026:

- **Native plugins + marketplaces commoditize skill bundles.** Claude Code now
  installs plugins in one command (`/plugin marketplace add …`, `/plugin install
  …`), and marketplaces publish skill packs by the dozen. Being "one more skill
  pack" is no longer an advantage.
- **The SDD category is saturated.** Competing on *skill breadth* or "being
  another Spec Kit" is a lost race from the start.
- **The real enterprise blocker is governance, not code quality.** ~88% of AI
  pilots never reach production — because of audit, compliance, and control, not
  because the code is bad. The uncovered need is **proof**: who did what, is it
  *really* verified, can you show it to an auditor.

Strategic conclusion: don't compete on skills (commoditized), but **own the layer
nobody holds** — evidence and governance — and **use the plugin channel** so that
distribution stops being a burden.

## 3. The new model: evidence & governance layer

The single guiding principle:
*"nothing executed ≠ verified; asserted ≠ proven; anonymous ≠ auditable"*.

Every *advisory* guardrail becomes an *executed* guardrail, attached to an
**identity**, aggregated into an **exportable ledger**, and verified **out of the
agent's hands**. Concretely (see the plan for the detail):

- **`guard`** — **deterministic** enforcement: a PreToolUse hook refuses writing
  a blocked path or a secret **before** the disk. We move from *advice* to an
  *in-code guardrail*.
- **Provenance** — every proof carries commit / branch / author / dirty state.
- **`verify`** — *actually* runs the declared validation commands and captures
  the result verbatim; "nothing executed ≠ verified".
- **`audit`** — **append-only** ledger + `docs/AUDIT.md` export (compliance
  artifact) + `--check` gate "no merge without green proof".
- **`ship`** — attaches the `verify` proof to the PR body.
- **`trace`** — story → commits → PR → evidence → tests chain, missing links
  flagged. *"Prove that the requirement is delivered AND verified."*
- **`ci init`** — replays `verify` + `audit --check` on a fresh checkout: the
  non-gameable signal, on free compute.

And **distribution becomes an asset again**:

- **Native plugin** (`.claude-plugin/`): skills + `guard` hook installed without
  `ai-flow init`, updated via marketplace — end of manual re-shipping.
- **npm** (`@landry_pouth/coding-flow`): the CLI and the CI.
- The two channels **coexist**: npm for CLI/CI, plugin for the IDE.

## 4. SDD (before) vs governance layer (now)

| Axis | Old SDD | Now |
| --- | --- | --- |
| What is proven | intent is **specified** | delivery is **verified** |
| Source of truth | the agent's **assertion** | the **machine** (execution + verbatim capture) |
| Security | scan **after the fact**, *advisory* | refusal **before write**, *deterministic* (`guard`) |
| Identity | anonymous | signed git provenance on every proof |
| History | scattered run files | **append-only** ledger + compliance export |
| Traceability | implicit | explicit, end-to-end (`trace`) |
| Gate | the agent re-reads itself | clean-room CI, **out of its hands** |
| Distribution | `npx` bundle (treadmill) | native plugin + marketplace + npm |
| Differentiation | "one more SDD" | the layer the category does not hold |

What SDD **keeps**: the epics/stories, the skills, the story format, the test
discipline. That is the **foundation**, not what disappeared.

## 5. Current state

Published as **`@landry_pouth/coding-flow`** on npm (0.4.0) and installable as a
native Claude Code plugin. The evidence & governance spine is live end-to-end:
`guard` (deterministic write refusal), `verify` (executed proof), `audit`
(append-only ledger + `docs/AUDIT.md` export + `--check` gate), `trace`, `ship`,
and `ci init`. The plugin ships the six skills plus the `guard` hook, and `guard`
resolves through `npx --yes @landry_pouth/coding-flow guard` now that the package
is published.

### Deliberately deferred

- **Codex target.** The workflow is Claude-Code-first; a Codex install target is
  planned, not built (as `package.json` states).
- **Unattended agent driver.** `ai-flow run` orchestrates story-based
  verification; agent *execution* is a reserved `--driver` seam, not yet wired.
- **GitHub storage backend.** The storage seam exists with a clean `fail()`; the
  `github` backend stays deferred until a real need appears.
- **Diff-coverage runner.** `ci init` provides the documented hook, not a runner;
  wire a third-party tool if needed.

## In one sentence

The old coding-flow **described** the work (SDD); the new one **proves and governs
it**, and distributes through the channel (plugin) that made plain skill bundles
obsolete — published on npm, installable as a plugin, with `guard` active.
