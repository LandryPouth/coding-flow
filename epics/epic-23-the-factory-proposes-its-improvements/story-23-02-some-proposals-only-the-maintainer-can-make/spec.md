# Story 23-02 — Some proposals only the maintainer can make

## User Value

A proposal that would relax a gate, delete or weaken a test, raise a budget,
widen permissions or touch production is classified `maintainer-question`
mechanically — whatever the watcher wrote — so the tool can never present a
change to its own judge as routine. This is the line the Darwin Gödel Machine
crossed when it faked test logs and bypassed its hallucination detector.

## Requirements

- `ai-flow proposal check <id>` (also run by `proposal write`): inspects the
  `change` field and sets `kind`:
  - diff hunks touching gate code or config (`coverage-gate.js`,
    `guard.js`, `harness.json` gates, `validation.*`, `verify.*`),
    test files (deletions, `.skip`, `.only`, weakened assertions — reuse
    `weakened-tests` detection), `run.budgetUsd.*`, `run.maxTurns.*`,
    `--allowedTools`, `permission-mode`, guard deny lists, ship/push/deploy
    code → `maintainer-question`;
  - an edit list (not a diff) naming any of those paths or keys →
    `maintainer-question`;
  - unparsable change → `maintainer-question` (fail closed);
  - else `routine`.
- A `maintainer-question` proposal cannot be accepted with `proposal accept`
  alone: it needs `--i-am-the-maintainer` plus a `--why`, recorded.
- `proposal list` shows maintainer questions first.
- The watcher skill states the rule, but the classification never trusts it.

## Acceptance Criteria

- [ ] Given a diff lowering a coverage threshold, then `kind:
      maintainer-question` even if the note says `routine`.
- [ ] Given a diff adding `.skip` to a test, then `maintainer-question`.
- [ ] Given an edit list naming `run.budgetUsd.story`, then
      `maintainer-question`.
- [ ] Given an unparsable change, then `maintainer-question`.
- [ ] Given a docs-only diff, then `routine`.
- [ ] Given `proposal accept` on a maintainer question without the flag and a
      why, then it refuses.

## Edge Cases

- A diff renaming a gate file: counts as touching it.

## Out of Scope

- Deciding whether the proposal is good.

## Security

- **Trust boundary**: the proposal text is untrusted (written by a model);
  classification is by path and key patterns, never by the note's claims.
- **Fail closed**: anything unparsable or unknown is a maintainer question.
- **Self-modification**: no proposal is applied by the tool; this story
  only labels and gates acceptance.
