# Story 32-01 — A ledger of every run

## User Value

The maintainer runs one command and gets a dated snapshot of every run on the
machine: tokens by project, story and role, rounds, verify time and red rate,
and the models used. It is compared with the previous snapshot, so a change in
how runs are driven shows up as a number, not an impression.

## Requirements

- **`node evals/bench/ledger.js snapshot [--since <date>] [--out <file>]`**
  reads, read-only, three sources:
  1. Claude Code transcripts under `~/.claude/projects/` (main sessions and
     `subagents/`);
  2. the OpenCode database (`session` table, through `node:sqlite`, opened
     read-only);
  3. `.coding-flow/runs/` evidence under the configured roots (default
     `~/dev`, depth 5, `node_modules` skipped).

  It writes one aggregate JSON snapshot.
- **Per project**, the snapshot records:
  - main-session tokens and turns;
  - per role (implement, review, other): agents, turns, tokens, context per
    turn and maximum context;
  - per story: agents, reviews and the implementer share;
  - the five most expensive agents;
  - tool-result characters by tool and by shell-command kind;
  - verify count, green rate, median and p90 duration, hours, and reuse;
  - review count, fails and P1s;
  - models used.
- **Context is recorded**: the snapshot date, the Claude Code version (from
  the transcripts), the Node version and the machine load when the snapshot is
  taken, so a model or harness change is not credited to the tool.
- **`ledger.js compare <a> <b>`** prints the differences per project and per
  role (tokens, context per turn, rounds per story, verify hours and red rate),
  each as an absolute change and a percentage. Runs below a minimum count are
  marked "too few runs" rather than compared.
- **`ledger.js save`** writes the snapshot and a short Markdown summary to the
  vault, under `workflows/epic-run/bench/<date>-snapshot.{json,md}`. It follows
  the vault contract (`AGENTS.md`): frontmatter, no absolute paths, project
  aliases only, and a commit `vault: bench snapshot <date>`.
- **Privacy:** no message content in any output. A test proves it with a marker
  string placed in fixture messages.
- `seed-extract.js` is replaced by this command. The 2026-11-25 baseline stays
  readable by `compare`.

## Acceptance Criteria

- [ ] Given fixture sources for two projects, when `ledger.js snapshot` runs,
      then each total equals the sum of the fixtures' `usage` fields and
      columns, per project and per role, and the agents with no story id are
      counted as unassigned.
- [ ] Given a marker string in the content of every fixture message, then it
      appears in no output file.
- [ ] Given the 2026-11-25 baseline and a new snapshot, when `compare` runs,
      then it prints the change per project and per role, and marks a
      dimension with fewer than the minimum runs as "too few runs".
- [ ] Given `save`, then the vault gets a JSON and a Markdown note with
      frontmatter and no absolute path, and a commit. Given `--dry-run`, then
      nothing is written.
- [ ] Given a missing source (no OpenCode database, `node:sqlite` unavailable,
      no transcripts), then the snapshot says which source is missing and
      exits 0.

## Edge Cases

- Truncated JSONL lines are counted and skipped.
- Transcript folders that were deleted: the snapshot only covers what exists,
  and says from which date.
- Worktrees: evidence under `*-worktrees/story-*` is attributed to its project
  through `git rev-parse --git-common-dir`, not pooled.

## Out of Scope

- Any `ai-flow` command. This is maintainer tooling.
