# Story 04-01 — Capture durable review evidence

## User Value

A `/flow-review` verdict stops being prose only the session that wrote it can
vouch for. It becomes a fact — pass or fail, fresh or stale against the
current tree — that any later session, or the tool itself, can read back
without re-reading the whole diff and narrative from scratch. Nothing gates
on it yet (that is story-04-02); this story only makes the fact exist and be
visible.

## Requirements

- After a `/flow-review` pass reaches a verdict, it (via a new
  `ai-flow review capture` command) writes an evidence file into
  `.coding-flow/runs/` — the same directory `verify` evidence already lives
  in — recording: `generatedAt`, `story` (project-relative path), `ok`
  (boolean — `verdict === "pass"`), `verdict` (`"pass" | "fail"`),
  `dimensions` (which of architecture/tests/security/quality/e2e ran, and at
  what depth: `"quick" | "deep" | "skipped"`), `findingCounts` (`{p0,p1,p2,p3}`
  — counts only, not the full finding text, to keep the file small),
  `reviewer` (`"self" | "subagent"`), and `provenance.git.treeToken`
  (`identity.js`'s `currentTreeToken`, the exact same token `verify` evidence
  already captures).
- A reader — `latestReviewByStoryDir(cwd)` in `bin/lib/audit.js`, mirroring
  the existing `latestVerifyByStoryDir` exactly in shape and multi-run
  handling (latest by `generatedAt` wins) — returns the most recent review
  evidence per story directory.
- Freshness reuses `audit.js`'s existing `isStale(entry, currentToken)`
  unchanged: a review evidence entry is shaped so `isStale` can be called on
  it exactly as it already is on a verify entry, with no new staleness rule.
- `ai-flow status` gains a `review` field per story: `"pass"` (fresh),
  `"stale"` (evidence exists, tree moved since), `"fail"`, or `"none"` (no
  evidence ever captured) — read the same way `status.js` already reads
  `landReady`/verify freshness, from the story's own worktree when one
  exists.
- `skills/flow-review/SKILL.md` (and its synced copy under
  `templates/.claude/skills/`) gains a final step in its Output contract:
  after producing the Verdict/Findings markdown, call
  `ai-flow review capture --story <dir> --verdict pass|fail ...` so every
  invocation of the skill leaves durable evidence, not only terminal output.

## Acceptance Criteria

- [x] Given a `/flow-review` pass completes with verdict `pass`, when it runs
      `ai-flow review capture --story <dir> --verdict pass`, then a review
      evidence file exists under `.coding-flow/runs/` with `ok: true`, the
      correct story path, and the current tree token.
- [x] Given that evidence was captured and nothing in the tree changes since,
      when `latestReviewByStoryDir`/`ai-flow status` reads it back, then the
      story's review reports fresh-pass.
- [x] Given the tree changes after capture (a real commit touching source
      outside `.coding-flow/`), when read again, then the review reports
      stale — using `isStale` unchanged, not a new rule.
- [x] Given a `/flow-review` pass completes with verdict `fail`, when
      captured, then `ok: false` is recorded and status reports `fail`,
      distinct from `stale` and from `none`.
- [x] Given a story with no review ever captured, when status is read, then
      it reports `none` — not an error, not conflated with `fail`.
- [x] Given two review captures exist for the same story, when read back,
      then only the latest by `generatedAt` is reported — mirroring
      `latestVerifyByStoryDir`'s own multi-run resolution exactly.

## Edge Cases

- **Correctness**: a story with both a verify entry and a review entry must
  keep the two independent — reading one must never require or infer the
  other; story-04-02 is the only place they are combined.
- **Concurrency**: none beyond what already applies to `.coding-flow/runs/`
  today — each capture writes its own timestamped file, no shared state to
  race on, same as `writeVerifyEvidence`.
- **Data**: evidence lives under `.coding-flow/runs/`, this repo's existing
  gitignored (or tracked, project-dependent) convention — no new
  tracked-vs-ignored decision; reuse exactly what `verify` evidence already
  does.
- **UX**: `status`'s four review states (`pass`/`stale`/`fail`/`none`) must
  read unambiguously in both `ai-flow status`'s text output and its `--json`
  form — a future consumer (story-04-02) must be able to branch on the value
  without re-deriving it.

## Out of Scope

- Gating anything on this evidence (auto-land, `next`'s ready-to-ship tier) —
  story-04-02.
- Storing full finding text/severity detail beyond counts — evidence stays
  small and mechanical, like `verify`'s own evidence; the findings themselves
  still live in the review's own markdown output and, when relevant, the
  story's `## Result`.
- Any change to how `/flow-review` decides its verdict, which dimensions run,
  or Quick vs. Deep — story-04-04.
