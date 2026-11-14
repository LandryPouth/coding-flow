# Story 15-07 — A recipe is present only when it checks

## Status: in-progress

Follow-up of story 15-03's independent review (2026-11-14, PASS, three P2s
left open). `bootstrap --scan` reports a boundary or complexity recipe as
`present` when its config merely *mentions* the tool. The flag is advisory
(the command is still printed, nothing is written or blocked), but "present"
overstates what the project checks.

*(QUICK — detection in `bin/lib/quality-recipes.js`, behavioural tests on
throwaway directories.)*

## Acceptance Criteria

- [x] A `package.json` whose `eslintConfig` is empty (or lacks the rules)
      is not `present`, even when `complexity` and `max-lines-per-function`
      appear elsewhere in the file (e.g. in `scripts`): the rule names are
      read from the parsed `eslintConfig.rules` only. A malformed
      `package.json` is not `present`.
- [x] An ESLint config whose `complexity` or `max-lines-per-function` rule
      is turned off (`"off"` or `0`) is not `present`, for the forms that
      can be read without running code (JSON / `package.json`); for the
      others, the documented rule says the check is a name match.
- [x] ArchUnit counts as `present` only through the
      `com.tngtech.archunit` coordinate, not any mention of `archunit`
      (a comment such as `<!-- TODO add archunit -->` is not present).
- [x] The CHANGELOG entry for 15-03 says which configs are watched by
      `policy-changed` and names the two gaps: an ArchUnit rule lives in a
      test file, and `package.json`'s `eslintConfig` is outside the policy
      globs.
- [x] Existing tests stay green, unmodified; CHANGELOG `[Unreleased]` → Fixed.

## Out of Scope

- Adding `package.json` to the policy globs (it would flag every
  dependency bump).

## Decisions

- **Checks are read, not matched, where the format allows it.** A JSON ESLint
  config and `package.json`'s `eslintConfig` are parsed: both rules must be on
  in `rules` or in some `overrides[].rules` (a rule on only in an override
  still counts, as the name match did before). A severity of `"off"`, `0` or
  `"0"` (alone or first in an array) is off.
- **Fallback keeps the old behaviour.** A JS/TS/YAML config, or a
  `.eslintrc.json` with comments that `JSON.parse` refuses, stays a name match:
  reading it would mean running or parsing a language the tool does not ship.
- **ArchUnit reads its coordinate** (`com.tngtech.archunit`), the form every
  Maven/Gradle declaration carries; a comment naming the coordinate still
  counts (accepted: rare, and the flag is advisory).

## Result

`bin/lib/quality-recipes.js`: `checks` functions for ESLint (parsed rules) and
`package.json` (parsed `eslintConfig`), ArchUnit matched by coordinate.
Three tests added at the end of `test/bootstrap.test.js` (red at `cee7d52`'s
parent code, green after); the existing recipe tests are untouched and green.
Ordinary `present` cases (ESLint `overrides`, `.eslintrc.json` with comments,
YAML, a real Gradle ArchUnit dependency) give the same result as before.
CHANGELOG: a Fixed entry, and the 15-03 entry now names which configs
`policy-changed` watches and the two gaps.

