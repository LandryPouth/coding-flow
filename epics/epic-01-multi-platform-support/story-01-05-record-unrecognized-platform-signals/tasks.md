# Tasks — Story 01-05

- [x] Define the explicit signal allowlist constant.
- [x] Extend `detect.js` to expose which allowlisted signals were checked
      (not just the final verdict).
- [x] Extend the platform-evidence writer with the boolean signal capture.
- [x] Add the `unrecognized` row to `report.js`'s `## Platform coverage`.
- [x] Add the `docs/DOGFOODING.md` pointer line.
- [x] Write tests per `plan.md`.
- [x] Run `npm test`; fix; capture verify.

## Result

Unrecognized installs now record `enforcementTier: "unrecognized"` plus boolean signals from an explicit
allowlist (`collectSignals`, `detect.js`); `report` summarises them under `## Platform coverage`.

### Rollback Notes

`git revert` the story commit; no schema change. Existing records without `signals` already render as
"not checked".

## Status: done
