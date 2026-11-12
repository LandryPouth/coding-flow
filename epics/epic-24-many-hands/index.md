# Epic 24 — Many hands

## Goal

The factory works with more than one chain, one machine and one person:
worktrees are ready to run and leave nothing behind; two independent chains
run at once and their merge is re-verified before it counts; locks are seen
across machines; a team lands through pull requests; verify can run on a
runner the team trusts; a question reaches the person who owns its topic; and
the project's policy is told apart from one person's preferences.

## Why

- **The worktree is the unit of autonomy, and it leaks.** bethl: `node_modules`
  links refused by Turbopack and the scanner (`EISDIR`, 10 occurrences),
  `.env` copied by hand for every worktree, dev servers left running after
  `worktree remove`, `land` that stops on a dirty primary checkout instead of
  waiting, no first-class "one epic in one worktree" land, branch names that
  break `autoland` when the project imposes a pattern (DOGFOODING bilan P2).
- **Parallel work moves the conflict to the merge.** Research: worktrees shift
  conflicts (including semantic ones) to integration; Gas Town's Refinery and
  the C compiler's late CI exist for that reason. bethl's parallel epics
  37/38 collided on shared files (DOGFOODING 2026-11-12).
- **Team mode is the maintainer's explicit goal** ("prêt pour tourner dans
  une team"). Today: locks are local files, land is a local merge, evidence is
  trusted because it is on the laptop, and questions are answered by whoever
  runs the session.

## Scope

**In scope**

- Worktree lifecycle: deps installed (never linked) by default where links
  break, declared env files copied, servers started from the worktree stopped
  on remove, land-when-clean, an epic landed from one worktree, the project's
  branch-name policy honoured.
- `run.maxParallel` (default 1, the maintainer's cap 2) with a merge queue:
  integrating a chain re-verifies the merged tree and reviews the crossing.
- Locks as git refs shared through the remote.
- `land: local | pr` per project.
- Remote verify through `ai-flow ci`, with evidence re-checked.
- Questions routed by `autonomy.md` owners; project policy vs personal
  preferences.

**Out of scope**

- The GitHub issues storage backend (the 2026-11-10 session's issue format is
  kept in the research notes for a later epic; the vault and local epics serve
  until then).
- More than 2 parallel chains by default; raising the cap is a maintainer
  decision taken on `insights` numbers.

## Backbone

`Backbone: a worktree is ready and leaves nothing → two chains run and their merge is re-verified → locks are seen across machines → a team lands through PRs → verify runs on a trusted runner → a question finds its owner and policy is told from preference`

### Story dependency tree

```text
s1
└── s2

s3
└── s4

s5

s6
```

s2's merge queue lands chains through s1's land path. s4's PR land claims and
releases s3's shared locks. s5 (CI runner and evidence re-check) and s6
(routing and policy precedence) touch disjoint modules.

## Stories

1. **story-24-01-a-worktree-is-ready-and-leaves-nothing** *(STRICT — deletes worktrees and stops processes)*
2. **story-24-02-two-chains-run-and-their-merge-is-re-verified** *(STRICT — unattended merges)*
3. **story-24-03-locks-are-seen-across-machines** *(STRICT)*
4. **story-24-04-a-team-lands-through-pull-requests** *(STANDARD)*
5. **story-24-05-verify-runs-on-a-trusted-runner** *(STRICT — trust in evidence)*
6. **story-24-06-a-question-finds-its-owner** *(STANDARD)*

## Decisions

- **The merge queue is local and sequential:** chains finish in parallel,
  integrate one at a time; each integration re-runs verify on the merged tree
  and an independent review of the files both chains touched. A red merge
  parks the later chain, never the earlier.
- **Locks as refs** (`refs/coding-flow/locks/<story>`), pushed and fetched
  explicitly; a lock carries holder, host, pid, heartbeat; a stale lock is
  reported with its age, never broken silently.
- **Local evidence is a claim in team mode.** With `land: pr`, the PR body
  carries the local evidence; the runner's verify is the proof the merge
  waits for.
- **Personal preferences** live in the user's global config next to the vault
  path; project policy wins on any topic it names.

## Dependencies outside this epic

Epic 20 (driver), epic 18 s2 (proof survives the land), epic 22 s1
(`autonomy.md` owners).

## Readiness

`ready` for s1 and s2; s3–s6 are `ready` as designs but should be re-read
against the first month of epic 20 runs before they start (a labeled
assumption, not a blocker).
