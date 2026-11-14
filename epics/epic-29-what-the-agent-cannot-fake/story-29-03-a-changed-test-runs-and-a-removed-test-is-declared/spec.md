# Story 29-03 — A changed test runs, and a removed test is declared

## User Value

When a story adds or changes a test, verify proves that test is among the
tests its commands actually run — not merely present in the diff. When a
story removes a test, verify names it and asks for a reason. A green exit
code with an empty or unreadable run is not a pass.

## Requirements

- **Collected set.** For each test file the diff adds or changes, verify
  finds the package that owns it (nearest `package.json`) and asks that
  package's runner which files its declared command would run, using the
  arguments of the script the validation command calls:
  - jest: `jest <--config/-c/--rootDir/--selectProjects from the script> --listTests`;
  - vitest: `vitest list --filesOnly --json` with the script's `--config`/`--project`;
  - node:test: the file globs given to `node --test`;
  - anything else: `not examined` for that file (never "ran").
  Results are cached per package and tree token.
- **`test-not-run`.** A changed test file outside its package's collected set
  is a contrary signal naming the file and the command, with the fix: add it
  to a validation command, or record under `## Test Exemption` that it runs
  outside verify and how. bethl case: `apps/api/test/integration/*.integration-spec.ts`
  vs jest `testRegex: .*\.spec\.ts$` (29 files over 60 commits, 2026-11-14).
- **`test-removed`** (Shipmoor `reduced`). Test titles present at the merge
  base (`it(`/`test(` with a literal title) and gone at the tree — not
  re-added anywhere in the diff (a move or rename keeps its title) — are a
  contrary signal unless `## Test Exemption` names the title (or its file)
  with a reason. Whole deleted test files keep their existing rule.
- **Exit code never alone.** When the project declares a report for a command
  (`validation.reports: { "<command>": "<path or glob>" }`, jest `--json
  --outputFile`, JUnit XML, node:test TAP), a passed command also needs a
  report written during this run (mtime after the command started), parsed,
  with at least one test and zero failures; otherwise the command is a red
  `report-missing` / `report-empty`, not a pass. Without a declared report,
  behavior is unchanged.
- All three follow entry 9: listed every time, NOT PROVEN where strictness
  applies. Evidence records `collected: { file: ran|not-run|not-examined }`.
- 18-06 reads `collected` to decide whether a criterion's named test ran.

## Acceptance Criteria

- [ ] Given a jest package whose `testRegex` is `.*\.spec\.ts$` and a diff that adds `test/x.integration-spec.ts`, when verify runs, then `test-not-run` names that file and the package's test command.
- [ ] Given the same diff plus a validation command that runs the integration config, when verify runs, then the file is `ran` and no signal is raised.
- [ ] Given a test titled "keeps the price" removed from a spec and not re-added, when verify runs, then `test-removed` names the title; given `## Test Exemption` naming it with a reason, then no signal and the reason is in the evidence.
- [ ] Given a test moved to another file with the same title, when verify runs, then no `test-removed`.
- [ ] Given `validation.reports` for `npm test` and a run that exits 0 but writes no report, when verify runs, then that command is red with `report-missing`.
- [ ] Given a runner the tool does not know, when verify runs, then the file is `not examined` and the verdict is not raised by it.

## Edge Cases

- `--listTests` failing or slow (timeout 90 s): `not examined`, logged.
- Turbo/monorepo commands: the package is found from the file, not from the
  root command; a root command that runs every package is still matched by
  the package's own script.
- Parameterized titles (`test.each`, template literals with `${}`): compared
  by their literal prefix; ambiguous ones are not reported.

## Out of Scope

- Judging whether an assertion got weaker (19-07 makes base tests read-only
  in driven runs; `scanTestWeakening` already lists the markers).

## Security

Runs only the runner's list mode with the project's own config, inside the
existing command allowlist rules (a project script, bare).
