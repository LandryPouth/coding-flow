# The evidence & governance layer

> Implementation plan for the 7 changes that take coding-flow from "AI methodology"
> to an **evidence and governance layer** — the only ground not commoditized by
> native plugins / marketplaces, and the one that unblocks enterprise adoption
> (88% of AI pilots never reach prod because of governance / audit / compliance,
> not code quality).

## Thesis

What the agent asserts ("it works", "no secret", "scope respected") is worth
nothing in review. What **the machine proves** is worth everything. The 7 changes
turn every *advisory* guardrail into an *executed* guardrail, attached to a
**human identity**, aggregated into an **exportable ledger**, and verified **out
of the agent's hands** (clean-room CI). All of it distributed as a **native
plugin** so as not to suffer the re-ship treadmill on every release.

Single guiding principle: *"nothing executed ≠ verified; asserted ≠ proven;
anonymous ≠ auditable"*.

## Non-negotiable constraints (inherited from the project)

- **Zero runtime dependencies.** Everything in `node:*` (`child_process`, `fs`,
  `crypto`). No npm lib added. `git`/`gh` stay *optional* shell-out dependencies
  (clean degradation if absent).
- **Nothing blocks by surprise.** A hard guardrail (the hook) is only active if it
  is explicitly wired into the target project's settings; by default we *flag*, we
  don't break a legitimate repo.
- **Idempotence + `--dry-run` everywhere.** No command has a hidden outward side
  effect (the `ship` pattern).
- **Behavioral tests** in `node:test` on real throwaway git repos (`mktemp -d`),
  we verify the observable (exit codes, files, content), never the reasoning.
  File deletion via `trash`, never `rm`.
- **The evidence is the truth, not the narrative.** Verbatim capture, truncated
  but never reworded.

## Implementation order (dependencies)

```
1. identity  ─┬─> 2. guard (hook)         (hard enforcement)
              ├─> 3. ship attaches the evidence   (depends on 1)
              ├─> 4. ledger (the register)         (depends on 1)
              │        └─> 5. trace (end-to-end)       (depends on 1 + 4)
              ├─> 6. clean-room CI gate           (nearly independent)
              └─> 7. native plugin                (independent, distribution)
```

Each module is **validated (green tests + smoke)** and **committed** before moving
to the next. We cut between two modules if the context is saturated — state is
resumed via the checklist at the end of the doc.

---

## Module 1 — Provenance: git identity on every evidence

**Intent.** Today `verify`/`evidence` produce anonymous JSON. We cannot answer
"who produced this proof, on which commit, in which PR". Without it, no audit, no
offboarding, no compliance (EU AI Act art. 12 "record-keeping", traceability of
AI systems).

**Design.** New read-only module `bin/lib/identity.js`:

```js
// captureIdentity(cwd) -> non-fatal outside git
{
  capturedAt: "2026-07-21T...Z",
  git: {
    commit: "<sha>",          // git rev-parse HEAD
    shortCommit: "<sha7>",
    branch: "<abbrev-ref>",
    author: { name, email }, // git config user.name/email (or log -1)
    dirty: true|false,        // status --porcelain non-empty
    remote: "<origin url>",   // get-url origin (optional)
  },
  pr: { number, url } | null,  // via gh pr view --json (optional, best-effort)
  host: { user, platform },    // os.userInfo().username, process.platform
}
```

- Everything is **best-effort**: outside a git repo → `git: null` + `reason`. `gh`
  absent → `pr: null`. Never fatal: provenance enriches, it does not block.
- Injected into the `harnessVerify` and `harnessEvidence` JSON under a
  `provenance` key. Backward-compatible (key added, nothing removed).

**Files.** `bin/lib/identity.js` (new); `bin/lib/harness.js` (import +
`provenance: captureIdentity(cwd)` in both evidences); `test/identity.test.js`
(new).

