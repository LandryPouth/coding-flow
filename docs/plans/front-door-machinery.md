# Front door machinery: fold the brownfield scan into `init`, demote `verify`

> Two moves, one principle: **the front door only holds what requires human
> intent.** `bootstrap --scan` requires none (the intent is "set up this repo"),
> so it folds into `init`. `verify` requires none (the intent is "run this story",
> or "CI decides"), so it drops out of the skill catalog and stays what it already
> is — machinery. Six skills become five, and brownfield onboarding stops
> demanding a round trip to the terminal.

## Thesis

The tool's first risk is discoverability, not capability. Every slot in the
front door spends the same budget, so a slot must earn it by holding a verb the
user actually needs to initiate.

- `ai-flow bootstrap --scan` is `readdirSync` plus ten regexes over
  `package.json` deps. It understands nothing. Asking a human to type it is
  friction with no decision attached.
- `/flow-verify` is the only skill where the model exercises no judgment: it
  shells out to one command and echoes the result. The other five think.
  Meanwhile **no skill calls it** — `flow-run` (4×), `flow-review` (3×) and
  `flow-ship` all invoke the CLI `ai-flow harness verify` directly. It is an
  alias occupying 1/6 of the catalog.

Neither move removes a capability. Both remove a thing the user has to *know*.

## Inherited constraints (non-negotiable)

- **Zero runtime dependency.** `node:*` only.
- **Idempotence + `--dry-run` everywhere.** Non-destructive by default.
- **Behavioral tests** in `node:test` on disposable repos: assert the observable
  (files, exit codes, printed output), never the narrative.
- File deletion via `trash`, never `rm`.
- One source for skills: `templates/.claude/skills/` is the truth,
  `skills/` is materialized by `ai-flow plugin sync`.

## Part A — the brownfield scan becomes machinery

### A.1 Why level C (no artifact) rather than level A (auto-write the file)

Three of the risks of auto-writing exist *only because a file persists*:

| Risk | Exists if the file exists | Exists if the scan is a function call |
| --- | --- | --- |
| "none detected" noise on greenfield | yes | no |
| Silent clobber of a human edit | yes | no |
| Stale scan (setup at T0, plan three weeks later) | yes | no |

The scan holds no durable information: it is regenerable in milliseconds and
always true at the moment it runs. Persisting it caches something cheaper to
recompute than to store — and turns it into an *installed file*, which in this
codebase means it owes the whole manifest lifecycle (hash, non-destructive copy,
prune, `uninstall`, `doctor`). Today `docs/bootstrap-scan.md` is in none of that:
it is not in `manifest.json`, so `uninstall` — which walks `manifest.files`
(`bin/lib/uninstall.js:34-42`) — leaves it behind as an orphan. Excusable for a
file the user explicitly asked for; not for one the tool drops on its own.

**Decision: level C.** `init` runs the scan, writes nothing, and reports.
`/flow-plan` re-runs it when it needs the data. `ai-flow bootstrap --scan` stays
a public command for humans and CI who want the artifact, and gains the
non-destructive behavior the rest of the tool promises.

### A.2 The risk that no code change fixes

Removing a visible step makes it invisible. Today, typing `bootstrap --scan` is
the moment a developer realizes they are onboarding an existing codebase. The
brownfield flow has two stages, and only the second produces value:

| Stage | Nature | Cost | Automatable |
| --- | --- | --- | --- |
| `scanProject()` | mechanical, deterministic, read-only | ms | yes |
| `/flow-plan` § Brownfield | the model reads, opens files, **writes** four durable docs | expensive, judgment | no |

Automating stage 1 while leaving stage 2 unsignposted would onboard *worse* than
today: the developer sees a scan happen, assumes the project is understood, and
goes straight to `/flow-plan "my feature"` on empty project docs.

**Mitigation — and it is copy, not code.** `init` must not report "scan
written". It reports what was detected **and that nothing is documented yet**,
with the pointer as the deliverable:

```txt
Existing codebase detected: Next.js, Prisma — 12 scripts, 3 test directories.
Project docs are still empty. Next: /flow-plan bootstrap
```

Backed by one `doctor` check: brownfield signals present **and**
`docs/project-context.md` still at template content ⇒ warning, onboarding never
finished.

### A.3 The silent-failure mode to close

`detectPackageJson()` returns `null` when there is no `package.json`, so
`deps = []`, `scripts = {}`, `frameworks = []`. The ten detectors are all
JavaScript. A Django, Go, or Rust repository therefore scans to **something
indistinguishable from a greenfield project**, with no warning.

