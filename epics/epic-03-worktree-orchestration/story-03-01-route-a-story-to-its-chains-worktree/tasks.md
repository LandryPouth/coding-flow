# Story 03-01 — Tasks

- [x] Read `bin/lib/worktree.js`, `bin/lib/next.js`, `bin/lib/status.js`, and
      `epics/epic-02-worktree-story-landing/index.md`'s dependency tree
      section (targeted discovery — confirm the exact ASCII format and
      existing worktree-naming behavior before writing the parser).
- [x] Write the backbone/dependency-tree parser as a pure function, with its
      own unit tests first (chain, siblings, consolidation, malformed
      input).
- [x] Resolve and implement the shared placement-state storage location
      (`git rev-parse --git-common-dir`-based), with read/write helpers.
- [x] Implement the placement decision (chain root → recorded location, else
      current checkout if unoccupied, else new `worktree add`).
- [x] Wire the placement step into `skills/flow-run/SKILL.md` (and
      `templates/.claude/skills/flow-run/SKILL.md`) before any story work
      begins, for every intensity — mirror how story-02-01 wired its lock
      step.
- [x] Decide and document (in `## Result`) whether `next`'s tier-5 suggestion
      changes now that `/flow-run` places automatically.
- [x] Run `npm test`; capture the verify.

## Status: done

## Result

