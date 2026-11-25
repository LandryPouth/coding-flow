# Story 26-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/docs-check.js` (new), `bin/lib/doctor.js`,
  `bin/ai-flow.js`, tests `test/docs-check.test.js` (new) with a fixture
  repository.
- **Shared identifiers**: `docs.check.include`, `docs.check.exclude`,
  `docs.check.ignorePaths`.
- **Search anchors**: `git ls-files`, `package.json` workspace reading in
  `bootstrap`.
- **Scout pre-step**: no.
- **Areas to avoid**: rewriting docs.

## Decisions

- **Mechanical only**: three checks with near-zero false positives beat a
  fuzzy one nobody trusts.
- **D1 — Skip, never guess.** Whatever the check cannot judge is skipped, not
  reported: code blocks, HTML comments, front matter, placeholders (`<…>`,
  `…`, segments `NN`/`X`/`x`/`YYYY`/`name`/`slug`/`foo`/`bar`), globs, URLs,
  flags, home/env/absolute paths, bare names (no `/`), script calls that run
  elsewhere or whose package cannot be told, scripts in prose. The list is the
  `ai-flow docs check` row of `docs/rules-and-limits.md`.
- **D2 — "Is this a path of this repository?"** A path is judged only when its
  first segment exists at the root or in the doc's folder (so `apps/web/x.tsx`
  in a repo without `apps/` is another project's example). `./` and `../` are
  tried from the doc's folder and from the root, and judged only when both stay
  inside the repository (`../sibling-checkout/x` is not ours).
- **D3 — Not missing when it lives elsewhere in the repository.** A path that
  ends a tracked path after a `/` (a template, a fixture, a package:
  `docs/x.md` when `templates/docs/x.md` exists) is not reported. This is what
  makes a tool's own docs, which describe the projects it installs into,
  checkable at all.
