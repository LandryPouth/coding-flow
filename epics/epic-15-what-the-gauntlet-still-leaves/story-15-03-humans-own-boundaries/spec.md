# Story 15-03 — Humans own boundaries; the project's own tools check them

## User Value

In a user's project, the module boundaries that matter ("billing never
imports from the UI", "domain does not import the database client") are
decided by a human once, written where agents read them, and checked on
every verify by a tool the project already uses — instead of living as prose
in `RULES.md` that agents ignore.

## Requirements

- **`/flow-plan`**: a `## Boundaries` section in an epic's `index.md` — the
  allowed and forbidden dependencies the epic creates, each one line,
  marked `approved by: <human>` before stories are written; the readiness
  gate is `not ready` while it is unapproved for an epic that adds a module.
- **Recipes, never config writes**: `bootstrap --scan` suggests, per detected
  stack, a boundary check and a complexity check for `validation.quality`:
  dependency-cruiser (`depcruise src --config`), import-linter (`lint-imports`),
  ArchUnit (a test, run by the suite), ESLint `complexity` and
  `max-lines-per-function`; and when the project already has one of those
  config files, says it is present.
- Those tools' config files are in 13-04's `policyGlobs` defaults, so
  loosening a rule is reported as `policy-changed`.
- `/flow-recover` assess (architecture dimension) reads the `## Boundaries`
  sections and reports a violated or missing one as a finding.

## Acceptance Criteria

- [x] `/flow-plan` SKILL.md carries the section format and the readiness
      rule; its eval case gains a prompt ("plan the billing module; it must
      not depend on the UI"); `plugin check` green.
- [x] Given a throwaway Node project with `src/`, then `bootstrap --scan
      --json` lists the dependency-cruiser and ESLint recipes; given an
      existing `.dependency-cruiser.js`, it reports it as present instead.
- [x] Given a Python project, the import-linter recipe; given Java (Maven),
      ArchUnit.
- [x] `policyGlobs` defaults include `.dependency-cruiser.*`, `.importlinter`
      / `importlinter.ini`, and an ESLint config (pinned by a test reading
      the defaults).

## Status: done

## Result

- `bin/lib/quality-recipes.js` (new, same contract as `security-recipes.js`):
  per root manifest, Node → dependency-cruiser (`npx depcruise src --config`,
  `.` without `src/`) and ESLint complexity; Python → import-linter
  (`lint-imports`); Java → ArchUnit (no command: a test the suite runs). Each
  recipe carries `present: <file>` when its config exists — a
  `[tool.importlinter]` section in `pyproject.toml` / `[importlinter]` in
  `setup.cfg`, or an ArchUnit dependency in `pom.xml` / `build.gradle*`, count; an ESLint config
  only when it names both rules (`package.json` through `eslintConfig`) — a
  bare ESLint config is not the complexity check (review P2).
- `bootstrap --scan`: `qualityRecipes` in JSON, a `## Quality Recipes` section
  in the document (the command kept on a `present` line; root manifests only,
  said), one summary line. Never writes the config.
- `policyGlobs`: `.dependency-cruiser.*`, `importlinter*` and ESLint were
  already defaults; `**/.importlinter*` added (the dotfile was not matched).
- `/flow-plan`: `## Boundaries` section format, the readiness rule, a
  verification box; eval prompt added. `/flow-recover`: architecture inventory
  reads the `## Boundaries` lines.
