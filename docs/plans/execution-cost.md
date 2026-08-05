# Execution cost: stop charging STRICT prices for a copy change

> Reported from real use: 45–60 minutes for a simple task, 6h+ cumulative for one
> landing page. A driving agent blamed the harness — wrong cwd, no cache, no
> parallelism. All three were real and all three are now fixed, and together they
> were worth **about 3 minutes of the 45**. The other 42 are ceremony: prose this
> tool obliges an agent to write, and policy it obliges every turn to re-read.
>
> Same principle as [front-door-machinery](front-door-machinery.md): the cost is
> not in what the tool does, it is in what the tool *demands*. Subtract.

**Status: implemented.** All parts landed with the suite at 264 tests. Two notes
from the build: a **fifth** harness defect surfaced while testing Part C — the
`## Status` matcher could not read `## Status: done`, the exact form `/flow-run`
mandates, so the most authoritative of the three status signals had been inert for
its documented syntax (see Part 0). And Part C needed a real resolution point
(`bin/lib/story.js`) rather than a second code path: every reader now asks for a
role — spec, plan, tasks — and a single-file story answers all three.

## Inherited constraints

Unchanged: zero runtime dependency (`node:*` only), idempotence and `--dry-run`
everywhere, behavioral tests on disposable repos, `trash` never `rm`,
`templates/.claude/skills/` is the one source for skills.

One new constraint, and it outranks speed: **nothing here may weaken what a green
verify means.** Ceremony is negotiable; proof is not. Every subtraction below
removes prose or a redundant pass, never a check that establishes a fact.

## Part 0 — the harness defects (done)

Four, of which the driving agent had found two.

| Defect | Effect | Fix |
|---|---|---|
| `cwd = process.cwd()`, no root resolution | From `apps/web`, config not found, declared commands silently swapped for that subpackage's scripts, evidence filed under the wrong root | `.coding-flow/` marker walked upward; relocation announced on stderr |
| `maxBuffer: 10 MB` | A **passing** suite printing >10 MB came back `exit 127` — green code recorded as a red proof, story marked blocked | 256 MB, overridable; overflow now reports `toolError` with a null exit code, never a fabricated one |
| Fallback config → package.json was silent | A verify that proves less than it claims | `Commands from: <source>` printed with every result |
| No global error handler | Crashes reached the user as raw Node stack traces — the "internal tool error" in the report | `uncaughtException` handler; `CODING_FLOW_DEBUG=1` for the stack |
| `## Status: done` was unreadable | The matcher required whitespace after `Status`, so the colon form `/flow-run` mandates never matched; a story marked `blocked` after a red verify fell through to the prose heuristic | Colon optional; all three documented forms accepted |

Plus the reuse of a still-valid proof: keyed on the working-tree token, the
untracked-file listing, and a fingerprint of the command set. A cache hit prints
`already proved` and **writes no new evidence** — recording a run that did not
happen is the one thing this tool must never do.

Not done: parallel execution of validation commands. Declared command lists are
ordered (`build` before `test` is legitimate), so running them concurrently would
break projects to save ~20 seconds that the cache already avoids spending at all.
It stays available as opt-in work if the numbers ever justify it.

## Part A — RULES.md says everything twice

### A.1 The measurement

`RULES.md` is 1 780 words and `CLAUDE.md` imports it, so it is in context on
**every turn of every session**. Six of its sections restate policy the skills
already carry:

| Section | Words | Already stated in |
|---|---|---|
| Intensity Modes | 351 | `flow-run` § Choosing Intensity |
| Context Ladder | 189 | `flow-run` § Context Policy |
| Choosing depth | 183 | `flow-run` / `flow-review` opt-in sections |
| Quality Gates | 154 | `flow-run` § Harness Automation |
| Workflow | 111 | `CLAUDE.md` skill list |
| Required Stop Conditions | 106 | `flow-run` § Stop Conditions |
| **Total** | **1 094** | **61 % of the file** |

The genuine rulebook — Architecture, Code Quality, Validation, Testing, Security,
Core Behavior, Execution Flow, Context Boundaries, Communication — is 612 words.

### A.2 Duplication is not just cost, it is drift

The two copies have already diverged. `RULES.md` § Quality Gates still instructs
`ai-flow harness preflight / check / evidence`; the front door promoted
`ai-flow verify --story <dir>` in 0.5.2. A rule stated in two places is a rule
that will disagree with itself, and the always-loaded copy is the one that wins
by default.

### A.3 Work

Cut the six duplicated sections. `RULES.md` keeps the project constraints and the
short operating rules — what the repo demands of any agent — and stops restating
the workflow, which is the skills' job. Target ~620 words, a 65 % cut on every
turn of every session.

Where a rule genuinely belongs in both places, it is stated once in `RULES.md` and
the skill points at it, never the reverse.

