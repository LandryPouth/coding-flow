# Story 19-08 — Plan

## Implementation Context

- **Execution mode**: STANDARD (the gate decides what proves a story).
- **Depends on**: 19-05 (fixers; its review moved this case here).
- **Likely files**: `bin/lib/coverage-gate.js`, `test/coverage-gate*.test.js`,
  `docs/rules-and-limits.md`.
- **Search anchors**: "Neutral counts as strengthened", `strengthened`,
  `assertionDelta`.
- **Scout pre-step**: no.

## Decisions

- **Origin (2026-11-23):** 19-05's third review found that a fixer
  reformatting an unrelated test earned the gate; the run's first answer
  (excluding fixer-touched files) made proof depend on run state and failed
  its fourth review. The gate's own rule is the cause, and a hand reformat
  exploits it too: fixed here, for both.
- **Behaviour change:** some stories that passed in test-file mode on a
  neutral edit will need a real assertion or a coverage report. Listed under
  Behaviour changes in the CHANGELOG.

- **What strengthens (2026-11-24):** a changed test file that is new
  (`addedFilesInDiff`, status `A`), or whose diff adds an assertion (net > 0)
  or a test case (net > 0), with no skip added. A test case is read from its
  declaration: `it|test|specify(` followed by a title string (so a helper
  called `test(` inside a case is not a case), `def test_`, `func Test…(`,
  `@Test`, `#[test]`. Anything else not weakened is `neutral`.
- **Occurrences, not lines:** assertion and skip markers are now counted per
  occurrence. Counting lines made a formatter that splits two assertions
  written on one line read as one assertion added — the very reformat this
  story must call neutral — and joining them read as one removed (a false
  weakening). Same markers, same patterns.
- **Neutral is reported, not punished:** `coverage.neutralTests` lists the
  scan's neutral files plus any changed test file the scan saw no text change
  in (a pure rename, a binary snapshot). Verify prints them under "Tests
  changed without a new test or assertion (neutral)". They never become a
  finding, so the claim (`claim.js`) and weakening signals are unchanged.
- **Only the test-file rung changed:** the measured path still receives the
  not-weakened test files (strengthened + neutral) for its "test file changed
  in their package" rule, exactly the set it had before. The removed branch
  is the one that passed "N test file(s) changed alongside" when nothing was
  weakened: it was the neutral pass.
- **Tests changed on purpose:** `weakened-tests.test.js` "a neutral edit is
  not a weakening" kept every assertion that it is not a weakening; its exit
  code assertion went 0 → 1, which is this story's rule. In
  `harness-fixers.test.js`, 19-05's "a fixer's rewrite counts as the story's
  diff" asserted that a fixer's reformat counted as strengthened (the rule
  19-05 handed here); it now asserts neutral and not proven, by a fixer and by
  hand alike (criterion 4). The fixer-strengthened warning moved to a new test
  whose fixer really adds an assertion, and the outside-root path-form test's
  fixer adds an assertion too, so both still exercise `fixerStrengthened`.

