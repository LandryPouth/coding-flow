# Epic 14 — Codebase recovery (`/flow-recover`)

## Goal

A developer who built an MVP fast with an agent and comes back to it months
later can, with one skill: get a ranked list of what is actually wrong — each
item **confirmed, refuted, mitigated or not examined**, never just asserted —
fix the findings one by one with a test that **failed before the fix**,
refactor with a check that **behavior did not move**, and pin the flows they
now understand with tests of their own. Design, field test and refusals:
[`docs/plans/codebase-recovery.md`](../../docs/plans/codebase-recovery.md);
freeze exception: `docs/design-decisions.md` entry 13.

## Why

Every gate Coding Flow has is diff-scoped; an MVP's risk is in code no diff
will touch. Read-only field test on a real one (2026-10-18, 162 commits,
19 test files, deployed on AWS): an IDOR and an SSRF confirmed by reading, a
code-execution endpoint refuted (broken, not exploitable), a hard-coded
secret fallback mitigated only by deploy config, the tool's own secret
heuristic wrong, the dependency audit not runnable offline — and none of it
visible to any current check.

## Scope

**In scope** — one skill with four modes (assess, learn, fix, refactor); a
read-only `ai-flow recover scan`; the dossier `docs/recovery/` read by
`status`; `verify --red-at-base`; `verify --claim refactor`;
`validation.security`; CRAP and size from lcov.

**Out of scope — decided in the design**

- A "production-ready" verdict; exploits against deployed systems; bundled
  scanners or a parser per language; a whole-codebase rewrite; scoring the
  developer; persona prompts.
- **Mutation probe** (Uncle Bob wave 5): epic 15, s4–s5 — replayed on bethl
  first, built only on a go; its first use is a refactor claim.
- **Splitting `guard.js` `shellWrites`** (331 lines): story 15-02, the first
  real refactor proven by s4's claim.

**Prerequisite** — epic 13 s1 (a migration is behavior): the data
dimension's fixes are migrations.

## Backbone

`Backbone: scan the MVP → assess it into a dossier of findings with states → status reads the findings and derives "fixed" → a fix is proven by a test red at base → a refactor is proven by tests that did not move → the developer pins a flow with a test → security scanners run as declared, absence reported → hotspots ranked by CRAP`

### Story dependency tree

```text
s1
├── s2
├── s3
├── s4
├── s5
├── s6
└── s7
```

All later stories build on s1's skill file and scan. They each edit their own
section of `templates/.claude/skills/flow-recover/SKILL.md` — run them one at
a time, or expect a trivial merge in that file. `s2`'s "fixed (proven)" needs
`s3`; before `s3` lands, s2 shows a fix as "claimed".

## Stories

1. **story-14-01-assess-an-mvp-end-to-end** — `recover scan`, the skill's
   assess mode, the dossier format, the fixture app, eval case. *(STANDARD —
   walking skeleton)*
2. **story-14-02-status-reads-the-findings** *(STANDARD)*
3. **story-14-03-a-fix-is-red-at-base** *(STRICT — new proof semantics,
   throwaway worktrees)*
4. **story-14-04-a-refactor-keeps-its-tests** *(STRICT)*
5. **story-14-05-learn-pins-a-flow** *(QUICK — skill section)*
6. **story-14-06-security-tools-are-declared-commands** *(STANDARD)*
7. **story-14-07-crap-and-size-from-lcov** *(STANDARD — Uncle Bob wave 4)*

## Decisions

- **A separate skill, the shared core.** `/flow-plan` and `/flow-run` are
  story-shaped; recovery is finding-shaped. Fixes go through story-less
  `verify` (12-01), so recovery needs no epic; a finding too large for one
  change is handed to `/flow-plan`.
- **Name: `flow-recover`**, not `flow-refac` (refactoring is one mode of
  four, and the least urgent) nor `flow-audit` (`ai-flow audit` is the
  evidence ledger).
- **`recover` is a layer module** (`test/layering.test.js`): it requires
  core modules (`security-policy`, `coverage`, `harness-config`), never the
  reverse.
- **Findings are Markdown with fixed field lines**, like acceptance criteria:
  readable and editable by a human, parseable by `status`. No JSON database.
- **Open security findings never reach a public repository's history**
  (design, *The dossier*): checked by the skill, warned by `doctor`.
