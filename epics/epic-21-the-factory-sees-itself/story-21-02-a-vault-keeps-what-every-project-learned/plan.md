# Story 21-02 — Plan

## Implementation Context

- **Execution mode**: STRICT — writes outside the repository; sanitization.
- **Readiness**: ready — vault `~/dev/.ai-memory-vault` given 2026-11-12
  (own private repo, already scaffolded: exercise `--adopt`).
- **Likely files**: `bin/lib/vault.js` (new), `bin/lib/vault-sanitize.js`
  (new), `bin/lib/config.js` (global config read/write), the existing secret
  detector module (search `secret`), `bin/lib/insights.js` (`--export`),
  `bin/lib/run.js` (end-of-run hook), `bin/ai-flow.js`, tests
  `test/vault.test.js`, `test/vault-sanitize.test.js` (new).
- **Search anchors**: `secret`, `globalConfig`, `homedir`, `writeJson`.
- **Scout pre-step**: yes — locate the secret detector and any existing global
  config path before writing.
- **Areas to avoid**: the guard (vault writes are the CLI's, not the agent's).

## Technical Notes

- Obsidian reads YAML frontmatter and `[[note]]` links; keep note names
  unique per folder (`<alias>-<epic>`).
- Write atomically (temp file in the same folder + rename).

## Decisions

- **Allowlist sanitizer**: a new field is dropped until it is declared safe.
- **A vault may be its own repository**: "inside a git working tree" is
  refused only when the repo root is not the vault itself, so a project repo
  can never become the vault while a dedicated vault repo can.
- **The CLI never runs git in the vault**: backup is the vault's concern
  (its post-commit hook), not a side effect of a run.
- **Global, not per-repo, path**: the vault is the maintainer's, shared by
  projects; nothing about it is committed.

## Test Plan

Temp folders for init/refusals; sanitizer table tests with hostile payloads
(output, abs paths, tokens); no-vault path; manual Obsidian check.

## Acceptance Traceability

- 1–2 → `test/vault.test.js::init`
- 3–4 → `test/vault-sanitize.test.js`
- 5 → `test/vault.test.js::absent vault`
- 6 → observed YYYY-MM-DD in `## Result` (manual, maintainer's vault)

## Commands

```bash
npm test
```