- **Review round 1 (2026-11-24), 2 P1 fixed:**
  - *An unstaged `mv` earned the rung:* the untracked new name counted as a
    new test file while the old name was reported deleted. An untracked test
    file is now read whole (`readLines`); when at least half of its non-blank
    lines are those of a deleted test file (`closestDeleted`), it is that
    file moved and is compared to it, so a plain move is neutral and an edited
    move is judged by its edit.
  - *pytest, Go, RSpec (and others) assertions were not seen:* before this
    story every framework passed because a neutral edit passed; the markers
    now also read bare `assert` (Python, Ruby, Elixir), `pytest.raises(`, Go
    `t.Error/Errorf/Fatal/Fatalf/Fail/FailNow(`, RSpec `expect {` and
    `is_expected`, Rust `assert!`/`assert_eq!`, `.NET`/JUnit `Assert.X(`; and
    cases: RSpec/Minitest/ExUnit `it|test|specify|scenario 'x'`, `def test…`,
    `func Test…`/`func test…`, PHPUnit `function test…(`, `.NET` `[Fact]`,
    `[Test]`, `[TestMethod]`…, Gherkin `Scenario:`. One test per form.
  - P2 fixed: the scan reads ONE diff, working tree vs the merge base (or
    HEAD), so a line moved between a commit and the working tree is not
    counted twice; `should` counts only as a call (`.should`, `should(`), not
    inside a title; an untracked test file that is empty or only comments
    does not strengthen; comment text (`//`, `#` except `#[`/`#!`, `/* */`,
    block-comment lines) is stripped before counting.
  - P2 accepted: a test split into two cases, or a new empty test case,
    counts as strengthened — the spec reads "a new test case", and judging
    what a case checks is mutation testing's job, not this regex's.
  - Fixture changed: `worktree-autoland.test.js`'s `touchHighRiskFile`
    committed a comment-only `payment.test.js` to satisfy the gate — exactly
    the "touch a test" this story closes. It now holds one real assertion;
    what the tests assert about auto-land is unchanged.
  - Limit kept: a test file reading a framework or helper the markers do not
    know reads neutral; the remedy (a coverage report) is in the message.

