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
  hiding 68 of 200 deleted paths on bethl. Limit, accepted: a code or test
  string that still names an old path hides it.
- **D5 — Suggestions are evidence first.** One `git log -M --diff-filter=RD`
  (after `git diff HEAD` for uncommitted changes) gives each path's latest
  event: a rename is followed to a path that exists; a deletion gives
  `deleted in <sha>` and **no** look-alike. Otherwise the one same-named file
  elsewhere (a move), else an edit distance of one in seven characters among
  the folder's entries and the path's namesakes (an index by base name and by
  folder, not the whole tree: 900 findings over 30 000 files in 4.7 s under a
  load of ~20). `doctor` asks for no suggestion (count only).
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
