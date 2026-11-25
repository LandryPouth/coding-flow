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
  folder) or that the project's own non-Markdown files name (code, config,
  tests: it writes, reads or installs it — matched as a whole path, not inside
  a longer name) is skipped. Limit, accepted: a test string that still names an
  old path hides it.
- **D5 — Suggestions are evidence first.** A rename git recorded (staged, then
  history, followed to a file that exists) wins; then a moved file whose base
  name is unique in the repository; then an edit distance of one in seven
  characters (a typo). On this repository no finding gets a suggestion, and
  none is wrong. `doctor` asks for no suggestion (count only).
- **D6 — One Markdown reader, linear.** `bin/lib/docs-markdown.js`: fences
  open at any indent (inside list items too) on three or more `` ` `` or `~`;
  indented code only outside a list and after a blank line; HTML comments
  across lines; code spans by matched backtick runs (one moving pointer per run
  length); links by a forward scan of `](`. No regex with nested or
  overlapping quantifiers; a 240 KB adversarial doc reads in about 0.6 s.
  Story 26-02's `todo.js` has its own scanner and had not landed when this
  story started: two readers of one concept, unified at the third (rule of
  three), noted for that story.
- **D7 — Exit 1 when anything is reported**, so 26-04's closure and CI can use
  it; `doctor` only warns (`docs_stale`), never fails.
- **D8 — `--changed <base>`**: the docs that name a path (a judged or skipped
  path span, or a link target) changed since base — committed, staged,
  unstaged or new (`git diff --name-only --no-renames <base>` plus untracked).
  A doc's own `#anchor` is not a mention. An unreadable base is an error.
- **D9 — Config keys are registered** (`docs.check.include` / `exclude` /
  `ignorePaths`, story 26-06's registry), and `ai-flow rules` prints them
  through `docsCheckSettings`, the reader the command uses. An empty or invalid
  list reads as unset.

## Test Plan

Fixture repo with a renamed file, a missing script, a broken anchor,
placeholders and URLs; `--changed`.

## Acceptance Traceability

- 1–5 → `test/docs-check.test.js`

## Commands

```bash
npm test
```