**Tests.** temp git repo with `user.name/email` configured → `provenance.git`
populated, `dirty` flips when a file is touched; outside git → `git:null`
non-fatal; `verify --json` now contains `provenance`.

**Payoff for the rest.** Foundation of 3, 4, 5. The ledger aggregates provenance;
the PR displays it; trace follows it. To do **first**: everything else depends on
it.

---

## Module 2 — `ai-flow guard`: the deterministic PreToolUse hook

**Intent.** `harness check` scans *after the fact*. The only non-circumventable
moment to prevent writing a `.env`, committing a secret, or editing out of scope
is **before** the tool writes. Claude Code exposes a **PreToolUse** hook that
receives the tool call on stdin and can **refuse** it (exit 2 / `deny` decision).
This is the move from "advice" to "in-code guardrail" — the single strongest lever
of the whole plan.

**Design.** `ai-flow guard` subcommand (a hook reader, no human UI):

1. Reads the hook JSON on **stdin** (`{ tool_name, tool_input: { file_path,
   content, new_string, ... } }`). Tolerant format: if stdin is empty or
   unreadable → `allow` (fail-open so it never blocks a non-hook use).
2. Only triggers for write tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`).
   Other tools → `allow`.
3. Loads `.coding-flow/harness.json` (via `readHarnessConfig`) and applies **two**
   deterministic checks:
   - **blocked path**: the relative `file_path` matches a `blockedPaths` (reuses
     `matchesPattern`, excludes `isAllowedEnvExample`) → **deny**.
   - **secret in content**: the written content (`content`/`new_string`) matches a
     `getSecretPatterns()` → **deny**.
4. Emits the **decision** in the hook format expected by Claude Code (JSON on
   stdout with `hookSpecificOutput.permissionDecision = "deny"` + `reason`, or
   exit code 2 + stderr message — we handle both paths, the most portable being
   the exit code). `allow` = silent exit 0.
5. `--explain` (human) and `--json` for debug/tests; an input flag `--input
   <file>` to test without going through real stdin.

**Wiring on the target project.** Template `templates/.claude/settings.json` (or
merge into the existing one at `init`) with a `hooks.PreToolUse` block matcher
`Write|Edit|MultiEdit` → `command: "npx @landry_pouth/coding-flow guard"` (or the
detected local binary). `init` **offers** the wiring; it does not impose it if a
`settings.json` already exists (non-destructive merge, otherwise we print the
instruction).

**Files.** `bin/lib/guard.js` (new); export `getSecretPatterns` from `harness.js`
(reuse); `bin/ai-flow.js` (`guard` dispatch); `bin/lib/commands.js` (help);
settings template + wiring in `templates.js`/`init`; `test/guard.test.js`.

**Tests.** deny on `.env`/`**/*.pem`; deny on content with `sk_live_...`; allow on
a normal file; allow if stdin empty (fail-open); allow if non-write tool;
`.env.example` allowed; correct exit code (0 allow / 2 deny).

**Payoff.** It is *the proof* that a secret **cannot** leak, not that we hope it
won't. Enterprise selling point #1 ("secret isolation enforced at the tool
boundary"). Reusable outside coding-flow (any Claude Code project can wire the
guard).

---

## Module 3 — `ship` attaches the evidence to the PR

**Intent.** The human reviewer must see "it passes, proven" without effort. We
inject the summary of the latest `verify` (+ provenance) into the PR body.

**Design.** In `ship.js`, before PR creation/update:

- read the most recent `.coding-flow/runs/*-verify.json` (best-effort);
- build a markdown block delimited by idempotent markers
  `<!-- coding-flow:evidence:start -->` … `:end -->`:
  overall result (✅/❌), command source, `command → exit/duration` list,
  provenance (short commit, author, dirty), timestamp;
- **creation**: pass this block as `--body` (instead of `--fill` alone: we keep
  the derived title but add the body; `--no-evidence` option to disable);
- **existing PR**: `gh pr view --json body`, replace the section between markers
  (or add it), `gh pr edit --body`. We never overwrite the human text outside the
  markers.
- Without `verify` available → note "no evidence: run `ai-flow harness verify`".
- `--dry-run` prints the block without pushing.

**Files.** `bin/lib/ship.js` (read evidence + inject section); `test/ship.test.js`
(extend: block present in the body; idempotence of the replacement;
`--no-evidence`).

**Payoff.** Zero friction: the proof arrives where the decision is made (the PR).
Intent → proof loop closed and visible. Makes module 4 (ledger) "free" on the
human side.

---

## Module 4 — `ai-flow audit`: the exportable ledger (append-only)

**Intent.** The document you show to compliance: "here, timestamped and signed by
identity, is everything that has been verified on this repo". Aggregates the
scattered runs into a durable journal.

**Design.** New `bin/lib/audit.js` + `ai-flow audit` command:

- **Source**: all the `.coding-flow/runs/*-verify.json` and `*-evidence.json`.
- **Append-only ledger**: `.coding-flow/ledger.jsonl` — one JSON line per run,
  never rewritten. Each entry: `{ id (content hash), type, generatedAt, ok,
  story, commandSource, provenance, summary }`. `audit` **appends** the runs not
  yet present (dedup by `id` = `sha256` of the file). Append-only = integrity
  guarantee (we don't erase the history).
- **Human export**: `ai-flow audit --export` writes `docs/AUDIT.md` (chronological
  table: date, type, result, story, commit, author). `--json` outputs the full
  ledger; `--since <iso>` filters.
- **Gate**: `ai-flow audit --check` exits non-zero if the latest run per story is
  failing or missing (usable in CI for "no merge without green evidence").

**Files.** `bin/lib/audit.js` (new); `bin/ai-flow.js` (dispatch); `commands.js`
(help); `test/audit.test.js`.

**Tests.** ledger created and deduplicated (2 passes → no duplicate); append
preserves the old lines; `--export` generates `docs/AUDIT.md` with the columns;
`--check` fails if a run is red; `--since` filters.

**Payoff.** Turns scattered JSON into a **compliance artifact**. It is the
"billable" brick (governance layer) without taking anything away from the
open-core.

---

## Module 5 — `ai-flow trace`: the story ↔ commit ↔ PR ↔ evidence ↔ test chain

**Intent.** Prove the complete chain: this story produced these commits, in this
PR, whose green evidence cites these tests. A one-shot answer to "show me that
this requirement is actually delivered and verified".

**Design.** New `bin/lib/trace.js` + `ai-flow trace [--story <dir>] [--json]`:

- **story → tests**: parse the `criterion -> file::test` traceability table of
  `tests.md` (already generated by blueprint-tests) + the `## Commands` block.
- **story → commits**: `git log` filtered on the story directory (`-- <storyDir>`)
  and/or on the linked branch name (reuses the stateless worktree↔story mapping
  from `status`).
- **story → PR**: `gh pr view <branch>` (best-effort).
- **story → evidence**: latest ledger run whose `story` matches.
- **Output**: a readable tree (text) + structured JSON; flags the **missing
  links** (no evidence, no test for a criterion, commits without a PR).

**Files.** `bin/lib/trace.js` (new); reuses `identity`, `audit`,
`parseTestsCommands`, the traceability table; `bin/ai-flow.js` + `commands.js`;
`test/trace.test.js`.

**Tests.** temp repo with a story (tests.md + traceability), a commit touching the
directory, an evidence run → `trace` links the 4; missing link flagged (criterion
without a test, story without evidence).

**Payoff.** The "audit of a requirement" in a single command. Strong
differentiator vs Spec Kit / BMAD (they specify, they don't **prove** delivery).

---

## Module 6 — clean-room CI gate + diff-coverage floor

**Intent.** The only non-gameable signal: replay `verify` on a fresh checkout, out
of the agent's hands (free GitHub compute, Claude budget preserved). + require the
**changed code** to be covered (diff-coverage), not the inflatable global
coverage.

**Design.** Workflow template scaffolded in the **target** project (not
coding-flow's own CI) via `ai-flow ci init` (or an `init --with-ci` step):

- `templates/.github/workflows/coding-flow-verify.yml`: clean checkout →
  `npx @landry_pouth/coding-flow harness verify` → `harness audit --check` →
  upload the `.coding-flow/runs/*` as an artifact. Configurable non-blocking job.
- **Diff-coverage**: optional, enabled if a coverage report exists; compares
  against the diff lines (`git diff --name-only origin/base...HEAD`). V1: simple
  documented floor; the tool provides the hook, not a home-made coverage runner
  (out of scope, cf. testability.md).
- `ai-flow ci init` copies the template, non-destructive, `--dry-run`.

**Files.** `templates/.github/workflows/coding-flow-verify.yml` (new);
`bin/lib/ci.js` (new, scaffolder); dispatch + help; `test/ci.test.js` (the
scaffold writes the file, idempotent, `--dry-run` writes nothing).

**Payoff.** The heavy gate carried by the CI (free) instead of re-spending Claude
tokens: trust ↑, budget ↓. "Reproducible proof on a neutral machine" = the
argument that moves a pilot to prod.

---

## Module 7 — Distribution: native Claude Code plugin + marketplace

**Intent.** Don't suffer the "re-ship the skills on every release" treadmill.
Native plugins + marketplaces (2026) are the distribution channel; coding-flow
must install into it in one command and update itself.

**Design.**
- `.claude-plugin/plugin.json`: manifest (name, version, description, author,
  exposed commands/skills, homepage). Pointing to `templates/.claude/skills` and
  the CLI commands.
- **Marketplace** manifest (`marketplace.json` or a dedicated repo) listing the
  plugin, for `/plugin marketplace add LandryPouth/codin-flow`.
- Plugin install doc in the README; the npm version stays (the two channels
  coexist: npm for the CLI/CI, plugin for the IDE).
- Verify conformance to the current plugin schema via `ctx7`/Claude Code docs
  before freezing the keys.

**Files.** `.claude-plugin/plugin.json` (new); `marketplace.json` (new); README
"Install as a plugin" section; possible `test/plugin.test.js` (the manifest is
valid JSON, versions synced with package.json).

**Payoff.** Frictionless adoption + continuous updates without manual re-ship.
Discovery channel (marketplace) = near-free distribution.

---

## After the 7 modules

- **README + internal docs** up to date (each module updates the CLI table, the
  matching section, and its entry in the `docs/` index).
- **Test suite**: target +30 tests (~86 total), all green on node 18/20/22.
- **Version**: bump `package.json` (0.1.0 → 0.2.0, additive changes but broader
  CLI surface) + release note.
- **npm publication** `@landry_pouth/coding-flow` (auth to finalize on the user
  side: `npm login --auth-type=legacy` or `_authToken` token).

## Resume checklist (living state)

- [x] M1 identity — module + provenance in verify/evidence + green tests + commit
- [x] M2 guard — hook + settings merge + init wiring + tests + commit
- [x] M3 ship evidence — idempotent PR injection + tests + commit
- [x] M4 audit ledger — append-only + export + --check + tests + commit
- [x] M5 trace — story↔commit↔PR↔evidence↔test chain + tests + commit
- [x] M6 clean-room CI — workflow template + scaffolder + tests + commit
- [x] M7 plugin — manifest + marketplace + README + commit
- [x] Final docs/README + version bump (0.2.0)
- [ ] npm publication (blocked on the user's npm auth)

> Resume rule: never start a module without the previous one being **green +
> committed**. If the context saturates, stop on a committed module and let the
> checklist indicate the resume point.
