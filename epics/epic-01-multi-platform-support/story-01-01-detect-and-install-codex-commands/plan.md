# Plan — Story 01-01

## Implementation Context

- **Execution mode**: STRICT — changes config schema, evidence schema, and
  install plumbing that every later story in this epic builds on, even
  though the guard itself isn't wired here.
- **Scout pre-step**: yes — cross-module (config, templates, report,
  ai-flow.js dispatch all move together).
- **Likely files**:
  - `bin/lib/detect.js` (new)
  - `bin/lib/config.js` — add `target`/`TARGETS` (see `config.js:16-31` for
    the existing `STORAGE_BACKENDS`/`SKILLS_MODES`/`INSTALL_MODES` pattern to
    mirror; `defaultConfig()` at `:37-69`; `readConfig` validation at `:73-108`)
  - `bin/lib/templates.js` — `getTemplateSpecs` (`:53-74`), `copyTemplates`
    (`:541-571`); the platform-aware split
  - `bin/lib/platforms/codex.js` (new directory + file)
  - `bin/lib/report.js` — `readRuns` (`:69-85`), `buildReport` (`:151-227`),
    `renderMarkdown` (`:229-323`)
  - `bin/ai-flow.js` — `init` command (currently `:153-291`; add `--target`
    handling before `resolveSkillsMode()`/`ensureConfig`)
  - `docs/design-decisions.md`, `docs/plans/multi-agent-install.md`

## Reference implementation (adapt, do not copy)

`~/dev/tools/ai-learn/bin/lib/platforms/codex.js` (command rendering shape)
and `~/dev/tools/ai-learn/bin/lib/platforms/detect.js` (detection
philosophy — a confirmed signal or nothing, never a guess; see its own
comment on a prior wrong Gemini-hook guess for why).

## Technical notes

- `writeJson` (`util.js:148-152`) is already atomic (tmp + rename) — reuse
  it verbatim for the new evidence writer, do not hand-roll another writer.
- `report.js`'s current `kind` detection is a pure filename-substring check
  (`name.includes("verify")`, `report.js:82`) with no field on the record.
  Add a real `kind` field to newly-written records; have `readRuns` prefer
  `record.kind` when present and fall back to the substring heuristic only
  when absent — this keeps every existing evidence file readable unchanged.
- `templates.js` has exactly one branching point today
  (`getTemplateSpecs({includeSkills})`, keyed to the hardcoded
  `SKILLS_DIR = ".claude/skills"` prefix, `templates.js:43,49-51,61-63`).
  Either generalize this into `includeSkillsFor(target)` plus a parallel
  `CODEX_SKILLS_DIR`-equivalent constant, or adopt the
  `templates/{shared,claude,codex}/` split from
  `docs/plans/multi-agent-install.md` (§"Two source file sets") — pick
  whichever keeps `copyTemplates`'s existing hash/manifest logic
  (`buildManifestFromCurrentTargets`, `templates.js:94-124`) intact for both
  targets. Record the choice below.

## Decisions

_(filled during implementation — record here: the templates.js restructuring
approach chosen, and Codex's actual project-vs-user-level prompt convention
once confirmed)_

## Test plan

- `test/detect.test.js` (new) — resolution order: flag wins over env, env
  wins over existing-dir, existing-dir wins over unrecognized; unrecognized
  never throws.
- `test/config-target.test.js` (new, or extend an existing config test) —
  `target` validated against `TARGETS`, invalid value falls back to
  `"unrecognized"` (mirrors `config.js:81-83`'s existing pattern for
  `storage`/`skills`), write-once contract holds.
- `test/platform-install-codex.test.js` (new) — end to end, following
  `test/doctor-guard-wiring.test.js`'s pattern (`mkdtempSync` project,
  `execFileSync` the real CLI, assert on `--json` output): `init --target
  codex` writes 7 command files + records `target: "codex"` + writes a
  `platform`-kind evidence file; re-running is idempotent; a prior `.claude/`
  install is untouched.
- `test/report-platform-coverage.test.js` (new) — `## Platform coverage`
  section renders after a Codex install; an old-style `*-verify.json` file
  with no `kind` field is still classified `"verify"`.

## Acceptance traceability

| Criterion | Test |
|---|---|
| `--target codex` writes config + 7 commands | `test/platform-install-codex.test.js` |
| no `--target`/no signal → `"unrecognized"`, no files | `test/platform-install-codex.test.js` |
| `## Platform coverage` section present | `test/report-platform-coverage.test.js` |
| old `*-verify.json` still classified `verify` | `test/report-platform-coverage.test.js` |
| idempotent re-run | `test/platform-install-codex.test.js` |
| prior `.claude/` install untouched | `test/platform-install-codex.test.js` |

## Commands

```
npm test
```
