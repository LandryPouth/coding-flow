# Story 26-07 — Plan

## Implementation Context

- **Execution mode**: STANDARD — reads story files, edits one checkbox, adds a
  PR body section; no new trust boundary.
- **Likely files**: `bin/lib/todo.js` (26-02's reader: add `## Human to-do`,
  `when`, ids, `done`), `bin/lib/next.js` (We need you block, `--json`),
  `bin/lib/status.js` (header line), `bin/lib/ship.js` (PR body section),
  `bin/lib/worktree.js` (land/autoland print), `bin/lib/verify` path and
  `bin/lib/doctor.js` (`todo.uncaptured`, `when` and secret checks),
  `bin/lib/guard.js` (reuse secret patterns), `bin/ai-flow.js` (`todo done`),
  skills `flow-plan`, `flow-run`, `flow-review`, `flow-next` and their
  `templates/.claude/skills/` copies, `docs/rules-and-limits.md`.
  Tests: `test/todo.test.js`, `test/next.test.js`, `test/ship.test.js`,
  `test/doctor.test.js`.
- **Shared identifiers**: `## Human to-do`, `(before: deploy|next-story|later)`,
  `todo.uncapturedPatterns`, `todo.uncaptured`, `needsYou`, `We need you`.
- **Search anchors**: `buildQueue`, `Nothing waiting on you`, `TIER_LABELS`,
  `prBody`, `Needs you`, `Owner:`, `withFileLock`, secret patterns in `guard.js`.
- **Scout pre-step**: no.
- **Areas to avoid**: the tier order of `next` (unchanged); 24-06 routing;
  blocking ship or land.

## Decisions

