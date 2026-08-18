# Dogfooding log

> Where Coding Flow got in the way. Not bugs in *your* code — **friction with the
> tooling**: the moments it cost more than it returned, while working exactly as
> designed.

Kept by the agent as well as by you: the rule in `RULES.md` says an entry is
written the moment the friction happens, not remembered later. A log filled in
from memory at the end of the week is a log of the two loudest incidents.

## What belongs here

Something goes in the log when the tool was the obstacle:

- a gate blocked a change that had no legitimate way to satisfy it;
- a check fired on something that was never a risk (a false positive);
- a check stayed quiet on something that was (a false negative);
- an error message did not say what to do next;
- a command had to be re-run, worked around, or looked up to be understood;
- **you turned something off to get moving.**

That last one is the most valuable row in the file. Record it plainly. A gate
that gets disabled protects nothing, and the disabling is the symptom worth
measuring — not the thing to hide.

Also record the opposite when it happens: **a gate that fired and was right**. A
log that only collects complaints will talk you into removing checks that are
doing their job.

## What does not belong here

Keep these out or the log stops carrying signal:

- a test that failed because the code was wrong — that is the tool working;
- a gate that blocked a change which genuinely needed a test;
- an error in your own application;
- a feature you wish existed. That is an issue, not friction.

The question that settles it: *would a careful developer, told exactly what the
tool wanted, have been able to do it?* If yes, the tool worked. If no, log it.

## Columns

- **Date** — when it happened.
- **Surface** — which part: `guard`, `coverage gate`, `risk`, `verify`, `ship`,
  `doctor`, `install`, `skills`.
- **Problem** — what actually happened, one sentence.
- **Severity** — `low` (mildly annoying) · `medium` (cost real time) · `high`
  (no legitimate way to satisfy it, or a wrong verdict).
- **Workaround** — what you did to keep moving. `disabled the gate`,
  `wrote an exemption`, `edited the config`, `none needed`.
- **Resolution** — the fix, the decision not to fix, or `open`.

Anything at `high` still marked `open` is the next thing to deal with, ahead of
whatever the roadmap says.

## Log

<!-- Newest first. One row per incident. Keep it short — the value is in the
     volume and the honesty, not the prose. -->

| Date | Surface | Problem | Severity | Workaround | Resolution |
|---|---|---|---|---|---|

## Sending it upstream

Rows from a project that is not Coding Flow itself are worth more than any
internal testing, because nobody designed the project around the tool. If a row
looks general rather than specific to this repository, it is worth opening an
issue at <https://github.com/LandryPouth/coding-flow/issues> with the row pasted
in. No need to diagnose it — the row is the report.
