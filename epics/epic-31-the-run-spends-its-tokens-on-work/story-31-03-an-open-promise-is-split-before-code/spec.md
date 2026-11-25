# Story 31-03 — An open promise is split before code

## User Value

A STRICT story that promises something about an open input space ("any shell
command", "every test file", "a reformat never…") is caught at planning time.
It is rewritten as a bounded, monotonic claim before any code exists. In the
run, the five stories that took 6 to 8 review rounds (19-05, 19-08, 29-03,
29-04, 26-06) all made such a promise and were re-scoped late, after 4 rounds,
to "never weaker than <base>, on a recorded corpus". Each then passed. The
criteria count does not tell them apart: 19-09 had 7 criteria and passed in one
round.

## Requirements

- **The signal.** `doctor` (a warning) and `flow-plan`'s verification step
  flag a STRICT story with an open promise:
  - one of its acceptance criteria or requirements quantifies over an open
    input class: `any`, `every`, `all`, `never`, `no … can` next to a class
    noun such as command, file, input, path, test, form or reformat;
  - and the story names neither a corpus nor a base to compare with.

  A corpus is a fixture file or a list of real inputs. A base is "no weaker
  than <ref>" or "as at <sha>". The phrase list is in config
  (`plan.openPromisePatterns`), with English and French defaults.
- **The advice is concrete.** The warning quotes the criterion. It proposes the
  two shapes that ended these stories in the run:
  - a monotonic claim, "never weaker than <base> on <corpus>";
  - a split into a bounded first story plus a follow-up.
- **`flow-plan`** has one short paragraph: a STRICT promise over an open input
  space names its corpus and its base, or is split.

## Acceptance Criteria

- [ ] Given a STRICT story with a criterion "no command built to evade the
      guard is allowed", and no corpus or base, then `doctor` warns, quotes
      the criterion and proposes the two shapes.
- [ ] Given the same criterion with "never weaker than 3c90919 on
      `test/fixtures/x.json`", then there is no warning.
- [ ] Given a STANDARD story with the same wording, then there is no warning:
      the signal is for STRICT stories only.
- [ ] Run on the run's history, the signal fires on the original specs of at
      least 4 of the 5 long stories (from git history before their re-scope),
      and on at most 2 of the stories that passed in 1 or 2 rounds. The counts
      are recorded in the Result.
- [ ] `flow-plan` carries the paragraph, `plugin sync` has been run, and its
      eval case covers the split.

## Edge Cases

- A criterion in a code span or a quoted example: not read.
- French specs: default patterns for `aucun`, `toute`, `tout`, `jamais`.

## Out of Scope

- Blocking: it is a warning, never a refusal (design-decisions entry 9).
- Judging the claim with a model.
