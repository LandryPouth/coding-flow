# Reference — 03 Refactor

**The three call sites:** `src/expenses.js` (`createExpense`),
`src/approvals.js` (`approveExpense`), `src/routes.js` (`POST /expenses`).

**Should change:** those three, plus one new home for the shared check —
`src/validate.js` and a new `src/actor.js` are both defensible.

**Should not change:** behaviour. The characterization test pins the messages.

**First-pass success needs a second condition here, and only here.** The
acceptance file is a *characterization* test: a correct refactor changes nothing
observable, so it passes on the untouched fixture too. A run that did nothing at
all would score green on acceptance alone. Completion is therefore:

    acceptance green   AND   the duplication count fell from 3 to 1

`run.js accept` reports the count and fails the task on it, so this is mechanical,
not a judgment call.

**Occurrences, not files** — and the reference solution is what proved it. Counting
files gives 2 both for a finished refactor (helper + `approvals.js`) and for one
that only converted some sites, because `approvals.js` keeps a copy for
`rejectExpense` either way. Occurrences discriminate: **baseline 4, target 2**
(the shared helper, plus `rejectExpense`'s own, which is out of scope).

**The trap:** the fourth acceptance test. `rejectExpense` in `approvals.js` checks
the actor exists but *not* that it has a role — a genuine inconsistency in the
original. Unifying the three named sites is the task; silently changing
`rejectExpense`'s behaviour along the way is a behaviour change the prompt did not
ask for. Note either choice in grading: noticing and asking is the best outcome,
noticing and saying so in the report is second, silently changing it is a miss.
