# Plan — Story 26-08: init shows the rules it applies

## Decisions

- **D1 — Remove the trap instead of detecting it.** 26-06 tried to detect it:
  write the keys only when no proof is recorded, searching this checkout, the
  primary and every linked worktree. Four review rounds each found a checkout
  shape the search missed (the last: a project in a subdirectory of its
  repository). The fingerprint is a pure function of the policy in force, so
  the fix belongs there: `policyFingerprint` leaves `coverageFloor` and
  `failOnContrarySignals` out while each holds exactly the value `init` writes
  (`SHOWN_HARNESS_DEFAULTS` in `harness-config.js`). Writing them then changes
  no fingerprint anywhere — no search, so no checkout shape to miss.
- **D2 — Only a new file gets the keys.** `ensureHarnessConfig` (used by `init`
  and `upgrade`) writes only when `harness.json` is missing, as before.
  `harness init` on an existing file, with or without `--force`, completes it
  with `defaultHarnessConfig()` only, as before (26-06's test pins it). A user's
  file is never rewritten to show the keys; `ai-flow rules` shows them there.
- **D3 — A non-default value is still policy.** Only an exact match of the
  written default is left out (canonical JSON). `failOnContrarySignals: true`,
  or a `coverageFloor` that differs in any level, or a partial one, is hashed
  as before. Tests pin both (`a non-default … still moves the fingerprint`,
  `a partial coverageFloor, even at default values, moves the fingerprint`).
- **D4 — One place for the shown values.** `SHOWN_HARNESS_DEFAULTS` lives in
  `harness-config.js` (the guard's module graph already loads it; it adds no
  module). The registry test (`harness init writes coverageFloor and
  failOnContrarySignals with their defaults`) checks it against
  `rules-registry.js`'s defaults, so the two cannot drift.
- **D5 — Upgrade cost.** A project that had written exactly these default
  values by hand sees its fingerprint change once with this version (stated in
  the CHANGELOG). The fingerprint already includes the tool's major.minor
  version, so this costs nothing extra **if** the release carrying this story is
  a minor: package.json is 0.15.0 and the run plans 0.16.0 for wave 2, so it
  is. Were it shipped in a patch, those projects would re-prove once.
- **D6 — An unparsable `harness.json` is not a missing one** (review round 1,
  pre-existing). `harness init` read it with `readJson`, got `null`, and
  replaced it without `--force`, against AGENTS.md's never-overwrite rule. It
  now refuses (file and parse error named, exit 1, `--dry-run` too); `--force`
  replaces it with a new file and says so. A file parsing to a non-object
  counts as existing.

## Tests changed

Two 26-06 tests pinned that `init` writes no `coverageFloor` when proofs exist
(the old detection's mechanism). Criterion 1 here requires the opposite, so
their `coverageFloor` assertion became "the key is written"; the outcome they
protected — the fingerprint is unchanged — is asserted in both (it was asserted
in only one before) and, across real checkouts, in
`test/init-rules-fingerprint.test.js`.

## Out of scope (noted)

`init` writing `config.json` for the first time moves the fingerprint on its own
(its `validation` block), before and after this story. A project with recorded
proofs already has its `config.json`, so this does not touch the criteria.
