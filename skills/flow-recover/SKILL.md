---
name: flow-recover
description: Assess an existing codebase you built fast (often with an agent) and left for months — before launch, tell me what is wrong, insecure or risky. Runs a read-only scan (hotspots, test gaps, secrets in the tree and history, sensitive files), then completes per-dimension inventories into docs/recovery/map.md and findings.md, with every finding suspected, confirmed by a path:line trace, refuted, mitigated, accepted or a tool false-positive. Use when the request is about the whole repository's current risk, not a change to review and not planning the next feature.
---

# Recover

## Overview

Recovery is **finding-shaped**, not story-shaped: existing code becomes a ranked
list of what is wrong, each item proven, refuted, mitigated, accepted or left
`not examined`. Assess is the default mode and the only one this version needs
to get right. It never modifies application code and never sends a request to a
deployed system.

This is not a workflow stage — run it any time on a repository that already
exists.

## Command

```bash
ai-flow recover scan --json
```

> If bare `ai-flow` is not on `PATH`, use
> `npx @landry_pouth/coding-flow recover scan --json`.

Useful flags:

- `--json` — machine-readable output; keep it as the raw evidence for the assess.
- `--history-limit N` — commits to read in the secret history (default 2 000).

The scan reports; it does not judge. It exits 0 whatever it finds. It writes no
file, so run it before anything else and keep its JSON.

## Assess

### 1. Capture the deterministic half

Run the scan and read all of it, not only the first section. It gives:

- **hotspots** — size × churn, top 15, each with whether a test sits next to it
  or imports its basename;
- **test map** — test files per top-level code directory and the directories
  with code and no test;
- **secrets in the tree** — heuristic allowlist applied; command substitutions
  and environment references are not credentials;
- **secrets in history** — exact key formats only, with pattern name, path,
  first commit and count. The matched value never appears in the scan output or
  the dossier: the patch text is streamed from a private temp file that is
  removed on return, throw and exit, and the next scan clears one a hard kill
  left behind;
- **tracked sensitive files** and **large files**.

A shallow clone's churn is **unavailable** — one snapshot is size, not
churn, never zero. Its history section still covers the commits the clone
has; `commitsScanned` shows how many.

When `git.available` is false (no git, or the directory is not a repository),
the scan could not list tracked files: hotspots, the test map, tree secrets,
tracked sensitive files and large files were **not examined**. Write those
dimensions `not examined` — never as "none" or "clean". The text report and
`secrets.tree.available` say so; `secrets.history` says `not examined` too.

If `secrets.invalid` is non-empty (the text names each one), a configured
detector did not compile and scanned **nothing**. Treat it as a tool defect,
not as an empty result: report the detector and do not count that dimension as
examined by the broken pattern.

### 2. Decide where the dossier can live

Check repository visibility:

```bash
gh repo view --json visibility
```

If `gh` is absent or the answer is unknown, **ask the user**. For a public
repository, or one whose visibility is unknown, open security findings must not
be committed: put their full trace in `.coding-flow/recovery/findings.local.md`
and keep only the ID, title and state in the tracked `findings.md`. Ensure
`.coding-flow/recovery/` is in `.gitignore`.

### 3. Complete the inventories

The scan says **where to look**; the inventory says **what to read**. Complete
one dimension at a time and end every row in a state. Stack hints tell you where
the pattern usually lives; they never decide the conclusion.

| Dimension | Inventories |
| --- | --- |
| **Security** | routes (method, path, authentication, authorization); routes taking an id → ownership in the query — a query filtering only on that id, with no owner/tenant predicate, is `confirmed` as an IDOR when any authenticated caller can reach it; a missing schema does not downgrade it, the missing check is the finding; outbound calls with a caller-controlled URL (SSRF); caller-controlled code, command, template or query execution; raw SQL built from strings; uploads (type, size, path); inbound webhooks (signature verified, replay); secret fallbacks and defaults — if the fallback is unreachable in the deploy configuration, the row is `mitigated` by deploy config, and a missing required variable is a separate finding; CORS and cookie flags; secrets in tree **and history**; dependency audit. |
| **Data** | destructive migrations; invariants enforced only in code that need a constraint (unique, FK, not null); tenant scoping of every query on a multi-user table; backup and restore. A SQL read is security evidence, not a Data inventory: with no migrations, schema, constraints or backup/restore configuration in the tree, write Data **not examined** and say what is missing. |
| **Reliability** | idempotency of webhooks, payments and retries; multi-write operations without a transaction; background jobs: what happens after a crash mid-job. A queue class in the tree is not a reliability inventory: with no worker, queue configuration, retry policy, transaction or crash/restart story to examine, write Reliability **not examined**. |
| **Architecture** | hotspots (churn × size × coverage); cycles; business rules in UI; two implementations of one concept. |
| **Operations** | health checks; logs that print bodies, tokens or personal data; reproducible deploy; rollback path. |
| **Comprehension** | dead or broken features; unused dependencies; docs that contradict the code. |