Classification, printed by `init`:

- `rich` — frameworks ∪ scripts ∪ test dirs all non-empty ⇒ proceed to
  `/flow-plan`.
- `thin` — some signal, incomplete ⇒ a starting point, expect to fill gaps.
- `empty` **while the repo visibly holds code** (non-trivial top-level
  directories, or a non-empty git history) ⇒ say it loudly: the stack is
  probably not JavaScript, the project docs will have to be written by hand.

`empty` on a genuinely empty repo is the greenfield path: say nothing, write
nothing.

### A.4 Work

1. Split `bin/lib/bootstrap.js`:
   - `scanProject()` → the scan object. Pure, no I/O beyond reads, testable.
   - `classifyScan(scan)` → `rich | thin | empty` + `looksLikeCode`.
   - `formatScanMarkdown(scan)` → the document (only for the explicit command).
   - `bootstrapScan()` → the CLI wrapper: format, write **non-destructively**,
     report.
2. Guard the write: skip an existing `docs/bootstrap-scan.md` unless `--force`,
   matching `init`'s contract. Report the skip.
3. `bin/ai-flow.js` init dispatch: call `scanProject()` after
   `ensureConvenienceFiles`, print the classification-driven report. Never write.
4. `skills/flow-plan` § Brownfield Bootstrap: run the scan itself rather than
   reading a file that may not exist or may be stale.

## Part B — `verify` becomes machinery

### B.1 What is already true

`verify` is *already* machinery: `flow-run` calls it automatically,
`ai-flow status` / `ship` / `audit --check` / CI all consume the evidence. Only
the **skill** is up for removal, and it has no internal consumer — every caller
uses the CLI string, so deleting the skill breaks nothing mechanically. What
remains is documentation drift: `templates/RULES.md:121`,
`templates/CLAUDE.md:13`, `skills/flow-ship/SKILL.md:13`,
`bin/lib/templates.js:210`, `bin/lib/skills.js:18`, README, QUICKSTART.

### B.2 What is lost, and how it is covered

- **The `stale` re-verify.** A developer changes one line, `status` flips to
  `stale`. Today they type `/flow-verify`. Without the skill the default answer
  becomes "re-run `/flow-run`", far more expensive for a one-liner. The escape
  hatch must stay trivial to type — and
  `ai-flow harness verify --story <path>` is a sentence, not a command.
  **Promote it: `ai-flow verify --story <path>`.** The `harness` namespace earns
  itself for `preflight` / `check` / `evidence`, which nobody types; not for the
  one subcommand somebody will.
- **The showcase.** `verify` is the product's conceptual centerpiece — "verified
  means the machine actually ran the tests" is the whole differentiator. Losing
  its catalog slot costs visibility. It is taught instead where it lands: the
  README, the QUICKSTART, and **the output of `/flow-run`**, which should state
  the proof explicitly ("3 commands, exit 0, evidence at …") rather than leaving
  it implicit. A skill is a verb the user needs; `verify` is a noun they need to
  trust.

### B.3 Work

1. `bin/ai-flow.js`: top-level `verify` dispatching to `harnessVerify`, with
   `--story`, `--json`, `--dry-run`.
2. `bin/lib/commands.js`: `verify` in the full reference under "Daily", **not** in
   the golden path — putting it on the 95% screen would contradict the very claim
   that verification is machinery. `harness verify` stays as the long form.
3. `trash skills/flow-verify templates/.claude/skills/flow-verify`.
4. `bin/lib/skills.js`: drop `flow-verify` from `WORKFLOW_ORDER`.
5. Reference sweep across the seven files above; the six-skill claim becomes
   five everywhere.
6. `ai-flow plugin sync` so `skills/` matches the templates, then
   `plugin check` in CI keeps it honest.

## Test plan

New `test/bootstrap.test.js` — there is currently **no test touching
`bootstrap.js`** (21 test files, zero mentions):

- `scanProject()` on a fixture with `next` + `prisma` + a `tests/` directory ⇒
  frameworks detected, classification `rich`.
- On a Python fixture (no `package.json`, a `src/` and a `tests/` directory) ⇒
  classification `empty`, `looksLikeCode: true` — the loud case.
- On an empty repo ⇒ classification `empty`, `looksLikeCode: false`.
- `bootstrap --scan` twice ⇒ the second run does not clobber an edited file
  without `--force`.
- `init` on a brownfield fixture ⇒ **no** `docs/bootstrap-scan.md`, and the
  pointer to `/flow-plan` present in stdout.
