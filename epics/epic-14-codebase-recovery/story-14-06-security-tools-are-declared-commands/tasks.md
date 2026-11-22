# Story 14-06 — Tasks

- [x] Tests first; `validation.security` run and captured; outcomes.
- [x] Recipes in bootstrap; report in recover scan.
- [x] SKILL.md assess: the dimension table reads tool-checked from the scan.
- [x] `npm test`; verify; CHANGELOG (Added).

## Result

- `validation.security` resolved after quality; each entry carries `kind:
  "security"` and `outcome` (`pass` / `fail` / `not-examined` +
  `notExamined` reason). Not-examined sets `ok` to `!strict`; the report
  prints `[not examined] security: <cmd>` with the reason and the rationale,
  and the summary reads `passed, with warnings (N security command(s) not
  examined)`.
- `bin/lib/security-recipes.js`: ecosystem recipes from root manifests,
  `gitleaks`/`semgrep` on `PATH` only. `bootstrap --scan` adds
  `securityRecipes` (JSON) and `## Security Recipes` (document);
  `recover scan` adds `securityTools: { declared, undeclared }` and a text
  section. The skill's dimension table reads tool-checked from it.
- The `ship` PR body shows `⚠️ not examined (<reason>)` for such a scanner,
  never `✅ exit 0` (found in self-review; pinned by a test).
- Independent STRICT review (fail: 1 P1, 6 P2, 4 P3) → fixed: network test
  on the end of stderr only, `security` key only when declared, `run`
  summary names unrun scanners, pnpm needs its lockfile, whole-word declared
  match, skill reads the outcome from verify evidence; the rest recorded in
  plan.md Decisions. Six more mutations, each caught.
- Re-review (fail: the stderr-only fix missed pnpm, whose failure is on
  stdout; pip-audit/govulncheck shapes never recognised) → whole-line shapes
  per HTTP client, on both streams, stack frames skipped; fixtures for pnpm,
  npm, pip-audit, govulncheck and two look-alikes. Five mutations, each caught.
- Round 3: **pass** (0 P0/P1). Open P2 (a repository `.npmrc` registry
  override) and P3s (wording, provenance of the pip-audit/Go shapes)
  recorded in plan.md Decisions and the spec/CHANGELOG wording.
- Negative evidence: 7 mutations (strict pass-through, no network
  detection, bare "network", exit 127 as fail, no pnpm dedupe, binaries
  always suggested, declared never matched) each turn a test red.

### Rollback Notes

`git revert` of the story commit. No migration and no data: `validation.security`
is an additive config key, and after a revert `readConfig` drops it, so a project
that declared scanners simply stops running them (nothing runs them as tests).
Evidence files keep the extra `kind`/`outcome` fields; older readers ignore them.
