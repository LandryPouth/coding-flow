# Story 19-08 — Tasks

- [x] `strengthened` needs an added test or assertion; `neutral` listed.
- [x] Test-file mode refuses all-neutral; message names the files.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry (Behaviour changes).

## Status: in-progress

## Result

A changed test file strengthens only when it is new or adds a test case or an
assertion; a rename, a reformat (by hand or by a fixer) or an assertion moved
between cases is `neutral`, printed and recorded as `coverage.neutralTests`,
and on its own leaves a high-risk change unproven, with a message saying what
would prove it. Markers are counted per occurrence. The measured-coverage path
is unchanged.

## Acceptance Traceability

1. `test/weakened-tests.test.js::19-08: a test file only reformatted does not earn the rung, and is named neutral` (also: `…two assertions split from one line onto two by a formatter are still neutral`, `…an assertion moved from one test case to another is neutral`)
2. `test/weakened-tests.test.js::19-08: the same test file with one assertion added earns the rung` (also: `…a new test case with no assertion marker earns the rung`, `…a new test file counts as a test added, even with no assertion marker`, one `…added to a test file earns the rung` per framework form, and one `…new test code strengthens in any framework — <form>` per round-2 form)
3. `test/weakened-tests.test.js::19-08: a test file renamed without other change is neutral, not weakened` (also: `…a test file moved with an unstaged mv is neutral, not a new test`, `…a test case moved from one test file into another is neutral`, `…a test case moved into a new test file is neutral`, `…a file moved with an unstaged mv is named once`)
4. `test/harness-fixers.test.js::a fixer's rewrite counts as the story's diff, like the same edit by hand, and verify says it was a fixer's`
5. `test/weakened-tests.test.js::19-08: a measured coverage report decides as before, a neutral test file beside it`

### Rollback Notes