**`bin/lib/backbone.js`** (new) — parses an epic's `## Stories` numbered list
(position = `s<N>` label, `flow-plan`'s own convention) and the fenced code
block under `## Backbone` into a chain graph. Deliberately **not** anchored
to a `### Story dependency tree` subheading: real epics (bethl's epic-18/19)
put the fenced block directly under `## Backbone` with no subheading at all,
diverging from `flow-plan`'s documented example — the parser follows what is
actually authored, verified against all four real epics available (this
repo's epic-02/epic-03, bethl's epic-18/epic-19), not just synthetic
fixtures. Supports both real shapes in the wild: the indented box-drawing
tree, and a flatter chain-per-line shape. A consolidation/merge point (a
story with more than one parent) fails loudly rather than guessing a
placement — `worktree-plan.js` has no representation for "wait on two
chains, then continue on neither."

**`bin/lib/worktree-plan.js`** (new) — `decidePlacement({ cwd, epicPath,
storyPath })`: resolves the story's chain id, reads the placement state for
that chain (stored under `git rev-parse --git-common-dir`, shared across all
of the epic's worktrees — not `.coding-flow/`, which is deliberately
per-checkout), and either reuses the recorded location, claims the current
checkout for a new chain, or opens a new worktree (via the now-exported
`worktreeAdd`) when the current checkout is already claimed by a different
chain. Each write re-reads the state file immediately before merging in the
one chain being claimed, narrowing (not eliminating) the race window against
a concurrent claim for a different chain.

**`bin/lib/worktree.js`** — `worktreeAdd` now returns `{ path, branch, root
}` instead of nothing (backward compatible — the CLI never used the return
value); `worktreeAdd`/`worktreeDest`/`requireRepo`/`resolveStory` are now
exported for reuse.

**`bin/ai-flow.js`** — new `ai-flow worktree place --epic <dir> --story
<dir>` command, wired directly here rather than through
`worktreeCommand`/`worktree.js`'s dispatcher: `worktree-plan.js` already
requires `worktree.js` for `worktreeAdd`, so routing `place` back through
`worktree.js` would create a circular require. `ai-flow.js` is the one file
neither module requires.

**`bin/lib/next.js`** — tier-5's suggestion for a `planned` story with no
worktree changed from unconditional `worktree add --story <dir>` to
`worktree place --epic <dir> --story <dir>`: the same command `/flow-run`
now runs automatically, so `next` points a user not going through
`/flow-run` at the placement-aware decision instead of the blunt "always
create a worktree" one that produced the epic-19 incident this epic exists
to fix.

**`templates/.claude/skills/flow-run/SKILL.md`** (source of truth; synced
into `skills/flow-run/SKILL.md` via `ai-flow plugin sync`) — a new
"resolve where the story runs" step, before the existing lock step, at every
intensity: runs `worktree place`, `cd`s into a new worktree if one was
created, and stops (rather than guessing) if placement itself errors on an
unsupported tree shape.

**Verified against real files, not just synthetic fixtures**: parsing all
four real epic `index.md` files this repo and bethl currently have caught
two real bugs synthetic tests alone had not: a missing `m` regex flag that
silently made the tree-heading match never fire on a real multi-line
document, and — more importantly — the parser's original anchor on a `###
Story dependency tree` subheading, which does not exist in bethl's actual
epic-18/epic-19 (the two epics that motivated this whole epic). Both fixed;
re-verified against all four files before considering this done.

**Known pre-existing issue, not caused by this story**: `ai-flow harness
check --story <dir>` fails on this repo's own tree with 3 secret-pattern
matches in `test/guard.test.js` / `test/harness.test.js` — the fixtures
those files' own tests need, already logged as `open` in
`docs/DOGFOODING.md` (2026-08-24 row, and 2026-08-18). `--story` does not
scope the secret scan; neither file is part of this story's diff (confirmed
via `git status`). `ai-flow verify` (the authoritative pass/fail) is green.

**Post-review fixes (`/flow-review`, 2026-08-27)**:

- `decidePlacement` (`bin/lib/worktree-plan.js`) now returns `parallelTo:
  { chainId, location }` for a newly created worktree (`null` for the
  in-place case) — the spec's UX edge case ("told ... which sibling it runs
  parallel to") was implemented as a discarded comparison, not surfaced. The
  CLI's `worktree place` handler (`bin/ai-flow.js`) now prints a `Reason:`
  line from it before "Next step".
- `decidePlacement` now captures the return of `requireRepo(cwd)` and fails
  loudly if the coding-flow project root (`cwd`, per `context.js`'s
  intentional "not the git root, for a repo holding several installs" split)
  is not itself the git repository root, instead of silently recording a
  placement built from two roots that a new worktree (always resolved
  against the *git* root inside `worktreeAdd`) could never meaningfully be
  compared against. Not reachable through this repo's own usage today — a
  latent-only defect until multi-install monorepos actually use worktree
  placement — but the story's own STRICT rationale ("a wrong placement
  scatters a user's work") argues for failing loud over failing silent.
- `worktreeAdd` (`bin/lib/worktree.js`) gained a `quiet` option — discovered
  while adding a CLI-level test for `worktree place --json`: `worktreeAdd`'s
  own progress lines were unconditionally printed to stdout, corrupting the
  JSON `worktree place --json` is supposed to emit. `decidePlacement` now
  calls it with `quiet: true` (its own CLI wrapper already prints one
  consolidated summary from the return value, so the duplicate noise was
  removed for the text-output mode too, not only the JSON one). Additive
  change: `quiet` defaults to `false`, so every existing caller
  (`worktreeCommand`'s own `add`) is unaffected.
- New tests covering all three: `test/worktree-plan.test.js` gained
  `parallelTo` assertions on `decidePlacement`'s return value, a test for the
  project-root/git-root guard, and CLI-level tests that actually invoke
  `ai-flow worktree place` (text and `--json` output, missing-flag error,
  and a `decidePlacement` error surfaced without a stack trace) — closing
  the "CLI wiring has no direct test coverage" gap the review also flagged.
  `npm test`: 527/527 green (was 519/519 pre-review).

**Post-review fixes (`/flow-review`, 2026-08-28)**:

- Closed a TOCTOU race in `decidePlacement`/`claimChain` (`bin/lib/worktree-plan.js`)
  the review found: the old `claimChain` re-read state right before writing,
  but only to avoid clobbering a *different* chain's entry — it never
  re-checked occupancy of the target location against that fresh read. The
  occupancy decision itself ("is `here` free?") was made once, earlier, in
  `decidePlacement`, on a read taken *before* the new-worktree branch's
  potentially multi-second `worktreeAdd` call. Two `/flow-run` invocations
  for two different, not-yet-placed chains started near-simultaneously
  (exactly the spec's own concurrency edge case — the parallel-work scenario
  this whole epic exists to enable) could both read the pre-write state,
  both decide "unoccupied", and both commit a claim: neither write was lost,
  so it never looked like data corruption, but two different chains ended up
  recorded at — and actually running work in — the same physical checkout,
  the exact isolation failure story-03-01 exists to prevent.
  `claimChain` is now `claimChainIfPossible`: read, decide (already-recorded
  / occupied / free), and write happen in one synchronous call with no I/O in
  between, so the occupancy check is against the same read that produces the
  write, not a stale one taken before `worktreeAdd` ran. `decidePlacement`
  calls it once for the in-place attempt and, if that reports "occupied",
  again after creating the new worktree — reusing the location a concurrent
  call for the *same* chain won in the meantime rather than stranding this
  call's own freshly-created (now orphaned) worktree as the recorded one.
  This narrows the remaining race to this function's own read+write (no
  slow I/O in between) rather than eliminating cross-process concurrency
  entirely — no file locking was added, consistent with `docs/agent-contract.md`'s
  "the core stays boring" stance against adding coordination machinery for a
  window this narrow.
- New tests: `test/worktree-plan.test.js` gained two direct tests of
  `claimChainIfPossible`'s three-way semantics — a second, different chain
  cannot also claim a location the first chain just claimed, and claiming
  the same chain twice reuses the first recorded location instead of
  overwriting it. `npm test`: 529/529 green (was 527/527).
- Documented one residual, already-accepted-as-implementer's-call behavior
  the review flagged: if a dependent story of a not-yet-placed chain runs
  before that chain's root ever does, the new worktree's name/branch is
  taken from the *triggering* story, not the chain's root story — unchanged
  from the original implementation, `plan.md`'s Decisions section already
  scopes worktree naming as per-story by design.

**Post-review fixes (`/flow-review`, third pass, 2026-08-28)**: the previous
round's own characterization of the remaining race as "a few milliseconds, no
I/O in between" turned out to be wrong — verified by actually racing the
shipped `claimChainIfPossible` with two real, separate OS processes (not the
in-process sequential calls `test/worktree-plan.test.js` had until now),
which reproduced the failure reliably with realistic (tens-of-ms) disk
jitter, not a contrived timing hack:

- Root cause #1: `writeJson` (`bin/lib/util.js`) staged every write through
  the same fixed `<path>.tmp` name. Two processes writing the same
  `placementStatePath` around the same time could stage into and rename away
  the *same* tmp file from under each other — one call's write vanished from
  disk with no error even though its own `claimChainIfPossible` call returned
  `"claimed"` successfully; the other got a raw, unmapped `ENOENT` from
  `renameSync` instead of a placement result. Fixed: the staging file is now
  unique per call (`<path>.<pid>.<random>.tmp`), so a process's own rename
  can never be pulled out from under it by another writer.
- Root cause #2: even with unique staging files, `claimChainIfPossible`'s
  read-decide-write was still just a plain, unlocked read-then-write — the
  "few milliseconds" between them is real disk I/O
  (`mkdirSync`/`writeFileSync`/`renameSync`), not a memory operation, and two
  processes racing for two *different*, both not-yet-claimed chains could
  each read the same pre-write state and each write back a full-state object
  missing the other's entry, silently dropping a legitimate, non-conflicting
  claim — exactly what the spec's concurrency edge case forbids
  ("must not let one silently overwrite the other's recorded location").
  Fixed: `claimChainIfPossible`'s entire read-decide-write now runs inside
  `withPlacementLock`, a boring, dependency-free, per-epic exclusive lock
  (`fs.openSync(path, "wx")`, bounded retry, stale-lock takeover after 30s in
  case a holder crashed) — one process at a time per epic's placement state,
  held only for this function's own body, never across `worktreeAdd`/`npm
  install`. This does add the file locking the previous round's comment said
  was deliberately not added; the previous round's "the window is narrow
  enough not to matter" judgment is superseded by this round's reproduction,
  not by a change in the underlying "core stays boring" philosophy — a
  30-second stale-lock takeover and a bounded synchronous spin is still no
  daemon, no socket, no async coordination.
- New test: `test/worktree-plan.test.js` gained a test that spawns two real
  child processes racing `claimChainIfPossible` for two different chains of
  the same epic (with an injected write-to-rename delay to make the race
  deterministic rather than luck-of-the-scheduler); verified it fails against
  the pre-fix code (both a silently-dropped claim and an uncaught `ENOENT`,
  depending on timing) before confirming it passes against the fix.
  `npm test`: 530/530 green (was 529/529).

**Post-review fixes (`/flow-review`, fourth pass, 2026-08-28)**:

- `withPlacementLock`'s retry backoff (`bin/lib/worktree-plan.js`) was a
  CPU-spinning `while (Date.now() < until) {}` — the review flagged that this
  pins a core for the full 20ms on every retry instead of actually sleeping.
  Replaced with `Atomics.wait` on a throwaway `SharedArrayBuffer`: a real
  kernel-level blocking wait with the same synchronous, no-daemon shape (Node
  allows `Atomics.wait` on its main thread, unlike a browser). Behavior-
  preserving — same retry cadence and timeout, just without burning CPU while
  waiting. `npm test`: 530/530 green (unchanged count; no new test needed,
  this is a non-functional swap the existing race test already exercises).

**Post-review fixes (`/flow-review`, fifth pass, 2026-08-28)**:

- Closed the real gap the fourth pass's own review missed: `buildChainIds`
  (`bin/lib/backbone.js`) silently placed a story listed in `## Stories` but
  never mentioned anywhere in the dependency tree as its own lone chain — the
  "vice versa" half of the spec's own correctness edge case ("a story
  referenced by the dependency tree but missing from `## Stories` (or vice
  versa) — placement must fail loudly rather than guess a location").
  Reproduced directly (a 3-story epic whose tree only covers `s1 ── s2`, `s3`
  never mentioned): parsed clean with no error, `s3` silently became its own
  chain/worktree candidate — exactly the authoring-drift scenario (a story
  added to `## Stories` and forgotten in the hand-drawn tree, or vice versa)
  this edge case exists to catch. New `validateAgainstStories` (`backbone.js`)
  checks both directions from the raw tree text before any edge is trusted: a
  label the tree mentions that is not a real story (already covered, now
  checked earlier and reused for this), and a real story the tree never
  mentions at all (the new check). `buildChainIds`'s own now-redundant
  edge-based "outside ## Stories" check was removed — the invariant is
  established upstream in `parseBackbone` before `buildChainIds` ever runs.
- Fixed a stale `docs/DOGFOODING.md` entry the same diff had introduced: the
  2026-08-27 row's Resolution still read "Open. Proposed direction (not yet
  planned or coded)" despite this story being exactly that direction, shipped;
  the row also referenced a second "2026-08-27 entry above" (the epic-19
  incident) that was never actually added as its own row. Folded the epic-19
  detail into the same row's Problem text and updated Resolution to point at
  this story.
- Re-examined the residual concurrency note from the third/fourth pass ("a
  different dependent story of the same not-yet-placed chain... `result.path`
  ... the only realistic outcome is already-recorded"): confirmed correct on
  closer reading — `worktreeAdd`'s target directory is keyed by the
  *triggering* story's own name, not the shared chain id, so two different
  dependent stories of the same chain create two different directories and
  never collide on `worktreeAdd`'s `fs.existsSync(dest)` guard; the loser's
  own freshly-created worktree is left orphaned on disk (already documented,
  already accepted — no file-locking gap here). The only way to actually hit
  the `fs.existsSync` crash is the literal same story invoked twice
  concurrently, a degenerate duplicate-invocation case that failing loud on is
  correct behavior, not a design gap. No code change; noted here so it is not
  re-litigated.
- New tests: `test/backbone.test.js` gained a story-missing-from-tree case
  (fails loudly) and a standalone-paragraph case (epic-03's own `s3` shape —
  confirms mentioning a story as its own lone line in the tree is *not*
  treated as missing). `npm test`: 532/532 green (was 530/530).
- Verified end-to-end against a disposable throwaway git repo (created,
  exercised, and deleted in this pass, not committed anywhere): the drift
  scenario fails loudly through the real `ai-flow worktree place` CLI with a
  clear message; after fixing the tree, root/dependent/sibling placement and
  re-invocation-from-scratch all behaved exactly as the acceptance criteria
  require (in place, reused, new worktree with a `Reason:` line, and no
  duplicate worktree on a second call).

**Post-review fixes (`/flow-review`, sixth pass, 2026-08-28)**:

- `buildChainIds` (`bin/lib/backbone.js`) trusted the tree's edges to already
  run parent-before-child in `## Stories` order, which the hand-authored tree
  text has no way to guarantee: a reversed edge (`s2 ── s1` typed instead of
  `s1 ── s2`) made the chain-id loop look up `chainId.get(parent)` before
  `parent` had been visited, silently producing `undefined` for the child
  instead of failing — exactly the "guess a placement" failure this parser
  exists to avoid. New `validateEdgeOrder` checks every edge against `##
  Stories`' own order before any edge is trusted, alongside the existing
  `validateAgainstStories` checks. New tests: a reversed edge in both the
  flat and indented tree shapes fails loudly with a message naming the
  out-of-order pair.
- `decidePlacement` (`bin/lib/worktree-plan.js`) now fails loudly instead of
  silently reporting success when a freshly created worktree's own
  deterministic path is already recorded in the placement state for a
  *different* chain — only reachable via stale state (that chain's worktree
  was removed outside `ai-flow worktree` without clearing its recorded
  location, and this call's dest happened to land on the same path).
  Self-review of this same pass caught that the first version of this fix
  left the newly created, never-recorded worktree on disk when it threw,
  which would have silently blocked every later `worktreeAdd` at that exact
  path (its own `fs.existsSync` guard, which exits the process) — turning
  the error's own advice ("clear the stale entry and retry") into something
  that crashes instead of recovering. Fixed by removing the orphaned
  worktree (`git worktree remove --force`) before throwing, so the placement
  state is the only thing left for the caller to fix; if that cleanup itself
  fails, the error says so explicitly and gives the manual `git worktree
  remove` command instead of pretending the state edit alone will unblock
  the retry.
- New tests: `test/backbone.test.js` gained the two reversed-edge cases
  above. `test/worktree-plan.test.js`'s stale-placement-conflict test now
  also asserts the orphaned worktree directory is gone after the throw, and
  that clearing only the stale state entry (per the error's own advice) lets
  an immediate retry succeed and create a real worktree at the same path —
  proving the recovery path actually works, not just that the first call
  fails loudly. `npm test`: 535/535 green (was 532/532).

**Post-review fixes (`/flow-review`, seventh pass, 2026-08-28)**: two
non-blocking improvements from the same review, applied and committed:

- `worktreeAdd` (`bin/lib/worktree.js`) now returns `branchCreated` alongside
  `path`/`branch`/`root` (additive). The stale-placement-conflict cleanup in
  `decidePlacement` (`bin/lib/worktree-plan.js`) removed the orphaned
  worktree it had just created but left its branch behind — `git worktree
  remove` deliberately keeps branches (no commit lost), which is right for a
  worktree someone was actually using, but wrong for a branch this call
  alone created seconds earlier for a worktree that was never recorded
  anywhere and is now gone too: left behind, every stale-state conflict for
  the same story would accumulate one more throwaway branch pointing at
  nothing. Now deletes it too (`git branch -D`), but only when
  `branchCreated` is true — never a branch `worktreeAdd` reused, which
  predates this call and may carry real history. The cleanup-failure error
  message's manual-recovery instructions now include the branch command too
  when relevant.
- `ai-flow help --all` (`bin/lib/commands.js`) and the `worktree` subcommand
  error hint (`bin/lib/worktree.js`) were missing `lock`/`unlock`/`land`, and
  `place` (introduced by this story), from their command lists — a user
  mistyping a subcommand, or reading the full reference, saw `add`/`list`/
  `remove` as the only options. Added all four.
- Extended test: `test/worktree-plan.test.js`'s stale-placement-conflict test
  now also asserts the orphaned branch is gone after the throw (not just the
  worktree directory). `npm test`: 535/535 green (unchanged count — extended
  an existing test rather than adding a new one).

**Post-review fixes (`/flow-review`, eighth pass, 2026-08-28)**: independent
re-review (fresh contract from spec.md/plan.md, not the prior passes' own
reasoning) found no new correctness/security/test-coverage issues — confirmed
by running `npm test` (535/535), parsing this repo's own real `index.md`
directly, and exercising `ai-flow worktree place` end-to-end against a
disposable sandbox repo (in-place root, sibling worktree with `Reason:` line,
re-invocation reuse — all matched the acceptance criteria exactly). One
non-blocking doc gap: `templates/.claude/skills/flow-run/SKILL.md`'s new
placement step named `<epic-dir>` without saying how to derive it from
`<story-dir>`. Fixed: one line stating `<epic-dir>` is `<story-dir>`'s parent
directory, synced to `skills/flow-run/SKILL.md` via `ai-flow plugin sync`.

## Test Exemption

None — new behavior is covered directly (`test/backbone.test.js`,
`test/worktree-plan.test.js`), and `next.js`'s existing test was updated to
match its new suggested command.

### Rollback Notes

- All new files (`bin/lib/backbone.js`, `bin/lib/worktree-plan.js`,
  `test/backbone.test.js`, `test/worktree-plan.test.js`,
  `epics/epic-03-worktree-orchestration/`) can be deleted with no effect on
  anything else — nothing else imports them yet beyond `ai-flow.js`'s one
  new command branch and `next.js`'s one changed line.
- `worktreeAdd`'s new return value and new exports in `worktree.js` are
  additive; no existing caller's behavior changes.
- The one behavior change with a live effect: `next`'s tier-5 command
  wording. Reverting `bin/lib/next.js`'s one line restores the old
  suggestion.
- `writeJson`'s new unique-per-call staging filename (`bin/lib/util.js`) is
  behavior-preserving for every existing caller (`config.js`, `settings.js`,
  `harness.js`, `templates.js`, `worktree.js`'s own lock file) — none of them
  relied on the tmp file's exact name, only on the write being atomic once
  renamed. `worktree-plan.js`'s new `withPlacementLock` and its `.lock`
  sibling file are additive and scoped to `worktree place`'s own state
  directory; no other command touches that path.
- No data migration: `decidePlacement` only ever writes to a new file under
  `<git-common-dir>/coding-flow/worktree-plan/<epic>.json`, created lazily
  on first use; deleting it resets placement memory for that epic with no
  other side effect (a later call just re-derives from scratch).
