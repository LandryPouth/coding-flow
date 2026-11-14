# Plan — 29-01 The diff is scanned

## Implementation Context

- Mode: STANDARD. Scout: no.
- Likely files: new `bin/lib/scan.js` (rules, import resolution, report),
  `bin/ai-flow.js` / `bin/lib/commands.js` (command and help),
  `bin/lib/harness.js` and `bin/lib/coverage-gate.js` (verify: run the scan on
  the diff under proof, contrary signal `scan-finding`, evidence field),
  `bin/lib/config.js` (`scan.*` defaults and validation),
  `docs/rules-and-limits.md`, README command table.
- Reuse: `diff-scope.js` (added lines, untracked files), `diff-base.js`,
  `coverage-gate.js` `SKIP_MARKERS`/`ASSERTION_MARKERS`, `report`'s redaction.
- Reference implementation: `~/.claude/workflows/lib/proof-scan.mjs`
  (interim, run by `epic-run` since 2026-11-14). Its JSONC reader is
  string-aware for a reason: a tsconfig `"@/*"` key is not a comment.
- Avoid: a parser dependency (zero runtime deps), scanning unchanged lines.

## Technical notes

- Import resolution order: relative → builtins (`node:` too) → tsconfig
  `paths` prefixes and `baseUrl` top-level entries (following relative
  `extends`) → declared dependencies (nearest `package.json`, root) →
  workspace package names (`git ls-files '*package.json'`) → `@types/<name>`
  for `import type` → installed (`node_modules/<name>` walking up) → else
  phantom.
- Four rules, all defects, no severity ladder; exit codes 0/1/2/3.
- Determinism: same tree, same findings, same order (file, line).

## Decisions

_(to fill during execution)_

## Test plan

- Unit, fixture repos: each rule fires on an added line and not on a base
  line; suppression with and without a reason; tsconfig with `/*` in strings;
  `baseUrl`; workspace package; `import type` with `@types`; installed but
  undeclared (silent); renamed file; untracked file.
- Verify integration: strict project → NOT PROVEN with `scan-finding`;
  default project → listed, verdict unchanged; scan tool error → `not
  examined`.
- Eval: the bethl range `develop~60..develop` replayed as a fixture
  (recorded diff), expecting the `@playwright/test` phantom and no `@/`
  false positive.

## Acceptance Traceability

_(to fill)_

## Commands

```
npm test
npm run lint
```
