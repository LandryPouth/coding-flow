# Brownfield honesty: finish the onboarding gate, stop guessing wrong

> Four defects left open by [front-door-machinery](front-door-machinery.md), all
> from the same family: **the tool reports a state it has not established.** It
> says the install is correct when onboarding never happened, says a file was
> skipped without saying which, says a React monorepo is probably Python, and
> says it removed seventeen files without naming one. Each fix is the same shape:
> say what is actually known, and stop asserting what is not.

**Status: implemented.** All four parts landed with the suite at 238 tests. Two
notes from the build: the manifest stores `{source, hash, kind}` per file, not a
bare hash, so Part A's comparison reads `.hash`; and Part B's member reading
turned out to be worth the extra scope — muting the wrong claim alone would have
left the scan useless on the repo shape most likely to be onboarded with it.

## Inherited constraints

Unchanged from the previous plan: zero runtime dependency (`node:*` only),
idempotence and `--dry-run` everywhere, behavioral tests on disposable repos,
`trash` never `rm`, `templates/.claude/skills/` is the one source for skills.

## Part A — the onboarding gate `doctor` never got

### A.1 The gap

[front-door-machinery](front-door-machinery.md) § A.2 identified the one risk no
code change removes: folding the scan into `init` makes the *second* half of
brownfield onboarding — the expensive half, where `/flow-plan` reads the code and
writes four durable docs — invisible. Its stated mitigation was two-part: `init`
prints the pointer (**done**), and

> Backed by one `doctor` check: brownfield signals present **and**
> `docs/project-context.md` still at template content ⇒ warning, onboarding never
> finished.

That check was never implemented. On a real Next.js + Prisma repo whose project
docs are untouched stubs, `doctor --strict` answers "Coding Flow is installed
correctly". The tool is reporting on its own files, not on the user's readiness —
and the one place a stalled onboarding would surface says everything is fine.

### A.2 How "still at template content" is decided

Exactly, not heuristically. `.coding-flow/manifest.json` already stores the
sha256 of every file **as installed**. A doc whose current hash still equals its
manifest hash has not been touched since `init`. No line counting, no marker
string, no false positive on a short but real document.

The existing `thin_doc` warning (strict mode, under 200 characters) stays: it
catches a doc someone edited badly. This one catches a doc nobody edited at all.
Different failure, different check.

### A.3 Scope of the warning

- Fires when: the repo shows brownfield signal (`classification !== "empty"` or
  `looksLikeCode`) **and** every one of `docs/project-context.md`,
  `docs/conventions.md`, `docs/roadmap.md` is byte-identical to what `init` wrote.
- **Every** one, not any: a user mid-onboarding who has written project-context
  but not roadmap is making progress and does not need nagging.
- Not strict-only. It is the mitigation for the discoverability risk, so it has to
  fire on the `doctor` a user actually runs.
- A warning, never an error: `doctor` must keep exiting 0. Unfinished onboarding
  is not a broken install, and turning it into a red exit would break CI for every
  project that legitimately runs Coding Flow without brownfield docs.
- Message carries the action: `run /flow-plan bootstrap`.

### A.4 Work

1. `bin/lib/doctor.js`: `collectDoctorReport` gains the check, guarded by the
   manifest being present and readable.
2. It needs `scanProject()` — cheap (milliseconds), already imported nowhere in
   doctor. Import from `./bootstrap`.
3. Warning code `brownfield_not_onboarded`, so `--json` consumers can key on it.

## Part B — JS monorepos are not foreign stacks

### B.1 The false claim

A pnpm workspace with no root `package.json` — an ordinary shape for a JS
monorepo — currently gets:

```txt
Existing code detected, but the scan found no JavaScript signal.
Directories: apps
The detectors only cover the JS ecosystem, so this stack is likely
Python, Go, Rust, or similar.
```

`pnpm-workspace.yaml` is sitting in the root. The npm-workspaces variant (root
`package.json` with `workspaces`, no dependencies) is less wrong but equally
useless: "no framework, script, or test signal" while every manifest under
`packages/*` is full of it.

§ A.3 of the previous plan promised to make the detection gap **loud**. Asserting
a specific wrong stack is not loudness, it is confident error — and it lands on
the class of repository most likely to be onboarded with this tool.

### B.2 Two levels, both needed

- **Mute the wrong claim.** The "likely Python, Go, Rust" branch must require
  *no JavaScript signal anywhere*: no root manifest, no workspace marker, no
  detected framework. This alone removes the falsehood.
