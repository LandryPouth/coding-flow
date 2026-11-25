# Story 32-03 — A waste becomes a proposal

## User Value

After a snapshot, the bench names what wasted time or tokens, with the
numbers, and writes it as a proposal the maintainer can accept or refuse. The
lessons found by hand on 2026-11-25 become rules that run every time.

## Requirements

- **`node evals/bench/detect.js <snapshot> [--previous <snapshot>]`** runs a
  fixed set of detectors over a snapshot (32-01) and the project histories. The
  first ones are the patterns found by hand on 2026-11-25:
  - `same-tree-proved-twice`: two or more verifies on the same tree token and
    policy fingerprint;
  - `implementer-context`: an implementer averaging over 150 k context per
    turn;
  - `orchestrator-context`: a main session reading more tokens than all its
    agents together;
  - `long-story`: a story with more than 4 review rounds. The proposal names
    whether its spec made an open promise (it reuses 31-03's detector once that
    story lands);
  - `slot-wait`: verify waits longer than 20 minutes, when the evidence
    records the wait (19-03);
  - `red-rerun`: a red verify followed by a green one on the same tree, which
    points to a flaky test;
  - `exploration-heavy`: exploration calls over 60 % of the shell output.
- **A finding becomes a proposal** in epic 23's format: a vault note in
  `coding-flow/proposals/` (the zone the vault contract opens to agents) with
  `title`, `evidence` (metric, value, window, projects), `change`, `success`
  (metric, target, minimum runs), `risk` and `status: proposed`.
  - At most 3 per pass, ranked by estimated tokens or hours saved.
  - A finding that matches an existing proposal of any status updates that
    proposal's evidence and does not create a new one.
  - A `refused` or `killed` proposal is never re-proposed.
- **`--dry-run`** prints the proposals without writing them.

## Acceptance Criteria

- [ ] Given a fixture snapshot holding two verifies on the same tree, when
      `detect.js` runs, then a `same-tree-proved-twice` proposal is written
      with the count and the hours, in epic 23's format.
- [ ] Given five findings, then at most three proposals are written, the ones
      with the largest estimated saving.
- [ ] Given an existing `refused` proposal for the same detector and scope,
      then no new proposal is written. Given a `proposed` one, then its
      evidence is updated in place.
- [ ] Run on the 2026-11-25 baseline, it proposes at least the
      implementer-context and orchestrator-context findings. The output is
      recorded in the Result.
- [ ] Given `--dry-run`, then nothing is written.

## Edge Cases

- A detector whose data is missing, such as `slot-wait` before 19-03 records
  waits: it says it was skipped, and why.

## Out of Scope

- Applying a proposal, and any model in the loop. Detectors are rules. Epic
  23's watcher may read these proposals later.
