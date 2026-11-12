# Story 14-01 — Tasks

- [x] Discovery: `bootstrap.scanProject`, `security-policy` exports, how
      `ai-flow.js` dispatches a command and `usage.js` groups it.
- [x] Fixture app + expected states.
- [x] Scan tests first (hotspot, test map, `$(…)` not a secret, history
      without value, read-only); then `bin/lib/recover.js`.
- [x] SKILL.md assess + minimal fix; eval case; registration; `plugin sync`.
- [x] Blind replay on the fixture; fix the skill text until it reaches every
      expected state; record states/time/tokens.
- [x] `npm test`; `ai-flow verify`; CHANGELOG (Added).

## Result

`ai-flow recover scan` is implemented as a read-only layer in
`bin/lib/recover.js`, with its own `test/recover-scan.test.js` covering the
fixture hotspot/test gap, the command-substitution false positive, history
without the matched value, read-only/`--help`, missing history and skipped
files. The `/flow-recover` assess skill, eval case, docs and the generated
`skills/` copy are registered.

### Blind replay

Three blind sessions on a fresh copy of `evals/recovery/fixture/` (committed in
a throwaway repo, private visibility stated; no expected states shown). The
first two exposed skill gaps and the text was fixed after each: the first
misread the secret fallback as a new auth bypass, marked Data/Reliability
`examined` from adjacent code, and downgraded the IDOR to `suspected`; the
second reached the fallback mitigation and the dimension states but still
downgraded the IDOR. The final session reached every expected state:

- IDOR `GET /scripts/:id`: **confirmed** (`server.js:16` → `service.js:5` →
  `repository.js:4`)
- SSRF `POST /scripts/test-webhook`: **confirmed**
  (`server.js:21` → `service.js:9`)
- caller-code execution: **refuted** (`main.js:4` rejects the argv before
  evaluation)
- `AUTH_SECRET` development fallback: **mitigated** by `Dockerfile:2`
  (`NODE_ENV=production`)
- command substitution: scan reported no tree secret (13-02 fix); no finding
  was invented
- dependency audit: **not examined** (no lockfile, `npm audit` → ENOLOCK)
- dimensions: Security/Architecture/Operations/Comprehension `examined`, Data
  and Reliability `not examined`

Final run: 131 s, 42,958 context tokens at the final step, 4,731 output tokens
(11 steps). The agent also reported the real missing `express`/`src/db`
startup blockers.

### Verification

- `env -u OPENCODE -u OPENCODE_PID npm test` — full suite passes.
- `node scripts/skill-evals.js` — 8 skills, 27 positive prompts, rank-1 85.2%.
- `node bin/ai-flow.js plugin check` — in sync.
- `ai-flow verify --story epics/epic-14-codebase-recovery/story-14-01-assess-an-mvp-end-to-end`
  — passed: 4 commands, coverage 96% of 551 added lines (warning: the
  fixture-exclusion policy change is declared in the spec).

### Rollback Notes

Revert the commit; `recover scan` writes no project file, so no user data needs
cleanup.