Every row ends in a state. A dimension with no rows is written **not examined**
with the reason — never as "fine".

### 4. Write the dossier

Create `docs/recovery/` with these two files (plus `findings.local.md` when the
repository is public).

**`map.md`** — entry points, trust boundaries, data stores, external calls and
critical flows, each with a `path:line`. Short: a map to decide with, not
documentation of every file.

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

Field lines are fixed: `- State:`, `- Dimension:`, `- Severity:`,
`- Location:`, `- Trace:`, `- Next:`. An accepted finding also carries
`- Revisit:` (`YYYY-MM-DD`); a fixed one carries `- Fixed by:` naming the green
verify run. Group order is severity × reachability:
exploitable security and data loss first, then what blocks the next feature,
then the rest.

End `findings.md` with the dimension table:

```md
## Dimensions

| Dimension | Status | Reason |
| --- | --- | --- |
| Security | examined | routes, ownership, outbound calls, secrets |
| Data | not examined | no migrations or schema in this repository |
```

The status is one of **examined**, **tool-checked** or **not examined**.

### States

| State | Meaning |
| --- | --- |
| `suspected` | A pattern matched or an inventory row looks wrong; no trace yet. |
| `confirmed` | A written `path:line` chain from input to effect. Reading-level proof is the ceiling of assess. |
| `refuted` | The trace that shows the concern does not hold (a broken feature, a dead path). |
| `mitigated` | Safe because of something specific — say whether it is code or deploy config, and where. |
| `accepted` | A reason, an owner and a `Revisit:` date. Without a date it is not accepted, it is forgotten. |
| `false-positive` | A Coding Flow tool bug. Say so and name the tool; do not silently drop it. A command substitution reported as a credential is one. If the current scan no longer reports it, record that the check ran and found nothing — do not invent the finding. |
| `not examined` | No evidence was gathered. Never write it as "secure". |

### Never

- Modify application code in assess.
- Say "secure", "production-ready" or "no issues".
- Send a request to a deployed system, staging, production or a cloud metadata
  endpoint.
- Raise a finding's state without a `path:line` trace. A severity label without a
  trace stays `suspected`.
- Report a tool that could not run as a pass. `npm audit` offline is
  **not examined**.
- Turn "the required env var is missing" into the secret-fallback finding. Read
  the fallback against the deploy config: a non-production fallback made
  unreachable by `NODE_ENV=production` is `mitigated`, not a live bypass.
- Invent a false-positive the scan did not report. If the pattern is absent from
  the raw output, say the check was run and clean, and move on.

## Fix mode (minimal for now)

Fix one finding per branch, never several. Write the test that demonstrates the
finding first and run it to see it fail; then fix; then run a story-less
`ai-flow verify`. When that verify is green, set the block to `State: fixed` and
add `- Fixed by: <the run file name>` (the `2026-…-verify.json` under
`.coding-flow/runs/`). `status` follows that link and calls the fix **proven**;
a `State: fixed` without it stays **claimed**. A red verify leaves the block
open. A security finding gets `/flow-review` with Security Deep before ship.
Red-at-base proof and refactor claims arrive with later stories; until then this
is a claim, not stronger than one.

A finding too large for one change is handed to `/flow-plan` as an epic. Recovery
does not grow a planner.

## Verification

- [ ] `ai-flow recover scan --json` actually ran; its JSON is conserved, not
      paraphrased.
- [ ] Every cited `path:line` resolves in the current tree.
- [ ] Every finding is in one of the states above; every `confirmed` has a trace
      with each step a `path:line`.
- [ ] Every dimension ends in examined / tool-checked / not examined, and a
      tool that could not run is `not examined`.
- [ ] `docs/recovery/map.md` and `docs/recovery/findings.md` exist. On a public
      or unknown-visibility repository, no open security trace is in the
      tracked file.
- [ ] No application file changed, and no request reached a deployed system.
- [ ] The output contains no "secure", "production-ready" or "no issues".

## Output

Report the dossier path, the findings ordered by severity × reachability, the
dimension table, and the scan's raw facts (hotspots, test gaps, secret counts)
that drove them. Say what was not examined. Time and token cost belong in the
report when the run is being measured.
