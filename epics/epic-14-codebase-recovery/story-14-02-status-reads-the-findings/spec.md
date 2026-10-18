# Story 14-02 — `status` reads the findings, and "fixed" is derived

## User Value

`ai-flow status` and `/flow-next` show where recovery stands — open findings
by severity, what is proven fixed, what is only claimed, what is accepted and
due for review — so the dossier is a living record the tool checks, not a
report that rots.

## Requirements

- Parse `docs/recovery/findings.md` (and `.coding-flow/recovery/findings.local.md`
  when present, same format; the local file wins for a given ID): `### R-NN`
  blocks and their field lines (14-01 format). Unknown fields ignored;
  malformed blocks listed as unreadable, never dropped silently.
- `status` gains a **Recovery** section only when the file exists:
  counts per state; open findings by severity (top 5 with ID, title,
  location); and these derived flags:
  - **fixed (proven)** — the block has `- Fixed by:` naming a verify run
    whose evidence is ok and (once s3 lands) whose `redAtBase.ok` is true;
  - **fixed (claimed)** — state `fixed` with no such run;
  - **unresolved location** — a `Location:` whose file is missing or whose
    line is past the end;
  - **accepted, no revisit date** and **revisit overdue**.
- `/flow-next` ranks an open `high` security finding above planned stories,
  below a blocked story; suggests `/flow-recover fix R-NN`.
- `doctor` warns when the repository is public (`gh` present) and the
  **tracked** `findings.md` holds an open security finding with a non-empty
  `Trace:`.
- `status --json` exposes the same under `recovery`.

## Acceptance Criteria

- [ ] Given a findings file with confirmed, refuted, mitigated, accepted and
      fixed blocks, then `status` prints the counts and the open ones by
      severity.
- [ ] Given `State: fixed` with no `Fixed by:`, then it reads "fixed
      (claimed)"; with `Fixed by:` naming an ok verify run, "fixed (proven)".
- [ ] Given `Location: src/a.ts:400` and a 120-line `src/a.ts`, then
      "unresolved location" for that finding.
- [ ] Given `State: accepted` without `Revisit:`, or with a past date, then
      the matching flag.
- [ ] Given an open high security finding and a planned story, then `next`
      names the finding first.
- [ ] Given a fake `gh` reporting `PUBLIC` and a tracked findings file with an
      open security trace, then `doctor` warns; with `PRIVATE`, no warning.
- [ ] Given no `docs/recovery/`, then `status` output is byte-identical to
      today's.

## Result
