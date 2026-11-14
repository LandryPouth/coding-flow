# Story 29-05 — The implementer says how sure it is

*(FAST — one rule, read by verify and the driver)*

The implementer writes one line in the story's `## Result`:
`Confidence: low|medium|high — <what it is least sure of>` (agentic-os's
confidence gate). It can only lower what the tool claims: `low` is a
contrary signal `low-confidence` (entry 9), and in driven runs (20-01) it
makes the review deep on every dimension and sends the reason to the
reviewer. `high` changes nothing. A missing line in a driven run is
`low-confidence` too. `/flow-run` asks for the line (one sentence).

## Acceptance Criteria

- [ ] Given `Confidence: low — the cursor with null prices` in the Result, when verify runs in a strict project, then the verdict is NOT PROVEN with `low-confidence` and the reason; in a default project it is listed and the verdict is unchanged.
- [ ] Given `Confidence: high`, when verify runs, then nothing changes (no signal, no raise).
- [ ] Given `AI_FLOW_DRIVEN` and no Confidence line, when verify runs, then `low-confidence` is raised with "not declared".
- [ ] Given the evidence of a story with a Confidence line, then it records `confidence: { level, reason }`.

## Commands

```
npm test
npm run lint
```

## Result