- **Read the members.** Muting leaves the scan useless on monorepos, and useless
  is what sends `/flow-plan` in blind. Workspace globs are simple enough to
  resolve without a YAML parser: `packages/*`, `apps/*`, or a literal directory.
  Read each member `package.json`, union its dependencies into framework
  detection.

Bounded on purpose: one level of glob expansion, no recursion into member
workspaces, a hard cap on members read. The scan is a milliseconds-long function
call that now runs on every `init`; it does not get to walk a large repository.

### B.3 Shape

`scanProject()` gains:

```js
workspace: { marker: "pnpm-workspace.yaml" | "package.json" | "lerna.json" | null,
             patterns: [...], memberCount: n, memberScriptCount: n }
```

`detectedFrameworks` becomes the union of root and member dependencies —
`/flow-plan` asks "what is this built with", and the answer does not depend on
which manifest happens to hold the dependency. `scripts` stays root-only: those
are the commands a user can actually run from the root.

Classification counts member signal, so a monorepo lands `thin` or `rich` instead
of `empty`.

### B.4 Work

1. `bin/lib/bootstrap.js`: `detectWorkspace()`, `readWorkspaceMembers()`, wire
   into `scanProject()`.
2. Tighten the foreign-stack branch in `printProjectScanSummary` and in
   `bootstrapScan`'s report.
3. A workspace line in both reports: marker, member count, frameworks found.

## Part C — `init` must name what it kept

### C.1 The defect

```txt
Skipped existing files: 1
Use --force to overwrite them.
```

On the test repo that file was the project's own `docs/architecture.md`. So the
message is unactionable (which file?) and its advice is destructive (`--force`
overwrites a real architecture document with a template stub).

The file itself is handled correctly — a skipped file is never recorded in the
manifest, so `uninstall` leaves it alone. Only the report is wrong.

### C.2 Fix

List the paths. Reframe from "here is how to overwrite" to "these are yours, we
kept them", with `--force` mentioned as what it is: a destructive override.

```txt
Kept 1 existing file (not overwritten):
- docs/architecture.md
Use --force to replace them with the Coding Flow templates.
```

Same treatment for `uninstall`, which announces `Removed files: 17` and names
none — worse, because that command deletes. Print the list; it already prints one
for `Skipped modified files`.

## Part D — the cheat sheet contradicts the front door

`ai-flow commands` lists `harness` under "Daily" and omits `verify`, while
`help --all` does the opposite. The front-door principle settles it: `harness
check --quick` is machinery nobody types; `verify` is the promoted escape hatch.

- Daily becomes `doctor`, `check`, `skills`, `status`, `verify`.
- `verify` prints the direct form `ai-flow verify --story <dir>` in both branches:
  it takes an argument, and `npm run flow:verify -- --story x` is not a command
  anyone should be told to type. **No new `flow:verify` npm script** — adding one
  would advertise a form worse than the one it wraps.
- `harness` leaves the cheat sheet; `help --all` still documents it under
  Machinery, where it belongs.
- Column padding computed from the longest name instead of a hardcoded `padEnd(8)`
  (`uninstall` is nine characters and eats its own gap).

## Test plan

Extending `test/bootstrap.test.js` and `test/verify-command.test.js`, plus
`doctor` coverage:

- Brownfield repo, docs untouched ⇒ `doctor` warns `brownfield_not_onboarded`,
  exit 0.
- Same repo after editing `project-context.md`, `conventions.md`, `roadmap.md`
  ⇒ no warning.
- Greenfield repo, docs untouched ⇒ no warning (nothing to onboard).
- Partial progress (one doc written) ⇒ no warning.
- Missing/corrupt manifest ⇒ no crash, no warning.
- pnpm workspace, no root manifest ⇒ frameworks from members, no "Python, Go,
  Rust" claim, workspace line printed.
- npm workspaces ⇒ same.
- Workspace marker present but members unreadable ⇒ degrades to the neutral
  message, never the stack guess.
- Member cap respected on a workspace declaring many packages.
- A genuine Python repo ⇒ still gets the loud foreign-stack warning (the fix must
  not mute the case it was written for).
- `init` colliding with an existing doc ⇒ names the path, does not advise
  overwriting as the default.
- `uninstall --dry-run` ⇒ names every file it would remove.
- `ai-flow commands` ⇒ contains `verify`, not `harness`; columns aligned.

Each fix mutation-checked as before: reverting it in isolation must turn exactly
the intended tests red.

## Out of scope

- Teaching the scan non-JavaScript ecosystems (Python, Go, Rust detectors). Part B
  stops the tool from *claiming* a stack it cannot read; reading them is separate.
- Recursive or nested workspaces, and workspace globs beyond one `*` level.
- Any change to evidence, audit, or CI gating.
