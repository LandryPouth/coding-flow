# Story 08-02 — Policy fingerprint

## User Value

Tightening the rules makes old proofs stale. Today, after editing
`harness.json`, `verify` answers "already proved" with a verdict computed
under the old rules.

## Requirements

- `policyFingerprint`: sha1 of a canonical JSON of the **effective** policy:
  the loaded `harness.json` (after defaults), `config.json`'s `validation`
  block and `baseBranch`, and the coding-flow **major.minor** version (a
  verdict computed by different gate code is a different proof).
- Stored on every verify/evidence/check JSON (top level).
- `findReusableVerify` requires an equal `policyFingerprint` (plus 07-01's
  `mergeBase`).
- `audit`'s staleness (`isStale`) and `status`'s verified/stale state treat a
  different fingerprint as **stale (policy changed)** — a distinct reason
  from "code changed".
- Evidence without the field (older versions): never reused for the cache;
  for `status`/`audit`, treated leniently as today (not stale) to avoid
  flipping every historical story at upgrade.

## Acceptance Criteria

- [x] Green verify, then add a term to `highRiskTerms`, then verify again →
      commands actually run (no "already proved").
- [x] Green verify, change `coverageReports` → `status` shows the story as
      stale with reason "policy changed".
- [x] Green verify, no change → reuse works as today.
- [x] Whitespace/key-order changes in `harness.json` do not change the
      fingerprint (canonical JSON).
- [x] Upgrading coding-flow 0.13.0 → 0.13.1 does not invalidate; → 0.14.0
      does.

## Edge Cases

- `harness.json` is excluded from the tree token on purpose
  (`identity.js`): keep it that way — the fingerprint is the separate channel
  the audit asked for (`subjectFingerprint` vs `policyFingerprint`).
