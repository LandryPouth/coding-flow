# Story 22-06 — A personal taste is proposed to each project

## User Value

The maintainer's engineering taste — naming, function and module size,
"deep modules over tiny abstractions", test habits, UI rules such as "one
accent colour" or "visible separators" — is written once, in the vault's
`preferences/` folder, and offered to every new or existing project as a
list of proposals the human accepts line by line. The project then holds its
own copy, so a teammate's agent sees it and the project can disagree with
the person. Two levels, never mixed: the person's taste (vault) and the
project's conventions (repo); the project wins.

Why: on bethl about 30 preferences were learned from corrections and live in
one agent's memory (22-04 moves the project ones); the personal ones are
re-learned on every new project. There is no universal "clean code" canon —
Clean Code's tiny functions contradict the deep-modules rule bethl's
`RULES.md` already states — so the tool learns *this* maintainer's choices
and lets each project overrule them.

## Requirements

- Vault layout (21-02): `preferences/<topic>.md` — one note per topic
  (`engineering`, `naming`, `testing`, `ui-design-system`, `workflow`), each
  rule a list item with an id, a one-line rule, a short why, tags (`stack:react`,
  `ui`, `api`…) and a status (`accepted`, `proposed`, `retired`). Written by
  the human; agents only propose (`coding-flow/proposals/`).
  `preferences/README.md` is the folder index (format, statuses, how to
  accept by hand) and is never parsed for rules; only lines outside fenced
  code blocks count.
- `ai-flow preferences propose` (machinery, `help --all`): reads the vault's
  `accepted` rules, filters by the project's detected stack (bootstrap scan
  tags), drops those already present in `docs/conventions.md` (by id), and
  writes `.coding-flow/proposals/preferences.md`: one checkbox per rule with
  its id, rule, why and the vault note it came from.
- Acceptance is a human edit: ticked items are copied by
  `ai-flow preferences accept` into `docs/conventions.md` with provenance
  `(pref:<id>)`; unticked ones are recorded as `declined` for this project so
  they are not proposed again.
- Conflict listing: a vault rule whose id is declined, or whose text a
  project line contradicts (same id, different text), is listed by
  `ai-flow preferences diff` — never resolved automatically.
- Nothing is loaded into an agent's context by default: the project copy is
  read like any convention (22-02 search), the vault never during a run
  (one way, 21-02).
- No vault configured: `propose` prints the one-line hint and succeeds.

## Acceptance Criteria

- [ ] Given a vault with 3 accepted rules (one tagged for another stack) and
      one proposed rule, when `preferences propose` runs in a React project,
      then the proposal file lists exactly the 2 matching accepted rules.
- [ ] Given a ticked and an unticked item, when `preferences accept` runs,
      then the ticked rule is in `docs/conventions.md` with `(pref:<id>)` and
      the unticked one is recorded as declined and not proposed again.
- [ ] Given a project line with the same id but a different text, when
      `preferences diff` runs, then both texts are shown side by side and
      neither file changes.
- [ ] Given no vault configured, when `preferences propose` runs, then it
      exits 0 with the one-line hint.
- [ ] Given the maintainer's vault and bethl (manual, recorded in
      `## Result`), when the flow runs, then the accepted and declined rules
      are listed.

## Edge Cases

- An example rule inside a fenced code block or in `README.md`: ignored.
- A rule without an id: skipped with a warning naming the note and line.
- Two vault notes defining the same id: refused, both locations named.
- A project that never runs `propose`: nothing changes; the taste stays
  personal.

## Out of Scope

- Writing to the vault's `preferences/` (human only).
- Team-level precedence between several people's profiles (24-06).
- Enforcing a rule: that is the ladder (22-03) and the check (22-07).
