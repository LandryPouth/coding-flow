# Story 13-02 — A command substitution is not a credential

The "Long assigned credential" heuristic reported
`password="$(aws secretsmanager get-random-password …)"` on a real MVP
(`docs/DOGFOODING.md`, 2026-10-18). The pattern
(`(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{20,}["']`) is
copied verbatim into every user's `harness.json` at install, so the fix
belongs in `findSecretsInContent` (`bin/lib/security-policy.js` ~73), applied
to `heuristic` matches only, not in the default pattern.

*(QUICK — one function and its tests.)*

## Acceptance Criteria

- [ ] Given a file with `password="$(aws secretsmanager get-random-password --query X)"`,
      when the secret scan runs, then no finding is reported.
- [ ] Given values `"${DB_PASSWORD:-changeme-placeholder-x}"`,
      `"$DB_PASSWORD_FROM_THE_VAULT_X"` and a backtick substitution, then no
      finding.
- [ ] Given `password="hunter2-but-twenty-chars-long"`, then the finding is
      still reported (unchanged).
- [ ] Given an `exact` pattern (an AWS key) inside a `$(…)` line, then it is
      still reported: the exemption is for heuristic matches only.
- [ ] `npm test` green; the DOGFOODING row resolved; CHANGELOG (Fixed).

## Result
