# Plan — Honest framing pass (4 changes from user review)

Status: implemented

## Why

An exhaustive external review landed three correct signals and one packaging
insight. This pass acts on them **without amputating** anything or renaming
files (no regression): it makes the front door smaller and the claims honest.

Filtered conclusions we act on:

1. The `agent-*` / "orchestrator" / "harness" naming **oversells** markdown
   prompts as a running multi-agent system.
2. A careful reader concludes the **ceremony is mandatory and front-loaded**
   (Execution Packet, Context Map, 8 stop conditions) — a discoverability
   failure, since that is `STANDARD`/`STRICT`-only.
3. The **evidence pitch** must name where it actually pays off (unattended /
   chained runs / CI / teammates), not the solo dev who watches one `npm test`.
4. `guard` (block secrets before disk) is the **highest value per line** and is
   buried; surface it as the immediate, universal win.

## Explicitly NOT doing (guardrails against regression)

- **No renaming** of skill folders (`agent-planner`, `agent-orchestrator`,
  `agent-validator-*`, `agent-worker-*`) or of the `ai-flow harness` subcommand.
  Mass rename = parity churn (skills/ ↔ templates/), broken cross-references,
  and exactly the "set us back" the user forbade. Change #1 is **surface
  framing only**.
- No removal of the evidence/governance layer. We reframe *where it pays off*,
  we do not cut it (the two identities stay layered).
- No new skills, no CLI changes, no version bump.

## Golden invariants (must hold after each batch)

- `npm test` green (135/135).
- `ai-flow plugin check` in sync (only touched if a SKILL.md changes — avoid).
- Version parity untouched (no package.json / plugin.json / marketplace.json
  version change).

## Batches

### Batch 1 — Honesty of naming (change #1), README only

- Block 3 "The skills": add one honest sentence — the `agent-*` skills are
  **structured prompts Claude Code reads and follows**, not autonomous
  processes or a multi-agent runtime. Naming groups them by role; there is no
  orchestration at runtime.
- Block 4 "The security harness": one honest clarifier at first mention — it is
  a set of **CLI checks over your repo and story files**, not a sandbox (the
  "does not sandbox" note already exists lower down; hoist the honesty up).
- Fix the leftover **"Codex"** mention (line ~377) → "the agent" (Claude Code
  first; stale reference).

### Batch 2 — Shrink the perceived front door (change #2), README only

- Add a short **"Start light"** note high in the doc: most work is
  `/quick-story` or `/run-story FAST`; the Execution Packet, Context Map, and
  multi-point stop conditions **only appear at `STANDARD`/`STRICT`** and are
  opt-in with risk.
- Label the **Execution Packet** and **Context Map** sections as
  `STANDARD`/`STRICT` artifacts (not something you produce for every change).

### Batch 3 — Sharpen the evidence pitch (change #3), README only

- Rewrite the "solo vs teams" line (~974): name the payoff case explicitly —
  **unattended or chained runs, CI, and teammates reviewing a PR** — and
  concede honestly that a solo dev supervising a single run can just press
  Enter. The proof matters when you are *not* in the loop.

### Batch 4 — Surface `guard` (change #4), README only

- Lead the **"What you get"** line (~11) with the concrete, universal win:
  `guard` refuses to write a `.env`/key/secret **before disk** — plus executed
  proof, fewer forgotten files, less context burned.

## Verification

- `npm test` after all batches (no code touched → should stay green).
- Manual read-through of README intro (lines 1–70), Execution Packet / Context
  Map, Security Harness, Reliability Layer.
- No SKILL.md touched → plugin parity untouched.
