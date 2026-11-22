# Story 22-05 — A run that worked becomes a playbook

## User Value

When a story type keeps succeeding the same way — first-pass green, no
`Needs you`, no escape — the tool proposes a playbook (the steps, files and
checks that worked) for that type; once a human approves it, `/flow-plan` and
`/flow-run` can cite it for the next story of that type.

## Requirements

- Candidate detection from insights: ≥ 3 done stories sharing a `type` tag
  (story line `Type:` written by `/flow-plan`, e.g. `crud-endpoint`,
  `ui-section`) with first-pass yield, zero escapes in 14 days.
- `ai-flow playbook propose <type>` drafts `.coding-flow/playbooks/<type>.md`
  (status `proposed`): steps, typical files, required tiers, pitfalls from
  findings; sources listed.
- `ai-flow playbook accept <type>` (human) sets `accepted`; mirrored to the
  vault `coding-flow/playbooks/` (21-02) with the project alias.
- `/flow-plan` cites an accepted playbook in the story's plan when the type
  matches; `/flow-run` reads it only when cited (never preloaded).

## Acceptance Criteria

- [ ] Given 3 qualifying done stories of one type, then `playbook propose`
      writes a proposed playbook citing them.
- [ ] Given a story with an escape, then it does not qualify.
- [ ] Given a proposed playbook, then `/flow-plan` does not cite it; given
      accepted, it does.
- [ ] Given `playbook accept`, then the vault copy exists when a vault is
      configured.

## Edge Cases

- A playbook whose type later has escapes: `insights` flags it for review;
  it is never auto-demoted.

## Out of Scope

- Cross-project playbook adoption (epic 23 proposes it).
