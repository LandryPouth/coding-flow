# Story 05-04 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/guard.js` (`guardCommand`, `evaluate`: map
  unchecked by mode), `bin/lib/opencode.js` (`PLUGIN_BODY`: read
  `harness.json` once at load, throw on no-decision in strict),
  `bin/lib/doctor.js`, `templates/RULES.md` (or wherever RULES is generated —
  grep `RULES.md` in `templates.js`), `README.md`, tests.
- **Search anchors**: `allowedModes` (harness.js ~1105), `loadPolicy`
  (guard.js ~100) — add `mode` to the loaded policy.

## Decisions

- Strictness lives in `harness.json`, not in an env var: it must be
  reviewable in the repo and identical for every agent host.
