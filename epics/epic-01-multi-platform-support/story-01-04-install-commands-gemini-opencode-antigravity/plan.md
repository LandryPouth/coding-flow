# Plan — Story 01-04

## Implementation Context

- **Execution mode**: STANDARD — three similar renderers, no security
  surface (no guard), moderate risk concentrated in escaping bugs.
- **Scout pre-step**: no — the shape is already fully validated in the
  reference implementation; this is adaptation, not discovery.
- **Likely files**: `bin/lib/platforms/gemini.js`, `opencode.js`,
  `antigravity.js` (new), `bin/lib/config.js` (extend `TARGETS`),
  `bin/ai-flow.js` (extend `--target` validation), `bin/lib/doctor.js`
  (the "guard not available" informational line).
- **Reference (adapt, not copy)**: `~/dev/tools/ai-learn/bin/lib/platforms/
  {gemini,opencode,antigravity}.js` — read all three in full before writing
  anything; they already encode real, empirically-found format constraints
  (e.g. Gemini's TOML has no other fields, Antigravity's YAML needs quoted
  descriptions).

## Technical notes

- Do not invent a new escaping scheme — port the exact `escapeToml`/
  `escapeYamlDoubleQuoted` logic from the reference files, since they were
  arrived at by hitting real parser failures, not by inspection.
- This story does not touch `bin/lib/guard.js`, `codex-settings.js`, or the
  probe from stories 2–3 at all — if a diff for this story touches any of
  those files, that's a scope signal to stop and re-check the dependency
  tree (this story is meant to be parallel-safe with `s2`→`s3`).

## Decisions

All three are **project-scoped** (an install must not write to the user's home):

- Gemini: `.gemini/commands/coding-flow/<name>.toml`, invoked `/coding-flow:<name>`. Not exercised
  against the `gemini` binary; the format is ai-learn's validated one.
- OpenCode: `.opencode/command/coding-flow/<name>.md`, invoked `/coding-flow/<name>`. **Verified with
  the real `opencode` 1.19**: `opencode debug config` in a throwaway project lists all 7 as
  `coding-flow/flow-*`, so project-scoped files are discovered.
- Antigravity: `.agent/skills/<name>/SKILL.md`. **Unverified**: the workspace path comes from
  Antigravity's documented workspace-skills convention, not from a run against the product.
- TOML prompt is a `'''` literal string (skills contain backslashes); only a body that itself holds
  `'''` falls back to an escaped `"""` string.
- doctor reports the gap as a `notes` entry, separate from `errors`/`warnings`, so `--strict` can
  never turn a permanent, known gap into a failure.

## Test plan

- One test file per platform (`test/platform-install-gemini.test.js`,
  `-opencode.test.js`, `-antigravity.test.js`), each: init writes valid
  files (parse-checked with a strict parser for TOML/YAML), a description
  containing `:`/`"`/`\` survives round-trip, `target` is recorded,
  `doctor` shows the informational (non-error) guard-gap line, `report`'s
  `## Platform coverage` shows `commands-only`.
- Reuse `~/dev/tools/ai-learn/test/integration-opencode.test.js`'s
  `{skip: !available}` pattern for a real-binary OpenCode integration check
  if one is added — optional for this story, the offline parse-check tests
  are the required bar.

## Acceptance traceability

| Criterion | Test |
|---|---|
| Gemini TOML valid + target recorded | `test/platform-install-gemini.test.js` |
| OpenCode markdown valid + target recorded | `test/platform-install-opencode.test.js` |
| Antigravity YAML survives `:` in description | `test/platform-install-antigravity.test.js` |
| doctor shows non-error guard-gap line | each of the three test files |
| report shows commands-only tier | each of the three test files |

## Commands

```
npm test
```