- **A block above the queue, not a tier.** A human to-do has no command to
  run, and the tiers rank commands. Folding to-dos into tier 1 would hide the
  next command behind something the tool cannot do; printing them first, apart,
  keeps both visible. (Maintainer, 2026-11-14: "`next` should have a section
  that says we need you".)
- **`when` instead of priority.** The only question that matters for a fast
  maintainer is "before what?": deploy, the next story, or nothing. It also
  decides where the item is repeated (ship and land for `deploy`).
- **Warn, never block.** Ship, land and verify keep their meaning; to-dos are
  said where the work leaves the machine. Blocking would push agents to tick
  boxes they cannot check.
- **Capture is the hard part.** 26-02 reads headings; bethl shows the dangerous
  items were never under one. Hence the skills write them at once, and the
  uncaptured-prose warning catches the rest — mechanical, phrase list in
  config, no LLM.
- **Every epic of the checkout, landed included**, for `next`'s block only:
  `before: deploy` items outlive the land by design.

- **D1 — `todo.js` stays the one reader.** `## Human to-do` items, ids,
  masking, `todo done`, the needsYou list and the uncaptured check all read
  through 26-02's `scanMarkdown`; the scanner now keeps each block's line
  number (to tick a checkbox where it is and to name a warning's line). No third
  Markdown reader.
- **D2 — `when` of the other kinds.** A `## Needs you` question and a ready
  `Owner: human` story block the chain → `next-story`; a `todo.headings` item
  has no deadline → `later`; deferred `[~]` criteria are a debt, not an action,
  and stay in `ai-flow todo` only.
- **D3 — The block's cap.** 5 lines from `deploy` then `next-story`; `later`
  items are never listed one by one. When the urgent items overflow, the count
  line says both: `+ 3 more, 1 later — ai-flow todo`. `We need you (N)` counts
  everything listed in `needsYou`.
- **D4 — Ids.** 7 hex characters of sha1(epic, story, normalized text without
  the `(before: …)` prefix): changing `when` keeps the id, editing the text
  changes it. Every listed item has one; only checkbox items (`## Human to-do`,
  `todo.headings`) can be ticked by `todo done`. An id naming two items (the
  same text twice in one story) is refused with both locations.
- **D5 — `todo done` writes under a lock in the git dir**
  (`<git-common-dir>/coding-flow/todo.lock`, `.coding-flow/todo.lock` outside
  git), never next to the story file, and re-checks under the lock that the line
  is still that open checkbox. It keeps CRLF.
- **D6 — Masking is applied when the items are collected**, so `todo`, `next`,
  `--json`, `status`, `ship` and `land` can only print the masked text; the id is
  computed from the raw text (a hash: it leaks nothing). The patterns are the
  project's `secretPatterns` from `harness.json` (the guard's own); doctor
  errors (`todo_secret`) only for checkbox items, where a value would be acted on.
- **D7 — Uncaptured prose** reads every block under a `Result` heading
  (sub-headings such as `### Rollback Notes` included) of the story's files,
  outside code and comments, and only when the story has no open
  `## Human to-do` item. Each `todo.uncapturedPatterns` entry is a
  case-insensitive regex (`before (the )?deploy`); a broken entry is skipped.
  On this repository the defaults raise 0 warnings. `verify` prints it from the
  command layer (`bin/ai-flow.js`, after the verdict, not with `--json` or
  `--dry-run`): the verify core may not require `todo.js` (test/layering: a core
  module never depends on a layer one; test/security-core-risk: everything the
  verify core requires is a high-risk path). So the warning is not recorded in
  the evidence — it is advice, not proof.
- **D8 — "Stories in the branch" for ship**: the story named after the branch,
  plus every story whose files the branch changed since the base
  (`git diff --name-only base...HEAD`). The PR body section sits between its own
  markers, is replaced on each ship and removed when no item is left; an
  unchanged body is not re-edited.
- **D9 — Epic closure (26-04) is not shipped**: its print is a task in 26-04
  (`openDeployTodos` + `printDeployTodos`).
- **D10 — 26-01's open risks and browser checks in `ai-flow todo`**: skipped,
  26-01 has not landed (its register does not exist yet).
- **D11 — One 26-02 test changed on purpose.** `todo.test.js` "an extra argument
  is refused" pinned `todo done` as an unknown argument; `done` is now this
  story's subcommand. The test now asserts another word (`list`) is refused and
  that `todo done` without its id is refused with its own message.

## Test Plan

Fixture project with: a story `## Human to-do` of each `when`; an epic index
with a heading from `todo.headings`; a landed epic with an open `deploy` item;
a `## Needs you` story; an `Owner: human` ready story; a `## Result` with
"avant le déploiement" and no item; a to-do with a secret-looking value.
Assert `next` text and `--json`, `todo done` diff (one line), `ship` PR body
(dry-run), verify warning, doctor error and masking.

## Acceptance Traceability

(Moved to tasks.md, one line per criterion, with the tests as written.)

## Commands

```bash
npm test
```

## Review findings

### Round 1 — FAIL (secrets, real projects)

- [x] P1 todo.js uncapturedTodoLines/printUncapturedTodos + doctor todo_uncaptured — the uncaptured-prose warning printed the raw `## Result` line unmasked (a live Stripe key in full in `verify --story` and `doctor`). Fix: mask with the project's secret patterns in uncapturedTodoLines; test with a key built at run time. Fixed: `uncapturedTodoLines` masks each line with `secretPatternsOf(root)`; test "the uncaptured warning masks a secret of the Result line, in verify and in doctor".
- [x] P2 `## Needs you` option sub-items were never masked (an AWS key showed in `todo` and `todo --json` options) — mask options in finishItem; test. Fixed in `finishItem`; test "the options of a Needs you question are masked in todo and todo --json".
- [x] P2 `todo done` re-checked only "some open checkbox" under the lock — compare the parsed text under the lock; refuse if it changed; test. Fixed: under the lock the item starting on that line is re-scanned and its id recomputed; a different id is refused ("changed since it was read"); test "todo done refuses when the line changed between the read and the lock".
- [x] P2 `todo done` had no `--dry-run` (hard rule: every write has one) — add it, printing the line it would tick and writing nothing; test. Fixed: `todo done <id> --dry-run` prints "Would tick …" and the ticked line, writes nothing; test.
- [x] P2 verify warned only with `--story`; use the story verify resolved implicitly too. Fixed: with no `--story`, `printUncapturedTodos` reads the active Spec Kit feature (the only implicit scope verify has, `speckit.detectFeature`); test.
- [x] P2 autoland → sayDeployTodos only announced the `--story` passed and an absolute path matched nothing — announce every story of the landed chain, paths made relative. Fixed: `chainStoryPaths` (worktree-plan.js) lists the chain's stories relative to the root; `openDeployTodos` makes an absolute path relative; test.
- [x] P2 noise: on a bethl copy doctor raised 63 todo_uncaptured warnings in 45 files, at least half from bare `in production`/`en prod(uction)?` and Rollback Notes sub-blocks — drop the bare defaults (keep phrases with an action verb), skip `### Rollback` sub-headings; test both. Fixed: bare phrases replaced by verb + `in production`/`en prod` patterns, `### Rollback…` sub-blocks skipped; test. This repository: still 0 warnings.
- [~] P2 default secret patterns miss `postgres://user:pass@` and JWTs — not done: the defaults are the guard's own (`harness-config.js`), so a change alters what the guard refuses on every write of every project; not low-risk inside this story. Added under epic 26's `## Follow-ups`.
