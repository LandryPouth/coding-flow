# Story 26-03 — Tasks

## Status: in-progress

- [x] Path, script and link checks with suggestions.
- [x] `--changed <base>`, doctor line, config keys.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Result

`ai-flow docs check [--json] [--changed <base>] [paths...]` (`bin/lib/docs-check.js`,
Markdown reading in `bin/lib/docs-markdown.js`), the `docs_stale` doctor warning,
and the three `docs.check.*` keys in the rules registry (printed by `ai-flow rules`).
Decisions D1–D9 in plan.md; skips and limits in the `ai-flow docs check` row of
`docs/rules-and-limits.md`. No doc was changed by this story.

### Run on this repository (36 docs, 33 findings, no look-alike offered)

Judged one by one. Before the skip rules D2–D5 the same run gave 94 findings,
63 of them paths of the projects Coding Flow installs into (`.claude/skills/`,
`docs/AUDIT.md`, `docs/project-context.md`…) or placeholders (`epic-NN-name`).

- **Stale, worth a fix (9)** — links and names of epics archived by 17-04:
  `README.md:90` (a link into epic 10's story 10-03),
  `docs/design-decisions.md:357` and `docs/plans/multi-agent-install.md:77`,
  `:129` (epic 01), `docs/DOGFOODING.md:88-91`, `:99` (epics 04–09, in the
  dated log, so arguably history).
- **Named on purpose, never made (12)** — refused alternatives and planned
  files: `docs/design-decisions.md:176` (`docs/skill-anatomy.md`, refused),
  `:657` (`epics/archive/`, refused); `docs/plans/autonomous-factory.md:80`,
  `:158`, `:166`, `:253`, `docs/plans/orchestration.md:48`,
  `docs/plans/multi-agent-install.md:165`, `:207`, `:259`;
  `docs/rules-and-limits.md:197`, `:292` (Part 2, planned).
- **Paths of an installed project (4)** — `README.md:139`
  (`.opencode/command/coding-flow/`, the pre-0.11 layout an upgrade moves),
  `README.md:241` (`docs/recovery/map.md`, written by `/flow-recover`), and the
  `flow:doctor` / `flow:verify` scripts `init` adds to a project's package.json
  (`README.md:384`, `docs/plans/brownfield-honesty.md:176`).
- **Quoted output (1)** — `docs/DOGFOODING.md:84` quotes an error naming a
  test's throwaway path (`epics/epic-x/story-x-02-b`): judged since round 1
  (lower-case placeholder words are names now).
- **Research notes (7)** — `docs/research/**`, quoting other projects.

Ten findings say `deleted in <sha>` — the archived epics' files and folders
(`README.md:90`, `DOGFOODING.md:88-91`, `:99`, `design-decisions.md:357`,
`multi-agent-install.md:77`, `:129`) and `multi-agent-install.md:207`; none
gets a look-alike.

Follow-up (not in this story): fix the 9 archived-epic references, and give
this repository a `docs.check` config — `exclude: ["docs/research/**"]` and an
`ignorePaths` for the planned names — so its own `docs check` is clean.

### Rollback Notes

New command and modules only; `doctor` gains one warning. Revert the commit:
no file format, proof or config written by earlier versions changes.

## Acceptance Traceability

1. test/docs-check.test.js::a backticked path renamed since is reported with its line and the new path as suggestion
2. test/docs-check.test.js::pnpm --filter <pkg> run <script> with no such script in that package is reported
3. test/docs-check.test.js::a link to another doc with a missing anchor is reported; a good anchor and a missing file are told apart
4. test/docs-check.test.js::placeholders, URLs, globs and paths of another project are never reported
5. test/docs-check.test.js::--changed <base> checks only the docs that mention a file changed since the base
