---
name: flow-recover
description: Assess an existing codebase you built fast (often with an agent) and left for months — before launch, tell me what is wrong, insecure or risky. Runs a read-only scan (hotspots, test gaps, secrets in the tree and history, sensitive files), then completes per-dimension inventories into docs/recovery/map.md and findings.md, with every finding suspected, confirmed by a path:line trace, refuted, mitigated, accepted or a tool false-positive. Also the learn mode: walk me through a flow in code I didn't write, help me understand how it works, and own it by pinning that flow with a characterization test. Use when the request is about the whole repository's current risk or owning its existing flows, not a change to review and not planning the next feature.
---

# Recover

## Overview

Recovery is **finding-shaped**, not story-shaped: existing code becomes a ranked list
of what is wrong, each item proven, refuted, mitigated, accepted or left
`not examined`. Assess is the default mode. It never modifies application code and
never sends a request to a deployed system. Run it any time on an existing
repository.

## Command

```bash
ai-flow recover scan --json
```

> If bare `ai-flow` is not on `PATH`, use
> `npx @landry_pouth/coding-flow recover scan --json`.

`--history-limit N` sets the commits read for history secrets (default 2 000). The
scan reports, never judges, exits 0 and writes no file: run it first and keep its
JSON as the raw evidence.

## Assess

### 1. Capture the deterministic half

Read all of the scan, not only its first section:

- **hotspots** — top 15, each with whether a test sits next to it or imports its
  basename. Ranked by churn × CRAP (the file's worst function, a heuristic) when a
  fresh lcov report exists, else by churn × size; the heading says which. Run the
  suite with lcov output first to get CRAP. A source file no test loaded gets an
  estimated CRAP (an upper bound); tests and languages the lcov does not cover get
  none and come last;
- **test map** — test files per top-level code directory, and the directories with
  code and no test;
- **secrets in the tree** — heuristic, allowlist applied; command substitutions and
  environment references are not credentials;
- **secrets in history** — exact key formats only: pattern, path, first commit,
  count. The value itself never appears in the output or the dossier;
- **tracked sensitive files** and **large files**.

A shallow clone's churn is **unavailable** — never zero; `commitsScanned` says how
many commits the history section covered. When `git.available` is false, hotspots,
the test map, tree and history secrets, sensitive and large files were **not
examined**: write them `not examined`, never "none" or "clean". A non-empty
`secrets.invalid` means a configured detector did not compile and scanned nothing:
report it as a tool defect, and do not count what it should have covered as
examined.

### 2. Decide where the dossier can live

```bash
gh repo view --json visibility
```

No `gh`, or no answer: **ask the user**. On a public or unknown-visibility
repository, open security findings are never committed: their full trace goes in
`.coding-flow/recovery/findings.local.md`, the tracked `findings.md` keeps only ID,
title and state, and you add `.coding-flow/recovery/` to `.gitignore` if it is not
there.

### 3. Complete the inventories

The scan says **where to look**; the inventory says **what to read**. One dimension
at a time, every row ending in a state. Stack hints say where a pattern usually
lives; they never decide the conclusion.

| Dimension | Inventories |
| --- | --- |
| **Security** | routes (method, path, authentication, authorization); routes taking an id → ownership in the query — a query filtering only on that id, with no owner/tenant predicate, is `confirmed` as an IDOR when any authenticated caller can reach it; a missing schema does not downgrade it, the missing check is the finding; outbound calls with a caller-controlled URL (SSRF); caller-controlled code, command, template or query execution; raw SQL built from strings; uploads (type, size, path); inbound webhooks (signature verified, replay); secret fallbacks and defaults — if the fallback is unreachable in the deploy configuration, the row is `mitigated` by deploy config, and a missing required variable is a separate finding; CORS and cookie flags; secrets in tree **and history**; dependency audit. |
| **Data** | destructive migrations; invariants enforced only in code that need a constraint (unique, FK, not null); tenant scoping of every query on a multi-user table; backup and restore. A SQL read is security evidence, not a Data inventory: with no migrations, schema, constraints or backup/restore configuration in the tree, write Data **not examined** and say what is missing. |
| **Reliability** | idempotency of webhooks, payments and retries; multi-write operations without a transaction; background jobs after a crash mid-job. A queue class alone is not an inventory: with no worker, queue configuration, retry policy, transaction or crash story to examine, write Reliability **not examined**. |
| **Architecture** | hotspots (churn × size × coverage); cycles; business rules in UI; two implementations of one concept; each epic `index.md` `## Boundaries` line — a forbidden dependency the code takes is `confirmed`, an epic that added a module with no section (or no `approved by:`) is a finding. |
| **Operations** | health checks; logs that print bodies, tokens or personal data; reproducible deploy; rollback path. |
| **Comprehension** | dead or broken features; unused dependencies; docs that contradict the code. |

A dimension with no rows is **not examined**, with the reason — never "fine".

### 4. Write the dossier

In `docs/recovery/` (plus `.coding-flow/recovery/findings.local.md` when the
repository is public):

**`map.md`** — entry points, trust boundaries, data stores, external calls and
critical flows, each with a `path:line`. A map to decide with, not documentation of
every file.

**`findings.md`** — one block per finding:

```md
### R-01 — Short title

- State: confirmed
- Dimension: security
- Severity: high impact × reachable from any authenticated user
- Location: src/scripts/repository.js:4
- Trace: server.js:15 → src/scripts/service.js:5 → src/scripts/repository.js:4
- Next: add an owner filter and a test that fails without it
```

The field lines are fixed: `- State:`, `- Dimension:`, `- Severity:`,
`- Location:`, `- Trace:`, `- Next:`. An accepted finding adds `- Revisit:` (`YYYY-MM-DD`); a
fixed one adds `- Fixed by:` (the green verify run). Order by severity ×
reachability: exploitable security and data loss first, then what blocks the next
feature, then the rest. End with the dimension table:

```md
## Dimensions

| Dimension | Status | Reason |
| --- | --- | --- |
| Security | examined | routes, ownership, outbound calls, secrets |
| Data | not examined | no migrations or schema in this repository |
```

The status is **examined**, **tool-checked** or **not examined**. **tool-checked**
is read, never asserted: `securityTools.declared` lists the scanners in
`validation.security`, but only an `outcome` of `pass` or `fail` in the latest
verify evidence (`.coding-flow/runs/*-verify.json`, `results[]` with
`kind: "security"`) checked anything. `not-examined` (missing binary, timeout, no
network), or a scanner verify never ran, checked nothing. A recipe under
`securityTools.undeclared` applies but is not declared: say so in Reason and suggest
it — the scan never writes config.

### States

| State | Meaning |
| --- | --- |
| `suspected` | A pattern matched or a row looks wrong; no trace yet. |
| `confirmed` | A written `path:line` chain from input to effect. Reading-level proof is the ceiling of assess. |
| `refuted` | The trace shows the concern does not hold (a broken feature, a dead path). |
| `mitigated` | Safe because of something specific — code or deploy config, and where. |
| `accepted` | A reason, an owner and a `Revisit:` date. Without a date it is forgotten, not accepted. |
| `false-positive` | A Coding Flow tool bug: name the tool, never drop it silently (a command substitution reported as a credential is one). |
| `not examined` | No evidence was gathered. Never "secure". |

### Never

- Modify application code in assess.
- Say "secure", "production-ready" or "no issues".
- Send a request to a deployed system, staging, production or a cloud metadata
  endpoint.
- Raise a state without a `path:line` trace: a severity label alone stays
  `suspected`.
- Report a tool that could not run as a pass: `npm audit` offline is **not
  examined**.
- Turn "the required env var is missing" into the secret-fallback finding: a
  non-production fallback made unreachable by `NODE_ENV=production` is `mitigated`.
- Invent a false-positive the scan did not report. If the pattern is absent from
  the raw output, the check ran clean: say so and move on.

## Learn

The ownership mode: the developer leaves owning one flow they did not write (or no
longer remember). One flow per session; stop when it is pinned. No score, no quiz.

1. **Pick** one critical flow from `docs/recovery/map.md` (no map yet: run assess,
   or name the entry point by `path:line`).
2. **Predict.** Before any trace, the developer writes what they think it does:
   inputs, effects (writes, calls, responses), failure cases. A prediction made
   after reading the answer teaches nothing.
3. **Trace** the real path from the entry point, every step a `path:line`, to each
   effect and each failure exit.
4. **Compare** prediction and trace, gap by gap. A gap that is a defect becomes a
   finding in `findings.md`, not a fix in this session.
5. **Pin** what the flow does **today** with a characterization test, through its
   entry point or the narrowest seam the trace showed, in the project's own runner.
   **The developer writes or approves every assertion; never invent an expected
   value you did not observe** in the trace or a run. A pinned bug is pinned as it
   is, with a comment naming its finding. Check the test is among those the runner
   ran — a skipped file pins nothing — then `ai-flow verify`. Keep helpers and
   fixtures inside `testGlobs` (outside, they count as behavior) and add no
   `.skip` / `.only` (they read as weakening).
6. **Record** the flow in `docs/recovery/ownership.md`:

```md
### Test a function from the editor

- Pinned by: spec/test-function.spec.js
- Entry: server.js:25
- Unknown: what the runtime does with a valid run UUID (no caller sends one)

## Unknown flows

- Webhook test (`server.js:20`) — not traced yet
```

`- Pinned by:` is a test path that exists, `- Entry:` a `path:line`, and zero or
more `- Unknown:` lines hold what the trace could not settle. A flow of `map.md`
with no block goes under `## Unknown flows`; without `- Pinned by:` it is not owned.
No command reads this file: check by eye that each path exists and each entry
resolves. A pinned flow is what makes its later refactor provable — land the pin
first.

## Fix mode

One finding per branch. Write the test that demonstrates the finding and see it
fail; then fix. Commit both and run a story-less `ai-flow verify --red-at-base`:
green only when the test failed at the merge base and passes at HEAD. Declare
`redAtBase.command` in `.coding-flow/harness.json` as `node --test
--test-reporter=tap {files}` (only node's runner is read); on another runner, a
plain `ai-flow verify` proves the suite, not the red. When it is green, set
`State: fixed` and add `- Fixed by: <run file>` (the bare `2026-…-verify.json` name
under `.coding-flow/runs/`): `status` then calls the fix **proven**; without it, or
when another finding names the same run, it stays **claimed**. A red verify leaves
the block open. A security finding gets `/flow-review` with Security Deep before
ship. A finding too large for one change goes to `/flow-plan` as an epic.

## Refactor mode — behavior preserved, and checked

One structural change per branch, no behavior change: a bug found while
refactoring becomes its own finding and its own fix.

1. **Pin first, and land it first.** A flow with no characterization test gets one,
   green, on its own branch merged before the refactor starts — the claim reads the
   whole branch since its fork point, so an earlier test edit on the same branch
   still counts, and a `--base` or fork point that narrows past it fails.
2. **Refactor with the tests untouched** — not even a renamed variable; that goes on
   the test-only branch. New test files are allowed. Only code, prose and type
   declarations move: a policy file (`.coding-flow/*.json`, lint or coverage
   config), a runner or setup file (`.mocharc.js`, `karma.conf.js`, `conftest.py`,
   `setupTests.js`), build config, a lockfile or generated output fails the claim,
   and `## Commands` keep every command they had at the base.
3. **Prove it**: story-less `ai-flow verify --claim refactor`, or `## Claim: refactor`
   in the story and `ai-flow verify --story <path>`. It holds only when no existing
   test file changed, no weakening signal fired, the commands passed, and a fresh
   coverage report shows the added lines run at `minPatchCoverage` (default 80 %) —
   without a report it is **NOT PROVEN**. Read these limits by eye: a test helper
   outside `testGlobs` and the runner list counts as code, and so do tests inside a
   code file (Rust `mod tests`, doctests, in-source tests); a `.md` outside the test
   tree counts as prose, even one that is the product (a prompt); a
   git-ignored new test is not seen; a file whose lines were only deleted is not
   measured; a new test stubbing the moved module for the others is not detected; a
   new test naming `lcov.info`, or with a conditional skip, fails or reads as
   weakening (put it on the test-only branch). A pure dead-code removal has nothing
   to execute: a plain `ai-flow verify`. On the default branch, pass `--base <ref>`.
4. **A violated claim is split, not argued with**: move the test or config change to
   its own branch, land it, rerun the claim.

An extraction names what it removes (duplication, a cycle, a size). No new
abstraction with one use.

## Verification

- [ ] `ai-flow recover scan --json` ran; its JSON is kept, not paraphrased.
- [ ] Every cited `path:line` resolves in the current tree.
- [ ] Every finding has one of the states above; every `confirmed` has a trace of
      `path:line` steps.
- [ ] Every dimension is examined / tool-checked / not examined, and a tool that
      could not run is `not examined`.
- [ ] `docs/recovery/map.md` and `findings.md` exist; on a public or
      unknown-visibility repository, no open security trace is in the tracked file.
- [ ] No application file changed, and no request reached a deployed system.
- [ ] A refactor ran under `--claim refactor` (or `## Claim: refactor`), with no
      existing test file among its changes.
- [ ] A learned flow has a green `- Pinned by:` test, every expected value observed,
      none invented.
- [ ] The output contains no "secure", "production-ready" or "no issues".

## Output

The dossier path, the findings by severity × reachability, the dimension table, and
the scan's raw facts behind them (hotspots, test gaps, secret counts). Say what was
not examined. Time and token cost belong in the report when the run is being
measured.
