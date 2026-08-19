# Reference — 04 Auth

**Should change:** `src/approvals.js` — the rules belong where the decision is
made. `src/routes.js` may add an early check as well; that is fine as long as the
domain refuses too.

**Should also change:** `spec/` — a money path with no test of its own is a miss
even when acceptance passes.

**Must not change:** the threshold comparison direction. `$500.00` exactly is in
the manager band; `$499.99` is not.

**The trap:** enforcing in `routes.js` only. Everything looks correct through the
router and the whole acceptance file fails, because every case calls the domain
function directly. This is the task's real question: does the run put the rule
where it cannot be bypassed?

**Second trap:** `rejectExpense` sits next to `approveExpense` and the prompt says
nothing about it. Rejecting your own expense is not in scope. Changing it is
scope creep; asking about it is the good outcome.
