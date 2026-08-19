# Reference — 05 Cross-module

**The defect:** `src/report.js` sums every record in the store. `src/approvals.js`
records a rejection by setting `status: 'rejected'` and nothing else. Neither file
is wrong on its own — the reporter predates rejection, and rejection does exactly
what it says. The total is wrong the moment anybody rejects anything, and it has
been wrong since rejection shipped.

**Should change:** `src/report.js` (filter by status). Fixing it in
`src/approvals.js` — deleting or moving the record — is a different, worse product
decision and loses the audit trail; flag it in grading.

**Should not change:** `src/store.js`. Nothing is wrong there.

**Why this task is the hard one:** the prompt names a symptom in finance's
vocabulary and points at no file. The green suite says everything is fine, because
no existing test ever rejects an expense and then reads the report. Localization is
the whole task; the fix is one line.

**The trap:** the second acceptance test. Filtering with
`if (expense.status === 'rejected') continue` inside the grouping loop is correct.
Filtering afterwards by zeroing the bucket leaves `meals: 0` in the output, which
is a different report than the one finance asked for.

**Hand-graded:** did the run add a regression test of its own? A one-line fix to a
bug that survived a green suite, shipped with no test, is the exact failure this
whole benchmark is measuring.
