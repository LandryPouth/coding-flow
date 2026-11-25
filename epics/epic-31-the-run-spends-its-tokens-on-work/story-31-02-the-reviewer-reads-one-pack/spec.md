# Story 31-02 — The reviewer reads one pack

## User Value

A fresh reviewer gets the story in one bounded read: its contract, its own
diff, the functions it touched, and the findings of earlier rounds. It no longer
spends dozens of `git diff`, `grep` and `sed` calls rebuilding that view. In the
run, exploration calls returned 11.9 M characters, against 1 M for `verify` and
the tests. Each of those characters then stays in the agent's context for every
later turn.

## Requirements

- **`ai-flow review pack <story-dir|--story>`** prints:
  - the contract: the story's criteria, requirements and decisions, without
    the narrative sections;
  - the risk level;
  - the story's own diff since its start commit. Base merges are excluded, and
    so are generated files (`skills/`) and lockfiles, each listed by name;
  - the names of the changed functions, per file;
  - every earlier round's findings: open ones in full, closed ones as one line
    each.
- **Bounded output.** The default budget is 40,000 characters (`--budget`).
  Over it, the diff is cut per file, largest first. Each cut file keeps its
  hunk headers, and the pack prints the command that shows it in full:
  `ai-flow review pack --file <path>`. The contract and the findings are never
  cut.
- **`--blind`** leaves out earlier findings, so a reviewer can hunt blind first
  and ask for them afterwards (`--findings-only`).
- **`flow-review`** says to start from `ai-flow review pack --blind`, then read
  more only where a finding needs evidence. The epic-run reviewer brief says
  the same.

## Acceptance Criteria

- [ ] Given a story with merged-in base commits, then the pack's diff holds
      only the story's own changes, and lists the generated files and
      lockfiles it left out, by name.
- [ ] Given a diff over the budget, then the pack stays within it. Every file
      cut keeps its hunk headers, and the pack names the `--file` command.
      `--file <path>` prints that file's full story diff.
- [ ] Given `--blind`, then no earlier finding is printed. Given
      `--findings-only`, then only the findings are printed.
- [ ] Given a JavaScript file with changed functions, then the pack lists
      their names. Given a file in another language, then it lists hunk
      headers only, and says so.
- [ ] `flow-review` carries the paragraph above, `plugin sync` has been run,
      and its eval case covers starting from the pack.

## Edge Cases

- A binary file: listed by name with its size, never printed.
- A rename: printed as a rename with its edits.
- A story with no start commit recorded: the merge base with the base branch
  is used, and the pack says so.

## Out of Scope

- Judging the diff. The pack only prepares the read.