- **D4 — Generated output is not stale.** A missing path git ignores (asked in
  one `git check-ignore --stdin` call after the scan, as a file and as a
  folder) is skipped, and so is one the project's **tracked code or config**
  names as a whole path (an allowlist of code and config extensions plus
  `Dockerfile`, `Makefile`…): it writes, reads or installs it. Never
  `.coding-flow/**` (every verify record lists changed and deleted files),
  notes, changelogs or untracked files — review round 1 found run records
  hiding 68 of 200 deleted paths on bethl. And never a path git recorded
  renamed or deleted — file or folder: history wins over a comment that still
  names it (review round 2: a Prisma comment and a generated tracked file hid
  bethl's renamed `address-projection.service.ts`). Limit, accepted: a code
  string naming a path git has no record of hides it.
- **D5 — Suggestions are evidence first.** One `git log -M --diff-filter=RD`
  (after `git diff HEAD` for uncommitted changes) gives each path's latest
  event: a rename is followed to a path that exists; a deletion gives
  `deleted in <sha>` and **no** look-alike; a folder is matched through the
  files recorded under it (deleted → `deleted in`, moved → its new place).
  Otherwise the one same-named file elsewhere (a move), else an edit distance
  of one in seven characters (an adjacent swap counts one) on the name among
  the folder's entries, or on the folder among the path's namesakes (round 2:
  a whole-path distance offered `page.tsx` for `gone.tsx`). An index by base
  name and by folder, not the whole tree: 900 findings over 30 000 files in
  4.7 s under a load of ~20. `doctor` asks for no suggestion (count only).
- **D6 — One Markdown reader, linear.** `bin/lib/docs-markdown.js`: fences
  open at any indent (inside list items too) on three or more `` ` `` or `~`;
  indented code only outside a list and after a blank line; HTML comments
  across lines; code spans by matched backtick runs (one moving pointer per run
  length); links by a forward scan of `](`. No regex with nested or
  overlapping quantifiers; a 240 KB adversarial doc reads in about 0.6 s.
  Story 26-02's `todo.js` has its own scanner and had not landed when this
  story started: two readers of one concept, unified at the third (rule of
  three), noted for that story.
- **D7 — Exit 0 clean, 1 findings, 2 when it cannot run as asked** (usage, an
  unreadable base, no doc under the paths given, a read error), so 26-04's
  closure and CI can tell "stale" from "broken"; noted in 26-04's tasks.
  `doctor` only warns (`docs_stale`), never fails.
- **D8 — `--changed <base>`**: the docs that name a path (a judged or skipped
  path span, or a link target) changed since base — committed, staged,
  unstaged or new (`git diff --name-only --no-renames <base>` plus untracked).
  A doc's own `#anchor` is not a mention. An unreadable base is an error.
- **D9 — Config keys are registered** (`docs.check.include` / `exclude` /
  `ignorePaths`, story 26-06's registry), and `ai-flow rules` prints them
  through `docsCheckSettings`, the reader the command uses. An empty or invalid
  list reads as unset.

- **D10 — A script call is checked in the package it runs in.** `-w` /
  `--workspace` (before or after `run`, for npm; pnpm hands flags after the
  name to the script) by package name or path, `--filter`, `--prefix` / `-C`
  / `--dir`, and a `cd <dir>` earlier on the line or in the same code block
  (read from the root; reset at each block). A `cd` out of the repository or
  to a variable, or a call on every package (`-r`, `--workspaces`), is not
  judged.
- **D11 — Placeholders are upper-case words only** (`N`, `NN`, `X`, `YYYY`,
  `MM`, `DD` between `/ . - _`): `epic-NN-name` is a pattern, `src/x-name.js`
  and `lib/slug.ts` are files. `path#anchor` / `path#L10` and a trailing `/`
  on a file are read as the path. Inside an indented code block (outside a
  list) a ``` is text, not a fence.


- **D12 — Route segments are folder names** (round 2). `[locale]`,
  `[[...slug]]`, `(group)` as a whole segment are judged like any folder; a
  bracket inside a segment (`[id].tsx`) is judged when the literal path
  exists and read as a pattern, not reported, when it does not.
- **D13 — Shell, kept simple** (round 2). A `cd` inside `( … )` ends at the
  closing parenthesis; `pushd` / `popd` keep a stack; a `#` starts a comment
  that is not read (so `# … from the root` does not reset a `cd`: accepted
  and documented). In a workspace, a `--filter` / `-w` naming no package is
  reported with the closest package name. Outside git the walk never starts
  at `/` and stops at 20 000 files.

## Test Plan

Fixture repo with a renamed file, a missing script, a broken anchor,
placeholders and URLs; `--changed`.

## Acceptance Traceability

- 1–5 → `test/docs-check.test.js`

## Commands

```bash
npm test
```

## Review round 1 (FAIL, 1 P1)

- P1 the code corpus counted `.coding-flow/runs/*.json` and any non-Markdown
  file → D4 (tracked code and config only); test "a stale path named only in
  a run record or a notes file is still reported".
- P2s fixed with a failing test first: script location (D10), `#fragment`,
  placeholder words and the trailing slash (D11), deleted paths and the
  suggestion index (D5), exit codes (D7), an indented ``` (D11). The
  `--changed` gap (a changed doc whose new link points nowhere) is kept as
  specified and noted in 26-04's tasks and in docs/rules-and-limits.md.

## Review round 2 (FAIL, 2 P1)

- P1-a a comment or generated tracked file naming a path git recorded as
  renamed hid it (bethl) → D4: history first; test "a path git recorded
  renamed or deleted is reported even when code still names it".
- P1-b Next.js route paths were never judged → D12; test "route segments like
  [locale], (group) and [...slug] are judged; a partial bracket or a glob is
  not".
- P2s with a failing test first: deleted and moved folders (D5), subshell /
  pushd / popd / comments and a filter naming no package (D13). The walk
  limit outside git (D13) has no automated test: a test cannot run at `/`.
  The pnpm short form is noted in 26-04's tasks as out of scope.

## Review round 3 (FAIL, 3 P1, on real docs)

- P1 `cd apps/web/` kept its trailing `/` and fell back to the root package
  → `movedTo` strips it (D13); test "a cd with a trailing slash runs the
  script in that package".
- P1 pnpm `--filter openapi-client` for `@workspace/openapi-client` → D10: on
  an exact miss, the one `@scope/<name>`; two sharing it → not judged; test
  "pnpm --filter without the scope …".
- P1 a moved or deleted top-level folder was never judged (D2 gate) → D2
  amended: a path whose first segment is gone is judged when git recorded an
  event for it (gated by a set of recorded first segments, then
  `recordedEvent`). Accepted cost: prose naming a folder "that no longer
  exists" is reported; written in docs/rules-and-limits.md. Not for `./` /
  `../` paths that leave the repository. Test "a top-level folder git recorded
  moved or deleted is judged".
- P2s, each with a failing test first: a lowercase `x`/`y`/`n` after a dash
  is a placeholder (D11; `x-name.js` still judged — a real `foo-x.js` is now
  skipped, accepted); scripts after a `cd` into a folder the repository does
  not have are not judged (D10); the walk outside git is breadth-first with
  `docs/` first and warns on stderr at the limit (D13); a lone same-named
  folder is suggested only under a parent of the same name, a lone same-named
  file still is (D5).

## Review findings

### Round 3 — FAIL (real docs: bethl, tradescript, tse-binam)

- [x] P1 docs-check.js:317-322 movedTo — `cd apps/web/ && npm run dev` (trailing slash) keeps the `/`, misses the package, falls back to root → false `script dev`. Fix: strip trailing `/`; test.
- [x] P1 docs-check.js:394-397 packageFor / :411-416 scriptFindings — pnpm `--filter openapi-client` with package `@workspace/openapi-client` reported as a missing package (pnpm: scope optional). Fix: on an exact miss, match the name after `/`; skip when two packages share it; then judge the script in that package. Test both.
- [x] P1 docs-check.js:126-133 pathPlaces gate (D2) — a renamed/deleted top-level folder is never judged (`lib/` moved to `src/core/`; bethl `api/src/main.ts`). Fix: also judge a path whose first segment is absent when git history records an event for it. Trade-off noted in docs/rules-and-limits.md. Test.
- [x] P2 a lowercase `x` placeholder segment like `epics/epic-x/story-x-02-b` is judged (DOGFOODING.md:84) — only if `src/x-name.js` stays judged.
- [x] P2 `cd my-app` (folder absent from the repo) → don't judge scripts after a cd into an absent folder.
- [x] P2 the walk outside git is depth-first with a 20,000-file cap and can exhaust it before docs/ → breadth-first, `docs/` first; say on stderr when the cap was hit.
- [x] P2 a namesake-only suggestion (bethl `apps/admin` → `apps/web/app/[locale]/admin`) is weak → only suggest when the basename and parent context match.
