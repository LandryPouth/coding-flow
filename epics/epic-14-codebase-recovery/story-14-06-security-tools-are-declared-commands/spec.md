# Story 14-06 — Security scanners are declared commands, and absence is reported

## User Value

A developer who has (or installs) `npm audit`, `govulncheck`, `pip-audit`,
`gitleaks` or `semgrep` gets their results captured as proof by `verify`,
the same way tests and lint are — and when a scanner cannot run (missing
binary, no network), the evidence and the recovery dossier say **not
examined**, never "clean".

## Requirements

- `validation.security` in `.coding-flow/config.json`: same entry shape as
  `validation.quality` (string or `{ command, … }`), run after quality,
  captured in the evidence under its own key with exit code, duration,
  output tail.
- Outcome per entry: `pass` (exit 0), `fail` (non-zero), **`not-examined`**
  — the existing `toolError` cases (could not observe), exit 127 / ENOENT,
  timeout, and a network failure recognised by the runner's output
  (`ENOTFOUND`, `EAI_AGAIN`, `getaddrinfo`, `network`) — never folded into
  pass.
- `fail` fails verify like a red quality command; `not-examined` fails only
  under strict, and is printed as a warning otherwise. Rationale printed:
  "a scanner that did not run found nothing because it looked at nothing".
- `bootstrap --scan` (text and JSON) suggests a recipe for each detected
  ecosystem: `npm audit --omit=dev --audit-level=high`, `pnpm audit --prod
  --audit-level high`, `govulncheck ./...`, `pip-audit`, plus `gitleaks
  detect --no-banner` and `semgrep --config auto --error` only when the
  binary is on `PATH`. It never writes the config.
- `recover scan` reports which declared security commands exist and which
  recipes apply but are not declared — the assess dimension table's
  "tool-checked" column reads from it.

## Acceptance Criteria

- [ ] Given `validation.security: ["node -e \"process.exit(1)\""]`, then
      verify fails and the evidence names the security command.
- [ ] Given a command that is not on `PATH`, then the entry is
      `not-examined`, verify passes with a warning (non-strict) and fails
      under strict.
- [ ] Given a command printing `getaddrinfo ENOTFOUND registry.npmjs.org`
      and exiting non-zero, then `not-examined`, not `fail`.
- [ ] Given a pnpm workspace, then `bootstrap --scan --json` lists the pnpm
      recipe; given no `gitleaks` on `PATH`, it is not suggested.
- [ ] Given no `validation.security`, then every existing verdict is
      unchanged.

## Result
