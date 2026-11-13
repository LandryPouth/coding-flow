# Story 25-02 — A fresh process walks the checklist

## User Value

In a driven run, a UI story whose project has no browser command still gets
looked at: after verify is green, a separate agent process opens the served
app, follows the story's `## Browser Check` with a declared test account,
and records for each item what it observed. An item it cannot confirm sends
the story back to the implementer like a red test.

## Requirements

- Trigger: driven run, the risk requires the `browser` tier (19-06), no
  `validation.tiers.browser.command`, and a non-empty `## Browser Check`.
- The app is served as in 25-01. The walker is a fresh `claude -p` process
  with browser tools only (an MCP browser server allowed by name), no
  `Edit`/`Write`/`Bash`, no sub-agents (20-01); it takes an agent slot
  (24-02).
- **Test accounts**: `testAccounts` in `config.json` lists roles and the
  name of an env variable per role (e.g. `{ role: "agent", env:
  "E2E_AGENT" }`); values come from an ignored local file
  (`worktree.copyFiles`). The walker is told the role and the variable
  name, never the value. A story naming an undeclared role is not ready.
- The walker returns through `--json-schema` (one entry per checklist
  item: `observed` or `not confirmed`, with its text), per item: `observed YYYY-MM-DD — <what it saw>` or
  `not confirmed — <why>`. The CLI writes those lines under the item (the
  walker never edits files); all confirmed → the tier passes.
- Any `not confirmed` → the story returns to the implementer with the
  walker's text as the failure (one 20-03 attempt), then the walk reruns.
- Screenshots, if the tool takes them, stay in the run's local directory,
  never in the repository.
- Events `browser.walk.start`, `browser.walk.item`, `browser.walk.end`.

## Acceptance Criteria

- [ ] Given a driven UI story without a browser command, when verify is
      green, then a walker process starts with browser tools only and no
      edit tools.
- [ ] Given the walker's report with every item observed, then the CLI
      writes the `observed` lines and the tier passes.
- [ ] Given one `not confirmed` item, then the implementer gets one attempt
      with that text and the walk reruns after.
- [ ] Given a declared account, then the walker's prompt and the run's
      events name the role and variable, never the value.
- [ ] Given a story naming an undeclared role, then it is not ready and the
      run says which role.
- [ ] Given one real walk on a throwaway bethl story (manual, recorded in
      `## Result`), then the observed lines match what the maintainer sees.

## Edge Cases

- The walker crashes or times out: the tier is `open`, not passed; one
  restart, then `Needs you`.
- The browser MCP cannot run headless on this machine: preflight refuses
  browser walks and the run continues with the tier `open`.

## Out of Scope

- Writing e2e tests from the walk (a later proposal for epic 23).

## Security

- Credentials: env variable names only in prompts, logs and events; values
  from an ignored file; the guard keeps denying `.env` reads to the walker.
- The walker is read-only on the repository; its report is data the CLI
  writes, never instructions it follows.