- **Round 3 decision (2026-11-24, run): the rule is inverted.** Round 2
  found that every round of markers created new false reds (RSpec
  `it { should … }`, Minitest `refute_*`/`must_equal`, ExUnit `refute`, Go
  table rows and `t.Run`, `test.each` and parametrize rows, `@ValueSource`,
  gtest `TEST(…)`, `#[tokio::test]`, PHPUnit `/** @test */`,
  FluentAssertions, destructured `strictEqual`) and that a test case moved
  from one file into another still earned the rung. Markers cannot converge.
  Now a test edit **strengthens unless it is provably neutral**:
  - *Provably neutral:* across every test file of the diff together, the
    test code added is contained in the test code removed (`strengtheningOf`).
    Compared as a multiset of tokens — identifiers, numbers, operators and
    string literals with quote style normalised; whitespace, comments,
    brackets, commas and semicolons dropped — so a reformat, a re-split line
    (one line into several, several into one), added trailing commas or
    arrow-parameter parentheses read as neutral. Each file is matched against
    its own removed code first, then against what the others removed and did
    not take back, deleted files and unstaged moves included. A fixer's
    rewrite is judged the same way.
  - *Anything else that adds test code strengthens*, in any framework — as
    before this story. An added line of junk in a test file strengthens too:
    the reviewer and the measured-coverage path are the backstop.
  - *(Superseded by the re-scope below: weakening is efede92's, raw lines.)*
    *Weakening is unchanged:* markers stay only there (skips, `.only`,
    assertions removed, files deleted), counted per occurrence outside
    comments; comment stripping is now quote-aware, so `//` inside a string
    is code.
  - *A new test file* strengthens only with test code not found in a removed
    test file: empty, comment-only, copied-from-a-deleted-file all read
    neutral. `closestDeleted` no longer decides strengthening: it only names
    an unstaged move once and reads its weakening against what it was.
  - *Moved files are named once:* the old name of an unstaged move is not
    listed neutral beside the new one.
  - *Accepted P2:* Token order is not compared: swapping two arguments
    reads neutral (a false red, never a false green).
  - Tests: round 1's marker tests (one per framework form) still pass — new
    code strengthens. (Round 3 made a renamed title strengthen; round 4
    reverses that, see below.)

- **Round 4 (review round 3: real formatter output).** The round-3 tokens
  were not formatter-proof (`x=-1` read `=-`, `'it\'s'` differed from
  `"it's"`, `.5` from `0.5`, a JSDoc's `*/` leaked) and a renamed title
  strengthened. Decided:
  - The lexer moved to `bin/lib/test-tokens.js` (coverage-gate.js only calls
    it). One token per operator character, `=>` excepted and dropped with
    `var`/`let`/`const`/`function`; strings unescaped, quote-free, and equal
    to an identifier when they are one; numbers canonicalised through
    `Number()`/`BigInt()` with their suffix lowercased; template text is a
    string and `${…}` code; block comments, triple-quoted strings and template
    literals carry their state across lines. An apostrophe with no partner on
    its line is not a string (Gherkin's `user's`).
  - *Strings never strengthen.* A leftover token must be an identifier, number
    or operator; a renamed title, a docstring or a changed message is neutral.
    So "a neutral edit is not a weakening" and the "should" title test are
    back to asserting neutral (round 3 had made a title rename strengthen: a
    gaming vector). Accepted narrow false red: an assertion whose only change
    is its expected string (`toBe('hi')` → `toBe('hello')`) reads neutral.
  - Weakening markers are counted on the same lexer's code lines, strings and
    comments removed: a `should` in a title is no assertion either way.
    *(Reverted by the re-scope below: it made the weakening signal looser.)*
  - `closestDeleted` compares token bags, so an unstaged move that also
    reformats is a move, not a deletion.
  - Paths: the scan names every file from the repository top (`ls-files
    --full-name`, as `git diff` does); a project-relative name of an untracked
    file in the changed list is mapped to it, so a file is listed once.
  - Fixtures: the prettier and gofmt "after" texts in the tests are real
    output (prettier 3, `gofmt -s`, run once on 2026-11-24); the eslint and
    black cases are hand-written from their rules.
  - *Accepted P2 (not fixed):* copying an existing test case strengthens (its
    tokens are not removed anywhere); `toBe(5)` → `toBeTruthy()` strengthens
    (a new identifier); swapping two arguments is neutral (order is not
    compared). The string-literal stripping does not know JS regex literals:
    a quote inside `/…/` can still open a string on that line.

- **Re-scope after review round 4 (the cap).** History of the P1s: round 1
  (an unstaged mv earned the rung, missing framework markers), round 2
  (invert the rule: strengthen unless provably neutral), round 3 (real
  formatter output, comments leaking, a renamed title strengthening), round 4
  (one P1: weakening markers counted through the stateful lexer on diff-hunk
  fragments — a removed line opening a template or `/*` whose closer is
  unchanged context hid the removed assertions after it, so a weakening read
  as a strengthening; the gate got looser). Round 4 was the cap, so the story
  is re-scoped to its promise: *a reformatted test is not a stronger test* —
  only the STRENGTHEN side may narrow.
  - The weakening signal is restored exactly to efede92: the same
    `ASSERTION_MARKERS`, counted on raw lines. Round 1's extra markers (bare
    `assert`, `pytest.raises`, Go `t.Fatalf`, `Assert.`, `expect {`) are
    dropped: a marker added on both sides can net a removal to zero, so it is
    not provably stricter. They no longer matter for strengthening.
  - Kept from round 1: the scan reads one diff against the base, not the sum
    of three (a line moved between a commit and the working tree was counted
    twice).
  - The token-bag neutral rule stays, for strengthening only. Fed fragments,
    the lexer can only hide code from the strengthen side's matching, and
    before this story every test change strengthened: never wider than before.
  - Regression tests s1 (a template literal's first line edited) and s2 (a
    two-line block comment's first line edited), each with two assertions
    removed, assert exit 1 and "removed"; both fail on round 4's gate.
  - Moved out: counting markers outside strings and comments (round 3's P2
    about `should` in titles) is a follow-up in epic 19's index; its test is
    kept as a `todo`.
  - Docs claim only what is held: prettier and gofmt real output. Known
    limits listed (they strengthen, as before): black's string-prefix
    changes, a `*args` line read as a comment, `eslint --fix` dot-notation and
    `eqeqeq` rewrites, JSX apostrophes.
  - Note only: `closestDeleted` is O(N×M) in untracked × deleted test files,
    each tokenised; fine for the sizes seen, not optimised.

- **New series, round 1 (finish the re-scope).** Two P1s, both round-1
  changes kept on the weakening side: (1) one diff against the base instead
  of three summed — an assertion added in a commit and turned into plain
  code in the working tree was no longer "1 more assertion(s) removed";
  (2) an unstaged `mv` paired with its untracked file dropped "the test file
  was removed". Decided:
  - `weakeningAsBefore` is efede92's loop, unchanged in behaviour: the three
    diffs summed, markers on raw lines, every deleted test file reported. It
    alone decides findings, `weakenedFiles` and the measured-coverage test
    set (`unweakened`, efede92's old `strengthened`).
  - `testChangesForStrength` (one diff against the base, untracked files read
    whole, an unstaged move compared to its old file) feeds only the token
    bag. A file strengthens only when it is not weakened, adds non-neutral
    code, AND the gate passed before this story (an unweakened file, or no
    weakening at all); otherwise it is held back (`heldBack`), never neutral.
    So a pass now implies a pass at efede92.
  - Round 1's pass branch "test file(s) changed alongside" stays removed:
    that is the narrowing the story is for.
  - The test "an unstaged mv and given one more assertion earns the rung"
    pinned the looser behaviour; it is a test this story added, so its
    expectation is now efede92's (exit 1, "the test file was removed"), as
    are two other unstaged-mv tests' "not removed" lines. Treating an
    unstaged move as a move is a follow-up line in epic 19's index.
  - Regression tests for both scenarios fail on a9455b1.

- **Series 2, round 2 (the invariant made structural).** P1: in a project
  below the repository top inside a test-glob folder (`repo/e2e/`), an
  untracked behaviour file was named from the top by the strength scan
  (`e2e/src/auth/login.js`, matching `**/e2e/**`) and strengthened, while
  the gate named it from the project as a behaviour file; and
  `passedBefore` had dropped efede92's `testFiles.length > 0`. Was red at
  efede92, green at f52a745. Decided:
  - `scanTestWeakening` computes efede92's verdict first, from the same
    classifier (`classifyChangedFiles`) and names: `unweakened.length > 0 ||
    (testFiles.length > 0 && findings.length === 0)`. When it fails, nothing
    strengthens.
  - When it passes, the strengthened files are taken FROM efede92's
    `testFiles` (a project-relative untracked name mapped to the scan's name
    with the project prefix), unweakened, keeping only those the token scan
    finds adding non-neutral code. The scan can only remove files from that
    list, never add one, so "a pass implies a pass at efede92" holds by
    construction rather than by argument. The pass message counts each file
    once.
  - Regression test: a project in `e2e/`, an untracked high-risk behaviour
    file, no test: exit 1. Fails on f52a745.

- **Series 2, round 3 (PASS, fixes before the STRICT round 4).** 222
  differential scenarios, never looser. Fixed: (1) the spec promised the file
  a case moved OUT of is never weakened; after the re-scope it reads
  "assertions removed" as at efede92, so the requirement and criterion 3 say
  what holds, and the cross-file test asserts the source's verdict; (2)
  `closingQuote` rescanned to the line's end for each unpartnered quote,
  quadratic (`'` + `\'`×40000 took 7.5 s): once a quote kind has no partner
  on a line it is not searched again (a later quote of that kind was passed
  unescaped by the earlier scan, which went on from the same place), with a
  timing test (100 KB hostile lines < 1 s; 10 s before). (3) Pre-existing at
  efede92: a project inside `e2e/`/`cypress/` names committed files from the
  top, all matching a test glob — a follow-up in epic 19's index, not fixed.

## Test Plan

Throwaway repos with a high-risk path, a neutral, an added-assertion and a
renamed test file; a fixer case through 19-05's `validation.fix`.

## Acceptance Traceability

- 1–5 → `test/weakened-tests.test.js`, `test/harness-fixers.test.js` (see tasks.md)

## Commands

```bash
npm test
```
