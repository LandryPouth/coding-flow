# Codebase recovery — `/flow-recover`

**Status: designed 2026-10-18, planned as epic 14 (after epic 13).** Inputs: a
proposal from another model (a `/flow-refac` skill with ASSESS / LEARN /
EXECUTE modes), the Uncle Bob study (`docs/plans/uncle-bob-gauntlet.md`,
re-measured the same day), and a read-only field test on a real MVP. Every
number below is measured on this checkout or on that MVP; nothing is taken
from the proposal without one of the two.

## The problem, stated against the tool's own limit

Every gate Coding Flow has is **scoped to a diff**: the guard judges one write,
`verify` judges the branch's diff, the coverage gate the lines it added, the
review the change before merge. That is by design, and it is right for work in
progress.

The developer this design serves built an MVP with an agent in two weeks and
comes back to it months later to make it a product. Their risk is in code that
**no future diff will touch**: an ownership check that was never written, an
endpoint left from a demo, a 2 700-line file nobody understands. Coding Flow
today has nothing to say about any of it. That is the premise of this design,
and the reason it is a separate skill rather than a section of `/flow-plan` or
`/flow-run`: those two are story-shaped (an intent becomes a change); recovery
is **finding-shaped** (existing code becomes a ranked list of what is wrong,
each item proven, fixed, accepted or refuted).

## Field test — `tradescript`, read only, 2026-10-18

`~/dev/saas/tradescript`: 162 commits from 2026-05-03 to 2026-06-11, then
untouched for four months. Node/TypeScript (Fastify API, Next.js web) and Go
services, about 20 000 lines across 146 code files, 19 test files, 30 of 162
commits fix-like. Deployed on AWS ECS (`scripts/aws/`). Exactly the profile.

About one hour of probing, nothing written in the repository: a zero-dependency
probe script reusing `security-policy.js` (tracked secrets in tree and history,
sensitive paths, churn × size hotspots, test map), then targeted reading driven
by an inventory, not by file order.

| Finding | Found by | State | Would a current gate see it? |
|---|---|---|---|
| `GET /scripts/:id` returns **any user's script**: the route checks the JWT but `getScript(id)` → `findScriptById` is `SELECT * FROM public.scripts WHERE id = $1` with no owner (`apps/product-api/src/modules/scripts/routes.ts:53`, `service.ts:14`, `repository.ts:95`). `GET /:id/versions` has the same shape. | inventory: routes with an id parameter → ownership trace | **confirmed by reading** | No — no diff touches it |
| `POST /scripts/test-webhook` fetches **any URL** with caller-chosen headers and returns status and body (`service.ts:64`). On ECS the task metadata and credentials endpoint is normally reachable from the container: SSRF towards cloud credentials. | inventory: outbound calls with a caller-controlled URL | **confirmed by reading** | No |
| `POST /scripts/test-function` sends caller code to the runtime binary with `evaluate`; `cmd/runtime/main.go:40` parses the argument as a run UUID and exits. No code is executed. | inventory: caller-controlled code execution | **refuted** — but a broken feature, and a trap for whoever "fixes" it | — |
| `AUTH_SECRET` falls back to a hard-coded development secret outside production (`config.ts:3`, `:23`); `Dockerfile.product-api` and the ECS task definitions set `NODE_ENV=production`. | inventory: config fallbacks for secrets | **mitigated — by deploy config, not by code** | No |
| `/dev/signal*` echo routes are registered unconditionally (`server.ts:63`) and log request bodies. | route inventory | confirmed, low | No |
| `yaegi` is a dependency in `go.mod` and imported nowhere. | grep | confirmed, trivial | — |
| `services/strategy-runtime/internal/engine/runner.go`: 2 713 lines, highest churn in the repository (4 466 lines changed), no test. None of the 19 test files touches auth or ownership. | churn × size, test map | measured | — |
| `password="$(aws secretsmanager get-random-password …)"` reported as a credential (`scripts/aws/lot1-2-rds.sh:55`). | Coding Flow's own "Long assigned credential" heuristic | **false positive — a Coding Flow bug** (story 13-02) | — |
| Vulnerable dependencies | `npm audit` | **not examined** — timed out with no network | — |

What the hour taught, and what the design takes from it:

