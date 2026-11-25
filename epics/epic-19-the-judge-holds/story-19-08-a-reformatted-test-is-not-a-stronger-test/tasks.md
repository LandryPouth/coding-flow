# Story 19-08 — Tasks

- [x] `strengthened` needs an added test or assertion; `neutral` listed.
- [x] Test-file mode refuses all-neutral; message names the files.
- [x] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry (Behaviour changes).

## Status: done

## Result

A changed test file strengthens when, across all test files of the diff, it
adds an identifier, number or operator not found among those removed (compared
as tokens: whitespace, brackets, commas, semicolons, comments, docstrings'
quotes, `var`/`let`/`const`, `function`/`=>` ignored; strings unescaped and
quote-free, an identifier-like string equal to the identifier; numbers
canonical; one token per operator character). Otherwise it is `neutral`: a
rename of the file or of a title, real prettier, gofmt, black or `eslint --fix`
output (prettier and gofmt tested on their real output), a docstring, a test
case moved between files, a string-only change.
Neutral files are printed and recorded as `coverage.neutralTests`, named once
from the repository top, and on their own leave a high-risk change unproven,
with a message saying what would prove it. Everything that decides a
weakening is efede92's code path (three diffs summed, markers on raw lines,
every deleted test file reported, an unstaged `mv` included); a file
strengthens only where the gate passed before this story, and only if it is
in that run's own test-file list (same classifier, same names). The
measured-coverage path is unchanged.

### Rollback Notes

Revert the story's commits: nothing is migrated or stored. The weakening
signal is efede92's code path throughout, so a revert only widens what
strengthens back to "any unweakened test change"; `bin/lib/test-tokens.js`
and its `harness.json` high-risk entry go with it.

## Acceptance Traceability

1. `test/weakened-tests.test.js::19-08: a test file only reformatted does not earn the rung, and is named neutral` (also: `…two assertions split from one line onto two by a formatter are still neutral`, `…an assertion moved from one test case to another is neutral`, one `19-08: neutral — <case>` per real-formatter, comment, docstring and string-only case, `…a test title renamed to start with "should" is neutral`, `a neutral edit is not a weakening`)
2. `test/weakened-tests.test.js::19-08: the same test file with one assertion added earns the rung` (also: `…a new test case with no assertion marker earns the rung`, `…a new test file counts as a test added, even with no assertion marker`, one `…added to a test file earns the rung` per framework form, and one `…new test code strengthens in any framework — <form>` per round-2 form)
3. `test/weakened-tests.test.js::19-08: a test file renamed without other change is neutral, not weakened` (also: `…a test file moved with an unstaged mv is neutral, not a new test`, `…a test case moved from one test file into another is neutral`, `…a test case moved into a new test file is neutral`, `…a file moved with an unstaged mv is named once`, `…an unstaged move that also reformats is neutral, and the old name reported removed as before`, `…in a project below the repository top, the test files are named in one form, from the top`; weakening still caught: `…assertions removed after a template literal whose first line is edited are still caught`, `…after a two-line block comment…`, `…an assertion added in a commit and turned into plain code in the working tree is still an assertion removed`, `…a test file moved with an unstaged mv and given one more assertion is still reported removed, as before`, `…in a project inside an e2e/ folder, a new untracked behaviour file is not a test that strengthens`, `…a hostile 100 KB line of escaped quotes is read in linear time`)
4. `test/harness-fixers.test.js::a fixer's rewrite counts as the story's diff, like the same edit by hand, and verify says it was a fixer's` (also: `test/weakened-tests.test.js::19-08: a fixer writing real prettier output is neutral like the hand reformat`)
5. `test/weakened-tests.test.js::19-08: a measured coverage report decides as before, a neutral test file beside it`
