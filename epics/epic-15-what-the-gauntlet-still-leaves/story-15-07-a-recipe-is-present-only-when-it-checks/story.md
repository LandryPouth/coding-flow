# Story 15-07 — A recipe is present only when it checks

## Status: planned

Follow-up of story 15-03's independent review (2026-11-14, PASS, three P2s
left open). `bootstrap --scan` reports a boundary or complexity recipe as
`present` when its config merely *mentions* the tool. The flag is advisory
(the command is still printed, nothing is written or blocked), but "present"
overstates what the project checks.

*(QUICK — detection in `bin/lib/quality-recipes.js`, behavioural tests on
throwaway directories.)*

## Acceptance Criteria

- [ ] A `package.json` whose `eslintConfig` is empty (or lacks the rules)
      is not `present`, even when `complexity` and `max-lines-per-function`
      appear elsewhere in the file (e.g. in `scripts`): the rule names are
      read from the parsed `eslintConfig.rules` only. A malformed
      `package.json` is not `present`.
- [ ] An ESLint config whose `complexity` or `max-lines-per-function` rule
      is turned off (`"off"` or `0`) is not `present`, for the forms that
      can be read without running code (JSON / `package.json`); for the
      others, the documented rule says the check is a name match.
- [ ] ArchUnit counts as `present` only through the
      `com.tngtech.archunit` coordinate, not any mention of `archunit`
      (a comment such as `<!-- TODO add archunit -->` is not present).
- [ ] The CHANGELOG entry for 15-03 says which configs are watched by
      `policy-changed` and names the two gaps: an ArchUnit rule lives in a
      test file, and `package.json`'s `eslintConfig` is outside the policy
      globs.
- [ ] Existing tests stay green, unmodified; CHANGELOG `[Unreleased]` → Fixed.

## Out of Scope

- Adding `package.json` to the policy globs (it would flag every
  dependency bump).
