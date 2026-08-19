# Reference — 02 CRUD

**Should change:** a new `src/vendors.js`, plus `src/routes.js` for the three
routes. A separate store instance or a second collection is both acceptable.

**Should also change:** `spec/` — the prompt asks for tests. A run that ships the
feature with no test of its own is a miss even when acceptance passes.

**Should not change:** `src/expenses.js`, `src/approvals.js`, `src/report.js`.

**The trap:** the last acceptance test. Vendors stored in the same collection as
expenses make `GET /report` group them under `undefined`, which nothing in the
prompt would make you look for.