1. **The two serious findings came from an inventory, not from reading.**
   Routes → which ones take an id → does the query filter by owner; outbound
   calls → is the URL caller-controlled; code execution → is the input
   caller-controlled. An inventory is a checklist a skill can carry and an
   agent can complete systematically; "review the codebase" is not.
2. **Six states appeared in one hour**: suspected, confirmed, refuted,
   mitigated, false positive, not examined. A report without them says either
   "three critical vulnerabilities" (wrong: one was refuted, one mitigated) or
   "looks fine" (wrong). The states are the product, the same way coverage
   rungs are.
3. **Deterministic tools and reading found disjoint things.** The probe found
   the hotspot, the test gap and Coding Flow's own false positive; reading
   found the vulnerabilities. Neither replaces the other.
4. **"The tests pass" said nothing.** 19 green test files, none on the trust
   boundary.
5. **A tool that is not available is not a clean result.** `npm audit` with no
   network would have printed nothing useful; the honest line is "not
   examined".

## What exists and is reused, not rebuilt

| Need | Already in Coding Flow |
|---|---|
| A first map of an existing repository | `ai-flow bootstrap --scan --json` and `/flow-plan` Brownfield Bootstrap (directories, scripts, dependencies, multi-ecosystem) |
| Proof that a change was tested | `ai-flow verify` — **with no story** since 12-01: coverage gate and diff risk on the branch's own diff |
| Strictness from risk | `risk.js` scores the diff; auth, payments, migrations, webhooks are `high` by path |
| Secrets and sensitive files | `security-policy.js` (patterns, allowlist, blocked and sensitive paths) |
| Added lines executed by the suite | `coverage.js` lcov / Istanbul parsing, diff-lines mode in `coverage-gate.js` |
| Review with security depth | `/flow-review` Deep sections, review evidence, independent reviewer for STRICT |
| A ledger | `.coding-flow/runs/`, `ai-flow audit` |

So recovery adds **no test engine, no security scanner, no orchestrator**. It
adds a method (inventories and states), a dossier, and three deterministic
checks the method cannot be trusted without.

## Design

### One skill, four modes

