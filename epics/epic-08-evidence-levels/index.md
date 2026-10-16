# Epic 08 — Evidence that knows its own strength and the policy it was made under

## Goal

A green verify carries a rung (`verified` > `evidence` > `exempted` >
`not-required`) that **gates** according to policy, is invalidated when the
policy changes, and cannot stay green next to signals that contradict it
(deleted tests, open acceptance criteria, a "pass" review with an open P1)
when the project asks for strictness.

## Why

The vocabulary already exists — `coverage.js` `COVERAGE_TIERS` and
`coverageTier()`, printed by `printVerify` — so the external audit's
"make the levels impossible to confuse" is half done. What is missing,
measured on bethl (`docs/plans/hardening-roadmap.md`):

- **The rung never gates.** 180 green runs reached `evidence` (a test file
  changed, nothing measured); `ok: true` either way. `status`, `audit`,
  auto-land and `ship` read `ok`.
- **Policy changes do not invalidate proofs.** `findReusableVerify`
  (`harness.js` ~2344) keys on tree token (excludes `.coding-flow/`),
  `commandsFingerprint`, untracked digest. Editing `harness.json` (risk
  terms, coverage reports, mode, blocked paths) leaves `verify` answering
  "already proved".
- **Contrary signals do not change the verdict.** 42 green runs carried
  `weakenedTests`, 103 had unchecked acceptance criteria. Printed, never
  weighed.
- **Review verdicts are self-reported.** 94/99 bethl reviews are
  `reviewer: self`; one `verdict: pass` has an open P1.

## Scope

**In scope**

- `harness.json` `coverageFloor` per risk level, applied to `ok`, with
  defaults that keep today's behaviour in `standard` and raise it in
  `strict`.
- `policyFingerprint` in every evidence; reuse and freshness require it.
- In `strict` mode (and for `high`-risk stories in any mode, as warnings):
  deleted test files and unchecked acceptance criteria fail the verify unless
  exempted in writing.
- `review capture` refuses `--verdict pass` with open P0/P1 unless
  `--accept "<reason>"`; `status` flags STRICT stories whose only review is
  `self`.

**Out of scope — decisions made while planning**

- **Signed or remote attestations.** For a single maintainer the answer to
  "the JSON could be edited" is that CI re-runs the commands; a signature
  proves who wrote a file, not that the tests ran. Revisit for team use.
- **Semantic test-quality analysis** (mutation testing, assertion
  semantics). Out of reach of a zero-dependency CLI; the weakening detector
  stays a labelled heuristic.

## Backbone

`Backbone: verify computes the rung → policy sets the floor for this risk → ok reflects the floor → the evidence stores the policy fingerprint → a policy edit makes it stale → contrary signals fail strict runs → status/ship/audit show rung and reasons`

### Story dependency tree

```text
s1
└── s3

s2

s4
```

`s2` and `s4` touch different code (reuse/freshness; review capture/status)
and can run in parallel with the `s1 → s3` chain.

## Stories

1. **story-08-01-coverage-floor-gates-ok** — `coverageFloor` by risk;
   `ok` false below it; rung shown in `status`, `ship`, `audit`. *(STRICT)*
2. **story-08-02-policy-fingerprint** — evidence stores a hash of the
   effective policy; reuse and `audit`/`status` freshness require it.
   *(STRICT)*
3. **story-08-03-contrary-signals-fail-strict-runs** — deleted tests and open
   criteria fail in strict / on high risk, unless exempted. *(STRICT)*
4. **story-08-04-review-verdicts-that-hold** — no "pass" with open P0/P1
   without a written acceptance; self-only review on STRICT is visible.
   *(STANDARD)*

## Decisions

- **Defaults preserve today in `standard`.** `coverageFloor` default:
  `{ high: "evidence", medium: "evidence", low: "not-required" }` in
  standard, `{ high: "verified", medium: "evidence", low: "not-required" }`
  in strict. A floor that blocks most runs on day one gets switched off.
- **Depends on epic-07.** A floor on a rung computed over the wrong diff
  would block or pass for the wrong reasons; run 07-01 first.
