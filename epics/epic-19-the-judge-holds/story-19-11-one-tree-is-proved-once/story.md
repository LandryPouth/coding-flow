# Story 19-11 — One tree is proved once

## Status: planned

Risk: STANDARD (`worktree land`'s re-verify, the `flow-run` skill). Owner: agent.

## Why

On 2026-11-25 the unattended run started 15 verifies in three hours, not
counting the `npm test` runs and pre-push suites. The full suite takes 8 to 13
minutes on a loaded machine, so the two heavy slots stayed full and agents
spent more time waiting for a slot than working. Most of those runs proved a
tree that had already been proved:

- **Landing ran the suite three times per story.** The run's land script ran
  `verify --story`. `worktree land` requires that fresh verify, merges
  fast-forward, and then runs its own re-verify (`verifyStoryOnce`, no reuse).
  The script then ran `verify --base` on develop. After a fast-forward,
  develop's tree is the story's tree: the last two runs proved nothing new.
- **Agents ran `npm test` and then `verify`.** `verify` runs the same suite.
- **Agents merged develop each time another story landed**, then re-verified.
  The land step merges develop and verifies the result anyway.

The interim fix lives in the run's scripts (see the 2026-11-25 entry in
`docs/plans/autonomous-run.md`). This story moves it into the tool so every
user gets it.

## Requirements

- **`worktree land` reuses the story's proof.** It already refuses without a
  fresh, green story verify. When the merge is a fast-forward, the landed tree
  is the tree that verify proved, under the same policy. In that case land
  skips its post-merge re-verify and says
  `re-verify skipped: <tree> was proved by <evidence>`. When the target moved
  (a rebase replay or a merge commit), the tree is new and the re-verify runs
  as today. `--reverify` forces it.
- **The landed evidence says how the tree was proved.** Land's journal entry
  and `status` name the evidence that proved the landed tree, whether it was
  reused or freshly run, so the proof chain stays readable.
- **The `flow-run` skill says verify is the suite.** It gets one short
  paragraph:
  - `verify` runs the project's checks, so don't run the test command right
    before it;
  - while fixing, run only the affected test files;
  - run one `verify` before reporting;
  - don't merge the base branch into a story branch on every landing
    elsewhere, because landing merges it and proves the result.
- **The `epic-run` guidance in `docs/` says the same** wherever it describes
  the implementer's loop.

## Acceptance Criteria

- [ ] Given a story with a fresh green verify and a target that has not moved,
      when `worktree land` runs, then it lands without running the validation
      commands again. It prints that the re-verify was skipped and names the
      evidence. (Test: the validation command appends to a file; the file has
      one line, the story verify's, after land.)
- [ ] Given a target that moved since the story verify, so that land rebases
      or merges, then the post-merge re-verify runs. A red re-verify still
      rolls the landing back.
- [ ] Given `--reverify`, then the re-verify runs even on a fast-forward.
- [ ] Given a policy change (`harness.json`) between the story verify and
      land, then the verify is stale and land refuses, as today.
- [ ] The `flow-run` skill template carries the paragraph above.
      `plugin sync` is run, and its eval case covers "runs the test command
      right before verify" as a miss.

## Edge Cases

- A worktree with uncommitted changes: the tree token differs from the
  committed tree, so the existing staleness check refuses.
- A story verify made with `--no-cache` or `--clean-env` is a normal proof
  and can be reused.

## Out of Scope

- How many heavy runs share a machine. That is story 19-03, which now also
  reads the load average.
- Skipping the pre-push hook's suite: it is the user's hook, not the tool's.