## Part B — the STRICT trigger fires on almost everything

### B.1 The claim

`flow-run` currently reads:

> Use **STRICT** whenever the story touches auth, permissions, admin surfaces,
> **user input, persistence, external integrations**, secrets, payments, uploads,
> or sensitive data.

"Touches user input" is not a risk signal — every form on every page touches user
input. "Touches persistence" catches every feature that reads a database. A
landing page with a contact form matches twice, and STRICT in `RULES.md` is ten
numbered steps: clarify, context map, TDD, implement, tests + E2E, architecture
check, deep quality review, security questions, `/flow-review` plus a fix loop,
then record decisions in two files.

That is the 45 minutes, and it is spent on a copy change.

### B.2 The fix: blast radius, not topic keywords

The question is not *what subject does this touch* but *what can this break that
the suite would not catch*. STRICT is for a change that:

- alters an authorization decision or who can reach something;
- changes a persistence schema or a migration;
- moves money, credentials, or secrets;
- creates a **new** externally-reachable trust boundary.

A form posting to an existing, already-validated endpoint creates no new boundary
and is STANDARD. Copy inside an existing page is QUICK. The security rules in
`RULES.md` still apply at every intensity — what changes is the ceremony, not the
constraints.

### B.3 Risk, stated plainly

This trades some safety margin for speed, and it is the one part of this plan
that can actually let a defect through. The mitigations: the trust-boundary
trigger is broader than it looks (anything *newly* reachable escalates), the
harness verify stays non-skippable at every intensity, and `guard` plus the audit
ledger are unchanged. If it proves wrong, the honest fix is to widen the trigger,
not to re-add the ceremony everywhere.

## Part C — three files for a one-line change

`/flow-plan` writes `spec.md` + `plan.md` + `tasks.md` for every story regardless
of size, and `/flow-run` then updates `## Result` and the Decisions section.

The split earns itself on a story worth a day. On a copy change it is three files
to create, three to re-read on every subsequent turn, and two to update at the
end — to record that a heading changed.

**Work:** for QUICK/FAST stories, `/flow-plan` writes a single `story.md`
(objective, acceptance criteria, commands, result). `spec.md` / `plan.md` /
`tasks.md` stay exactly as they are for STANDARD and STRICT. The tool already
reads a story directory rather than three fixed names in most paths; where it
does not, it learns to.

## Part D — the Run Result block is 10 sections wide

`flow-run` § Output mandates Story, Intensity, Summary, Acceptance Criteria,
Files Changed, Tests And Validation, Decisions Recorded, Rollback Notes,
Remaining Risks, Stop Conditions Triggered — 25 fields, for every story at every
intensity. On a QUICK change most come back `-`, which costs tokens to write and
attention to read past.

**Work:** the full block for STANDARD/STRICT. For QUICK/FAST: what changed, the
verify result, and anything that is actually a risk. Same rule as everywhere else
here — the artifact scales with the story.

## Part E — `/flow-review` twice over the same diff

STANDARD currently runs both `Review Before Done` (inside `flow-run`) and a full
`/flow-review` pass. The second is a complete skill re-reading a diff the same
agent wrote minutes earlier.

**Work:** in STANDARD, `/flow-review` becomes opt-in — invoked when the self-review
finds something, when the diff crosses modules, or on request. It stays mandatory
for STRICT, where an independent pass is the point.

## Expected effect

Honest accounting, since the whole point of this document is not to repeat the
driving agent's mistake of measuring the cheap thing:

- **Measurable now:** ~1 160 fewer words per turn (Part A); one CLI invocation
  instead of four on QUICK stories; two files not created and not re-read per
  QUICK story (Part C).
- **Expected but not yet measured:** the mode distribution (Part B) is the largest
  single lever and depends entirely on how often STRICT stops firing. It needs to
  be checked against real usage, not asserted here.
- **Unchanged:** what a green verify means.

## Test plan

- `RULES.md` after the cut contains no Intensity Modes / Context Ladder / Quality
  Gates / Choosing depth section, and still contains every project constraint.
- No skill and no template references a section removed from `RULES.md`.
- No template instructs `ai-flow harness verify` where the front door is
  `ai-flow verify --story` (the drift Part A.2 found).
- A QUICK story scaffolds one `story.md`; a STANDARD story still scaffolds three.
- `status`, `audit`, and `guard` read a single-file story exactly as they read a
  three-file one — a QUICK story is still provable.
- The STRICT trigger fires on a story that adds an endpoint, and does not fire on
  a copy change to an existing page.

Each change mutation-checked as before: reverting it in isolation must turn
exactly the intended tests red.

## Out of scope

- Parallel validation commands (see Part 0).
- Any change to evidence, the audit ledger, `guard`, or CI gating.
- Reducing the number of skills — five is already the flat set.
