# Story 24-06 — A question finds its owner

## User Value

A `## Needs you` question reaches the person who owns its topic in
`autonomy.md`, not whoever runs the session; and the project's policy is told
apart from one person's preferences — project policy wins on any topic it
names, personal preferences (reply language, tone) stay in the user's global
config next to the vault path.

## Requirements

- Questions carry a `topic`; `/flow-next` and the run report group them by
  owner (`autonomy.md` `owner` column, 22-01); `ai-flow questions [--mine]`
  lists open questions, `--mine` matching the git user or the owner alias in
  the user's global config.
- `ai-flow answer <story> --question <n> --text "<…>"` records
  `question.answered` (who, when) and, when the topic allows, a decision with
  provenance `human` (22-02 registry), then marks the story ready again.
- Preferences: user global config `preferences` (free keys: `replyLanguage`,
  `tone`); skills read them for presentation only; `ai-flow decide` and
  policy lookups never read preferences.
- Precedence documented in `docs/agent-contract.md`: project policy >
  personal preference; preferences cannot change a level.

## Acceptance Criteria

- [ ] Given two questions with topics owned by different people, then
      `questions --mine` shows only the current user's.
- [ ] Given `answer`, then the event, the decision with provenance `human`
      and the story's readiness are updated.
- [ ] Given a preference trying to set a policy level, then it is ignored and
      `doctor` warns.
- [ ] Given `/flow-next`, then questions are grouped by owner; evals green.

## Edge Cases

- A topic with no owner: shown to everyone, labelled unowned.

## Out of Scope

- Notifications (Slack, email): later, once the event shape is proven.
