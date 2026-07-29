# Story status & post-implementation check enforcement

> Implementation plan closing two real gaps: (1) story status is inferred from
> prose and only *semi*-automatic, and (2) nothing on the machine side forces a
> story to be *checked* after implementation — the agent is merely *told* to, so it
> can silently skip it (the exact pain from the previous version).

## Thesis

`done` in `ai-flow status` must mean **"a green `verify` exists for this story,
verified out of the agent's hands"** — not "the agent wrote enough prose". The user
should never again have to ask the agent to check finished work. The guarantee comes
from the machine (CI gate + git hook), never from the agent's good behavior.

## Current behavior (verified in code)

- `ai-flow status` is **not** a live state machine. It re-reads
  `implementation-notes.md` at each call (`bin/lib/storage/local.js:13`,
  `inferStoryStatus`).
- Status derivation:
  - explicit `## Status <x>` in the notes → used as-is;
  - else **keyword heuristic** on prose: contains "blocked"/"stop condition" →
    `blocked`; "pass" + "validation" → `done`; body > 160 chars → `in-progress`;
    else `planned`.
- Post-implementation checking: the `run-story` SKILL *instructs* the agent to run
  `harness verify/check/evidence` ("The user should not need to ask") — but this is
  a **prompt instruction, not a gate**. If the agent skips it, nothing stops it.
- The only **deterministic** guarantee today is `ai-flow audit --check` (fails if
  the latest `verify` per story is red **or missing**), plus `guard` (secrets).

**Gaps:** the heuristic is fragile, and the check relies on the agent's compliance.

## Non-negotiable constraints (inherited)

- **Zero runtime dependencies.** `node:*` + optional `git`/`gh` shell-out.
- **Nothing blocks by surprise.** Hooks only active when explicitly wired; absent
  → flag, don't break a legitimate repo.
- **Idempotence + `--dry-run`.**
- **Evidence is the truth.** Status must be backed by a captured `verify`, not by
  narrative.

## Implementation order

```
1. status backed by evidence  ── deterministic, no false "done"
2. run-story writes status from proof  ── done only after green verify
3. machine-enforced check  ── audit --check in CI + pre-push hook
```

---

## Module 1 — Status backed by evidence, not prose

**Intent.** Make `done` provable and kill the fragile keyword heuristic as the
*primary* source.

- `bin/lib/storage/local.js` (`inferStoryStatus`): resolution order becomes
  1. explicit `## Status <x>` in `implementation-notes.md` (authoritative);
  2. **latest `verify` evidence for the story** in `.coding-flow/runs/` — green →
     `verified`, red → `blocked`;
  3. existing prose heuristic only as a last-resort fallback.
- Introduce a distinct `verified` status (proof exists) vs `done` (author-asserted),
  so `status` can show the difference between "claimed" and "proven".

**Acceptance:** a story with a green `verify` shows `verified` even if the notes are
sparse; a red `verify` shows `blocked` even if the notes say "done". Verified via
throwaway repo + injected run files.

## Module 2 — `run-story` writes status from proof

**Intent.** Stop the agent from writing `## Status: done` on vibes.

- `skills/run-story/SKILL.md` + `run-story-secure`: after implementation, run
  `harness verify`; write `## Status: done` **only** when `verify` is green and
  captured. On red/absent → write `blocked` / `in-progress` with the reason.
- Make the verify step a **required, non-skippable** phase in the pipeline text
  (not an "automation when available" aside).

**Acceptance:** skill wording makes `done` conditional on a green captured verify;
`doctor` frontmatter still passes.

## Module 3 — Machine-enforced check (close the trust hole)

**Intent.** Never rely on the agent to verify itself. The check is enforced by the
machine, out of the agent's hands.

- **CI gate:** `ai-flow ci init` already scaffolds `verify` + `audit --check`.
  Document it as the primary guarantee: no merge without a green `verify` per story.
- **Local pre-push hook:** extend the `.githooks`/settings wiring so `pre-push`
  runs `ai-flow audit --check` — no push if any story's latest `verify` is red or
  missing. Opt-in, idempotent, `--dry-run`-able; degrades cleanly if `ai-flow`
  absent.
- Result: `verified`/`done` in `ai-flow status` is guaranteed by CI/hook, so the
  user never has to ask "did you check this?".

**Acceptance:** in a throwaway repo, a story with no/red `verify` makes
`audit --check` (and the pre-push hook) fail; a green one passes. Exit-code tested.

---

## Explicitly out of scope (do NOT do)

- No live daemon / watcher tracking status in real time — status stays derived on
  read, just from **evidence** instead of prose.
- No blocking hook enabled by default in a repo that never opted in.
- No trust in the agent's self-report as the source of `done`.

## Resume checklist

- [x] **Module 1 — shipped.** `inferStoryStatus` resolves: explicit `## Status`
      → verify evidence (`verified`/`blocked`) → prose fallback. `latestVerifyByStoryDir`
      added to `lib/audit.js` and consumed by `lib/storage/local.js`; the pure
      resolver stays unit-testable (`verify` passed in).
- [x] **Module 2 — shipped.** `run-story`/`run-story-secure` make `verify` a
      required, non-skippable phase and write `## Status: done` only after a green
      captured `verify` (new "Status From Proof" section, synced to `skills/`).
- [x] **Tests — shipped.** `test/status-evidence.test.js`: pure resolver + CLI
      end-to-end (green→verified, red→blocked, latest-wins, explicit override,
      prose fallback). Full suite green (`npm test`).
- [ ] **Module 3 — follow-up (not shipped here).** The deterministic guarantee
      already exists via `ai-flow audit --check` + `ai-flow ci init` (clean-room CI
      gate: no green verify per story ⇒ fail). A *local* `pre-push` hook that runs
      `audit --check` in the target project is deferred: it touches `init`/uninstall
      wiring and mutates the user's `git config core.hooksPath`, so it must stay
      opt-in and land as its own change.
