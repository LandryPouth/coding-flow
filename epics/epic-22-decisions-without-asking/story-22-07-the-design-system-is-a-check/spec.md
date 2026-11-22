# Story 22-07 — The design system is a check

## User Value

The house rules a reviewer keeps re-finding in UI and code — "no raw hex
colour, use the tokens", "separators stone-300 or darker", "modals through
`AppModal`", "search through the shared fuzzy module, never `includes()`",
"shadcn components before hand-made ones" — become declared, deterministic
checks that `verify` runs on the lines a story adds. The design system and the
conventions are then enforced by the machine at every story, not remembered
by one agent, and a teammate's diff meets the same bar.

Why: the research is plain — prose rules loaded into context give no
measurable gain and cost > 20 % more (ETH Zurich), while a check that fails
holds every time. This story is the `gate` rung of the ladder (22-03) for
everything a pattern can express, with zero runtime dependency.

## Requirements

- `config.json` `validation.conformance`: a list of rules
  `{ id, files (glob), forbid (regex), allowIn (globs, optional), message,
  source (convention id or note), mode: "warn" | "block" }`.
- `verify` evaluates each rule on the **added lines** of the story's diff
  only (the same diff scope verify already computes), so existing code never
  blocks a story; `ai-flow conformance --all` (machinery) scans the whole
  tree for a report, never as a gate.
- A hit prints `file:line`, the rule id, the message and the source; `warn`
  hits are listed in the evidence, `block` hits make verify red like a
  failing command.
- A new rule starts as `warn` unless the human writes `block` (it pairs with
  23-03's shadow mode when that lands: hits are counted before they block).
- A line may opt out with an inline `conformance-ignore <id>: <reason>`
  comment; the reason is copied into the evidence.
- `ai-flow ladder` (22-03) shows a category at rung `gate` when a
  conformance rule cites it as `source`.

## Acceptance Criteria

- [ ] Given a `block` rule forbidding `#[0-9a-fA-F]{6}` in `*.tsx` and a
      story adding such a line, when `verify` runs, then it is red and names
      the file, line, rule id and source.
- [ ] Given the same rule and an existing (not added) offending line, when
      `verify` runs, then it is green.
- [ ] Given a `warn` rule hit, when `verify` runs, then it is green and the
      hit is listed in the evidence.
- [ ] Given an offending line with `conformance-ignore <id>: <reason>`, when
      `verify` runs, then it is green and the reason is in the evidence.
- [ ] Given a file matched by `allowIn` (e.g. the token definitions), when
      it adds the pattern, then no hit is reported.
- [ ] Given bethl (manual, recorded in `## Result`), when the rules for raw
      colours, light separators, raw `Dialog` and `includes()` search are
      declared, then `conformance --all` reports the existing count and a
      sample story shows the added-line behaviour.

## Edge Cases

- An invalid regex or glob: `verify` refuses with a tool error naming the
  rule — never silently skips it.
- A renamed file: only lines the diff marks as added count.
- Binary or generated files (lockfiles, `dist/`): excluded by the existing
  verify ignore list.

## Out of Scope

- AST-level rules: projects keep ESLint/ast-grep in `validation.quality`.
- Visual review of rendered screens.
- Proposing rules automatically (22-03 proposes; the human writes them).
