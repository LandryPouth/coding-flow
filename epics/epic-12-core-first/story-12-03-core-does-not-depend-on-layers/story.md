# Story 12-03 — Core does not depend on layers

After story-11-01 splits `harness.js`, a test makes the core/layer boundary
(epic index, Decisions) a checked fact: no core module can `require` a layer
module, directly or transitively.

*(QUICK — one test file and the fixes it forces; run after 11-01.)*

## Acceptance Criteria

- [ ] `test/layering.test.js` lists core and layer modules (from the epic's
      Decisions), walks `require("./…")` calls statically from each core
      module, and fails with the offending chain (`coverage-gate → story`).
- [ ] Every violation found is fixed by passing data in from the layer, not
      by moving the module to "core".
- [ ] A new file under `bin/lib/` that is in neither list fails the test
      with "classify this module as core or layer" — the boundary cannot be
      bypassed by omission.
- [ ] `npm test` green.

