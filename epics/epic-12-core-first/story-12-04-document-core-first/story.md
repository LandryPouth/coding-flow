# Story 12-04 — Document the core first

README and QUICKSTART lead with the workflow (`/flow-plan` → `/flow-run` →
`/flow-ship`). The audit's advice — and this epic — is to present the core as
the product and the rest as layers you add when they pay for themselves.

*(QUICK — documentation only.)*

## Acceptance Criteria

- [ ] README opens with **Core**: what `init --minimal` installs (guard,
      verify, evidence, freshness, coverage gate, `doctor`, `report`), what
      it guarantees, and a link to "What the guard does not see" (05-05).
- [ ] Then **Optional layers**, one row each — skills, stories/epics,
      worktrees and placement, review evidence, `ship`/auto-merge — with
      what it adds, what it costs, and the command to enable it.
- [ ] QUICKSTART's first path is the minimal install on an existing repo
      (5 commands max); the full workflow comes second.
- [ ] `docs/design-decisions.md` gains an entry "Core first" summarising the
      boundary (link to epic-12) and the **open question** for the
      maintainer: should plain `init` default to minimal? Arguments both
      ways, no decision taken here.
- [ ] Links checked (`grep` for every relative link target).

