# Story 21-03 — Insights across projects

## User Value

`ai-flow insights --all` reads every project's exported insights from the
vault and shows the same metrics side by side, and marks a pattern seen in
two or more projects as a tool problem — a note in `coding-flow/patterns/` —
rather than a project problem.

## Requirements

- `insights --all [--json]`: reads `coding-flow/projects/*/insights/` through
  `vault.js` (read side added), one column per alias.
- Pattern detection, deterministic: the same failing-test cause, gate, stop
  cause, review finding category or `Needs you` topic recurring in ≥ 2
  projects within 60 days → `coding-flow/patterns/<slug>.md` with links to
  each project's evidence note; updated, never duplicated.
- Read data is treated as data: values are parsed against the export schema;
  unknown fields are ignored.
- No vault → the command says so and exits 0.

## Acceptance Criteria

- [ ] Given two fixture projects in a temp vault, when `insights --all` runs,
      then both columns print with their counts.
- [ ] Given the same flaky test cause in both, then one pattern note exists
      with links to both projects.
- [ ] Given a second run, then the pattern note is updated, not duplicated.
- [ ] Given a malformed project export, then it is skipped and named.

## Edge Cases

- One project only: no patterns, the command still prints.

## Out of Scope

- Proposing changes from patterns (epic 23).