- `init` on a greenfield fixture ⇒ no brownfield block in stdout.
- **`init` then scan ⇒ still `empty` / `looksLikeCode: false`.** Found during
  implementation: `init` writes `docs/`, `epics/`, `examples/`, eleven `flow:*`
  scripts, and a `package.json` when the repo has none — all of it read straight
  back as project signal. A fresh repo reported "13 scripts", and a Python repo
  reported as JavaScript. The scan must never mistake our scaffold for the project.

Existing suites that must stay green: `templates.test.js`, `cli.test.js`,
`plugin.test.js` (skill count), `plugin-detect.test.js`.

### Failure sweep

Both moves change who runs the code: the scan now runs on *every* repo instead of
the ones whose owner typed the command, and `verify` is now typed by hand instead
of emitted by a skill. Both shifts widen the input space, so the second pass was
adversarial — malformed inputs, wrong scopes, repos that change shape after
install. It found two defects the happy-path tests could not:

- **The manifest flag was sticky.** `packageJsonCreated` suppressed the
  package.json forever, so a greenfield repo that later became a real Next.js app
  scanned as `empty` and got told its stack was "likely Python, Go, or Rust". The
  flag now only suppresses the file while it still holds no project signal — no
  dependency, no non-`flow:*` script.
- **`--story` scoped silently.** A typo'd or out-of-tree path resolved to `null`,
  verify fell back to the project-wide commands, and the evidence recorded
  `story: "epics/typo"` — a green proof for a story that does not exist, ingested
  as-is by `audit`. `run` already refused this (`run.js` `selectStories`);
  `harnessCommand` now refuses it for every subcommand, including a `--story`
  with no value at all.

Also closed: a broken `package.json` (merge conflict, truncated write) reported as
"no JavaScript signal" — the scan now says the file could not be parsed, so the
user fixes the file instead of doubting the detectors; and non-object `scripts` /
`dependencies`, where a `scripts` string was walked character by character and
turned eight letters into eight scripts.

The failure cases are pinned in `test/bootstrap.test.js` (26 tests) and
`test/verify-command.test.js` (21). Each fix was mutation-checked: reverting it
in isolation turns exactly the intended tests red and nothing else.

### What only a real project showed

Disposable three-file fixtures agree with whatever the code does. Installing into
a realistic Next.js + Prisma repo (20 tracked files, real scripts, existing docs,
git history) surfaced what they could not:

- **The promotion was half-delivered.** `ai-flow verify` existed, but every
  message that tells a human to run it still said `ai-flow harness verify` —
  including `audit --check` on a stale proof, which is verbatim the scenario
  B.2 invented the promotion for. Fixed in `audit.js`, `ship.js`, `hook.js`.
- **The `--story` guard had a hole and a regression.** It accepted any directory,
  so `verify --story src` filed a proof under a story named `src`, and the audit
  ledger then carried a `src` entry nothing could ever re-verify. It also broke
  `preflight`, which is designed to answer "how risky is this story?" before the
  directory exists. The rule now lives in `harnessVerify` and requires `epics/`;
  `preflight` keeps its `(missing)` report and `check` keeps its own `spec.md`
  guard.
- **`ai-flow status | head` crashed** with an unhandled EPIPE stack trace. Paging
  output is ordinary use; a closed pipe is a normal end.

Four more were listed rather than fixed here, because each is its own change.
They are closed in [brownfield-honesty](brownfield-honesty.md):

- **A.2's doctor check was never implemented.** `doctor --strict` on a brownfield
  repo whose project docs are untouched template stubs reports "installed
  correctly". That check is the mitigation for the one risk this plan said code
  could not fix.
- **`init` skips a colliding file without naming it**, then advises `--force`. On
  the fixture the collision was the project's own `docs/architecture.md`, so the
  advice reads as "overwrite your architecture doc". The file is correctly absent
  from the manifest, so `uninstall` leaves it alone — only the message is wrong.
- **JS monorepos scan as foreign stacks.** A pnpm workspace with no root
  `package.json` is told its stack is "likely Python, Go, or Rust". A.3 promised
  to make the gap loud, not to make a confident wrong claim; a workspace marker
  (`pnpm-workspace.yaml`, `workspaces`) should mute the stack guess.

## Out of scope

- Making the scan understand non-JavaScript stacks. This plan makes the gap
  *loud*; teaching detection for Python/Go/Rust is separate work.
- Touching the evidence format, `audit`, or CI gating. `verify` changes name on
  the surface only; its behavior is untouched.