`/flow-recover` — one entry in the front door, four sections loaded on demand
(the same shape as `/flow-run`'s opt-in sections):

| Mode | Writes code? | Produces | Proof the core checks |
|---|---|---|---|
| **assess** (default) | never | the dossier: `map.md`, `findings.md` | the scan JSON is captured; every `path:line` cited resolves (14-02) |
| **learn** | tests only | `ownership.md`; characterization tests | the tests are test strengthening in `verify` (exists) |
| **fix** | yes — behavior changes | one finding fixed on one branch | **red at base**: the new test fails on the base tree and passes on HEAD (14-03) |
| **refactor** | yes — behavior preserved | one structural change | **behavior-preserving claim**: no test modified or weakened, suite green, added lines executed (14-04) |

Fix and refactor are separate because their proofs are opposite. A fix is
proven by a test that **was red and is now green**. A refactor is proven by
tests that **did not change and stayed green** while the code moved. Mixing
them in one change is exactly how a refactor silently changes behavior: the
skill refuses it and splits the change (a bug found while refactoring becomes
its own finding).

### The dossier

`docs/recovery/` in the user's project:

- **`map.md`** — entry points, trust boundaries, data stores, external calls,
  critical flows, each with a `path:line`. A map to decide with, not
  documentation of every file. Kept short; refreshed when a fix or refactor
  changes a boundary.
- **`findings.md`** — one block per finding: `R-NN`, title, dimension,
  severity, state, location(s), the trace (how it was confirmed, refuted or
  mitigated), and the next action. Machine-readable headings, like stories'
  acceptance criteria, so `status` can read it.
- **`ownership.md`** — the flows the developer has traced and pinned with a
  test, and the ones still unknown. The honest answer to "do I own this
  code?".

**Open security findings are never committed to a public repository.** A
`findings.md` naming an unfixed IDOR in a public repository is a published
exploit. Before writing, the skill checks visibility (`gh repo view --json
visibility` when `gh` is present; otherwise it asks); for a public repository,
or when visibility is unknown, open findings whose dimension is security go to
`.coding-flow/recovery/findings.local.md`, which is git-ignored, and only
their ID and state appear in the tracked file until fixed.

### Finding states — the evidence ladder

```text
suspected ──► confirmed ──► reproduced ──► fixed
    │             │
    ├──► refuted  ├──► mitigated (by what, and where: code or deploy config)
    │             └──► accepted  (reason, owner, revisit date)
    └──► false-positive (tool bug: report it)
```

- **suspected** — a pattern matched or an inventory row looks wrong.
- **confirmed** — a written trace from input to effect, each step a
  `path:line`. Reading-level proof; the default ceiling of assess.
- **reproduced** — a test in the repository fails on the current code because
  of the finding.
- **fixed** — that test passes and a `verify` run is linked. **Only the tool
  derives `fixed`**: `ai-flow status` reads it from a recorded verify whose
  red-at-base check passed (14-02, 14-03), the same way a story is never
  "done" on the agent's word.
- **mitigated** distinguishes "mitigated in code" from "mitigated by
  configuration elsewhere": the tradescript JWT fallback is safe only as long
  as every deployment sets `NODE_ENV`; that is still worth a test or a
  fail-closed default.
- **accepted** without a revisit date is refused: known debt with a date is a
  decision, without one it is forgetting.

And per **dimension**, not per finding: **examined / tool-checked / not
examined**. The assess output ends with that table; nothing in it may say
"secure" or "production-ready" (see Refused).

### The inventories (assess)

Each dimension is a list of inventories to complete, each row ending in a
state. The checklist lives in the skill; a stack-specific hint (Fastify
`addHook('onRequest')`, Express middleware, Next.js route handlers, Django
decorators) tells the agent where to look, never what to conclude.

| Dimension | Inventories |
|---|---|
| **Security** | routes (method, path, authentication, authorization); routes taking an id → ownership in the query; outbound calls with a caller-controlled URL (SSRF); caller-controlled code, command, template or query execution; raw SQL built from strings; uploads (type, size, path); inbound webhooks (signature verified, replay); secret fallbacks and defaults; CORS and cookie flags; secrets in tree **and history**; dependency audit |
| **Data** | destructive migrations; invariants enforced only in code that need a constraint (unique, FK, not null); tenant scoping of every query on a multi-user table; backup and restore — `not examined` unless there is evidence |
| **Reliability** | idempotency of webhooks, payments and retries; multi-write operations without a transaction; background jobs: what happens after a crash mid-job |
| **Architecture** | hotspots (churn × size × coverage, 14-07); cycles; business rules in UI; two implementations of one concept |
| **Operations** | health checks; logs that print bodies, tokens or personal data; reproducible deploy; rollback path |
| **Comprehension** | dead or broken features (tradescript `test-function`); unused dependencies; docs that contradict the code |

Severity is impact × reachability, written next to the finding, never a bare
label. Order of work: exploitable security and data loss first, then what
blocks the next feature (hotspots on the roadmap's path), then the rest.

### learn — ownership through tests

The proposal's LEARN mode risked becoming a quiz. The design turns it into
work that also protects the next step: the developer picks a flow from
`map.md`, **predicts** what it does, the agent traces the actual path, the
difference is discussed, and the flow is **pinned by a characterization test
the developer writes or approves**. That test is the learning artifact, and it
is what lets a later refactor of that flow be proven behavior-preserving.
`ownership.md` lists pinned flows with their test, and unknown flows. No
scoring of the developer.

### fix — reproduce first

One finding, one branch. The skill writes the test that demonstrates the
finding **before** the fix, runs it to see it fail, fixes, then `ai-flow
verify --red-at-base` (14-03): the core runs the diff's new or changed test
files against the base tree in a throwaway worktree and requires them to fail
there and pass on HEAD. That turns `/flow-review`'s "negative evidence"
(today a manual instruction) into a recorded fact, and it is what lets
`status` say `fixed`. The risk of the diff picks the strictness as it already
does: an ownership fix touches auth paths → `high` → STRICT, independent
review.

A finding too large for one change (a tenant-scoping retrofit across 40
queries) is promoted to an epic with `/flow-plan`, and the finding links the
epic. Recovery hands off; it does not grow a planner.

### refactor — behavior preserved, and checked

`ai-flow verify --claim refactor` (14-04) checks, on the diff: no existing
test file modified or deleted (adding tests is allowed, and expected for
characterization); the suite green; the added and moved lines executed by the
suite (lcov diff-lines). A violated claim is `NOT PROVEN` with the reason —
the claim lowers nothing and raises nothing else. When a mutation probe
exists (Uncle Bob wave 5), a refactor of a hotspot is where it pays: it shows
whether the unchanged tests actually pin the moved code.

Rules the skill carries, from the proposal and kept because each prevents a
measured failure: diagnose before changing; one transformation per change; an
extraction must name what it removes (duplication, a cycle, a size), not just
move code; no new abstraction with one use.

### Security tools — recipes, never requirements

Zero runtime dependencies stays the rule. External scanners are declared
commands, like `validation.quality`: `validation.security` in
`.coding-flow/config.json` (14-06), run and captured by `verify` with their
exit codes. `bootstrap --scan` suggests a recipe per detected stack (`npm
audit --omit=dev` / `pnpm audit`, `govulncheck ./...`, `pip-audit`, and
`gitleaks` / `semgrep` when installed). A declared tool that cannot run is
reported as **not examined**, never as a pass.

### What the core gains, in order

| # | Check | Why the skill cannot be trusted without it |
|---|---|---|
| 13-01 | migrations are behavior | the data dimension's fixes are migrations; today a migration-only diff verifies green at `not-required` (measured) |
| 13-02 | secret heuristic ignores command substitution and env references | the field test's only secret hit was a false positive |
| 14-01 | `ai-flow recover scan` | the deterministic half of assess: hotspots, test map, secrets in tree and history, sensitive paths, as JSON |
| 14-02 | findings read by `status`; cited `path:line` resolve | "fixed" derived, not claimed; no hallucinated locations |
| 14-03 | `verify --red-at-base` | a fix is proven by a test that failed before it |
| 14-04 | `verify --claim refactor` | a refactor is proven by tests that did not move |
| 14-06 | `validation.security` | scanners captured as evidence, absence reported |
| 14-07 | CRAP and size from lcov | ranks hotspots by risk, and stops a touched function from growing (Uncle Bob wave 4) |

## Refused

- **A "production-ready" verdict.** "Ready for the next step" (blocking
  findings fixed or accepted) is the most the tool states. Production
  readiness depends on requirements it cannot see — compliance, load, on-call
  — and must never be inferred from a green dossier.
- **Running exploits against a deployed system.** Reproduction is a test in
  the repository, run locally. No requests to production, staging or cloud
  metadata endpoints.
- **A whole-codebase rewrite or a "clean architecture migration".** One
  finding, one change. Larger work goes through `/flow-plan`.
- **Severity without a trace.** A finding with no `path:line` chain stays
  `suspected` whatever its label.
- **Bundled scanners, a parser per language, a separate test engine.** Breaks
  zero-dependency, and existing tools do it better.
- **Scoring the developer.** Ownership is measured by pinned flows, not by a
  quiz.
- **Persona prompts** ("act as a senior pentester"). Prose; the inventories do
  the work (Uncle Bob study, Martin's finding that long prompts are ignored).

## Freeze

This is the third freeze exception; the reasoning is in
`docs/design-decisions.md` entry 13. In one line: the premise every gate rests
on — risk arrives in a diff — does not hold for the developer this serves, and
the field test showed two serious vulnerabilities and a wrong green verdict
that no diff-scoped check would ever see.

## How to tell it worked

1. **A fixture, not the private repository.** `evals/recovery/` holds a small
   synthetic app reproducing the tradescript patterns (an id route without an
   owner filter, a caller-controlled fetch, a dead code-execution endpoint, a
   secret fallback mitigated in a Dockerfile, a command-substitution
   "password", no network for the audit). A blind assess must reach:
   IDOR and SSRF `confirmed`, the code endpoint `refuted`, the fallback
   `mitigated`, the password a `false-positive`, the audit `not examined`.
   Anything less is a skill regression.
2. **The replay on tradescript itself** by its owner, comparing with this
   table.
3. **From the runs**: share of `fixed` findings whose red-at-base passed
   (target 100 % — anything else is a claim); refactors with a held claim;
   review passes per recovery fix.
4. **The developer's own answer**, recorded in `ownership.md`: flows pinned
   versus unknown, before and after.
5. **Cost**: time and tokens of an assess on the fixture and on tradescript,
   printed with the result.
