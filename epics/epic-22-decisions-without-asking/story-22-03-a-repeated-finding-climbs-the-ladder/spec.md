# Story 22-03 — A repeated finding climbs the ladder

## User Value

A review finding the reviewers keep writing becomes a proposed convention
line, then a proposed lint rule or test, then a proposed gate — each step a
proposal a human accepts by editing the repo — so the house style is enforced
by the tool instead of re-found in every review.

## Requirements

- Findings carry a `category` (18-04 adds the field if absent; free text
  normalised to a slug).
- `ai-flow ladder` (machinery): lists categories seen in ≥ 3 distinct
  stories, with their current rung (`finding`, `convention`, `check`, `gate`)
  and the findings that justify the next step.
- `ai-flow ladder propose <category>` writes a proposal file
  `.coding-flow/proposals/ladder-<category>.md` with the next rung's draft:
  a one-line convention (refused if it restates the framework's default — the
  proposal must cite ≥ 3 findings and say what is non-standard), a lint rule
  or test sketch, or a gate config snippet.
- Acceptance is a human edit (convention line added to
  `docs/conventions.md`, rule committed, gate config changed); `ladder` detects
  the rung from the repo, records `ladder.promoted` with the commit.
- Vault mirror of proposals when configured (21-02).

## Acceptance Criteria

- [ ] Given a category in 3 distinct stories' findings, then `ladder` lists
      it at rung `finding` with the 3 findings.
- [ ] Given the same category in 2 stories, then it is not listed.
- [ ] Given `ladder propose`, then a proposal file with the cited findings
      exists and nothing else in the repo changed.
- [ ] Given the convention line added by a commit, then `ladder` shows rung
      `convention` and an event records the promotion.

## Edge Cases

- Category slugs that differ by wording: no automatic merging; the human may
  add an alias line in the proposal.

## Out of Scope

- Applying any rule automatically.
