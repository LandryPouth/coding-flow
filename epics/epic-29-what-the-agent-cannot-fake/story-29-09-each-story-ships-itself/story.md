# Story 29-09 — Each story ships itself

## Why

Once every story is reviewed and proven by agents, waiting for a large chunk
before opening a PR only delays CI on the platforms the machine cannot run.
On 2026-11-25, a single Windows failure held one develop → main PR for more
than 15 hours, because it bundled days of work. The maintainer now runs one PR
per story, auto-merged on green, and asked on 2026-11-25 that the tool offer
the same: "oui écris-la et implémente-la. Et pour moi mets le défaut pareil que
l'automatisation que tu run actuellement".

## Design

- **A `ship` setting**: `"manual"` (default — today's behaviour: `ship` is a
  step the user runs), `"story"` or `"epic"`.
  - **`story`**: when `flow-run` closes a story (green verify, review
    captured, status done), it runs `ai-flow ship` for the story's branch and
    arms auto-merge on that PR. It still lands through the PR, never by a local
    merge.
  - **`epic`**: what `autoMergeEpic: true` does today. `autoMergeEpic` stays
    readable as an alias (`true` → `epic`). `doctor` names the new key.
- **The protection gate holds.** Auto-merge is armed only on a base with
  required checks (story 29-08). If the base is unprotected and cannot be
  protected, the PR opens without auto-merge and the output says so.
- **Order inside an epic.** With `story`, a story's PR is not armed while an
  earlier story *it depends on* (the epic's dependency tree) still has an open
  PR. Siblings with no edge between them ship independently. Without a tree,
  directory order applies, as today.
- **After the merge.** `ai-flow worktree land` (and `autoland`) recognize a
  story whose PR was merged: they fast-forward the base and remove the
  worktree and branch, without merging again.
- **The flow-run skill** reads the setting and says which mode it is in at
  closure.
- **This repository uses `"story"`** in its `.coding-flow/config.json`. That
  is the maintainer's choice; the default for everyone else stays `manual`.

## Acceptance Criteria

- [ ] Given `ship: "story"` and a protected base (stubbed `gh`), when a story
      closes, then `ship` opens one PR for its branch with the proof attached and
      arms auto-merge, and nothing is merged locally.
- [ ] Given `ship: "manual"` (or no setting), then closing a story opens no PR,
      as today.
- [ ] Given `autoMergeEpic: true` and no `ship` key, then the behaviour is
      `epic`, and `ai-flow rules` shows where it came from.
- [ ] Given `story` mode and a story whose dependency (tree edge) has an open
      PR, then its PR opens but auto-merge is not armed, and the output names
      the blocking story. Given a sibling with no edge, then it is armed.
- [ ] Given an unprotected base that cannot be protected, then the PR opens
      without auto-merge, and the output says why.
- [ ] Given a story whose PR was merged on GitHub, when `worktree land` runs,
      then the base fast-forwards to the remote, and the worktree and branch are
      removed, with no second merge.
- [ ] This repository's `.coding-flow/config.json` has `"ship": "story"`, and
      `ai-flow rules` shows it.

## Out of Scope

- Merging without CI, or without the tool's own review and verify gates.
- Forges other than GitHub.

## Commands

```bash
npm test
```

## Status: planned

## Result
