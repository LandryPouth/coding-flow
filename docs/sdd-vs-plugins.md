# From the old SDD to a plugin + governance layer

> Why coding-flow changed nature, what stays the same, and what is left to do for
> the package to be **fully usable and online**.
> Detailed design of the additions: [`docs/plans/evidence-governance.md`](plans/evidence-governance.md).

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

- a **format**: epic → vertical story → `story.md` / `tasks.md` / `tests.md` /
  `decisions.md` / `implementation-notes.md`;
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

## 5. What is left to do to publish and make the tool usable online

Current state: 97 green tests, version **0.2.0**, PR **#7** open against `main`
(https://github.com/LandryPouth/coding-flow/pull/7). Remaining, in order:

### A. Merge and publish (prerequisite to everything else)

1. **Merge PR #7 into `main`** once the CI is green.
2. **Authenticate to npm** (current blocker: `ENEEDAUTH`). Interactively:
   ```bash
   npm login --auth-type=legacy      # @landry_pouth account
   ```
3. **Publish** from `~/dev/tools/coding-flow`:
   ```bash
   npm test                          # also run by prepublishOnly
   npm publish                       # publishes @landry_pouth/coding-flow@0.2.0
   ```

> ⚠️ **Critical dependency — `guard` only works once published.**
> The wired hook (in `.claude/settings.json` and in `.claude-plugin/hooks/hooks.json`)
> invokes `npx --yes @landry_pouth/coding-flow guard`. As long as the package is
> **not** published on npm, `npx` cannot resolve it and the hook blocks nothing.
> **npm publication is therefore a prerequisite** for the enforcement (the
> flagship argument) to actually be active for the user. Do it first.

### B. Validate the plugin channel end-to-end

4. **Test the real plugin install** in a Claude Code session:
   ```text
   /plugin marketplace add LandryPouth/coding-flow
   /plugin install coding-flow
   ```
   Verify that the skills appear and that the `guard` hook fires.
5. **Confirm that `guard` actually refuses in real conditions**: try to write a
   `.env` or content with a fake secret, and verify the refusal (exit 2).

### C. Consistency & finishing

6. **Repo name vs package**: the repo is `coding-flow` (without the "g") while the
   package is `@landry_pouth/coding-flow`. Decide whether to rename the repo for
   discoverability, or to accept the gap (documented).
7. **CHANGELOG**: add a 0.2.0 entry listing the evidence & governance layer
   (useful for future users and the marketplace).
8. **Clean-install smoke test**: `npx @landry_pouth/coding-flow init` in a
   throwaway project after publication, then `ai-flow doctor`, `harness verify`,
   `audit --export`, `trace` — verify the full path in real conditions.
9. (Optional) **README**: npm/CI badges, "Install as a plugin" section already
   present, to re-check once the plugin install is validated.

### Out of scope (deliberately deferred)

- **GitHub storage backend** (issues/sub-issues): the seam exists, the
  implementation stays deferred until a real need appears.
- **Home-made diff-coverage runner**: `ci init` provides the documented hook, not
  a runner; you wire a third-party tool if needed.

## In one sentence

The old coding-flow **described** the work (SDD); the new one **proves and governs
it**, and distributes through the channel (plugin) that made plain skill bundles
obsolete. To be fully online, all that is missing is the **npm publication**
(which also unblocks `guard`) and the **validation of the plugin channel**.
