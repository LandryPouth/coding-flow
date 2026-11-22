# Epic 24 — Many hands

## Goal

The factory works with more than one chain, one machine and one person:
worktrees are ready to run and leave nothing behind; two independent chains
run at once and their merge is re-verified before it counts, never with more
agent processes than the machine carries (4 with room, 2 under WSL); two epics share the machine when
nothing forbids it and land one after the other; locks are seen
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
- **The maintainer already runs two at a time, by hand** (two stories or two
  epics, two agents max including sub-agents, through a personal skill).
  Until this epic, the native run is a chain only.
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
- `run.maxParallel` (default 2, the maintainer's cap 2) with a merge queue:
  integrating a chain re-verifies the merged tree and reviews the crossing.
  Chains include branches after a branch point, not only independent roots.
- `run.maxAgents` (machine setting, `auto` = 4, or 2 under WSL / < 16 GB;
  any value the user sets is honoured; the auto values are the
  maintainer's machines, documented as reference profiles): machine-wide
  agent slots shared by every run.
- *Shared identifiers* declared in plans and compared like files.
- Two epics at once: epic dependencies, overlap check, a base queue that
  re-verifies the later epic against the earlier one.
- Locks as git refs shared through the remote.
- `land: local | pr` per project.
- Remote verify through `ai-flow ci`, with evidence re-checked.
- Questions routed by `autonomy.md` owners; project policy vs personal
  preferences.

**Out of scope**

- The GitHub issues storage backend (the 2026-11-10 session's issue format is
  kept in the research notes for a later epic; the vault and local epics serve
  until then).
- More than 2 parallel chains by default; raising that cap is a maintainer
  decision taken on `insights` numbers. Agent processes are the user's
  machine setting (24-02), not a cap of this epic.
- Choosing which epic runs next: the maintainer starts each run.

## Backbone

`Backbone: a worktree is ready and leaves nothing → two chains run and their merge is re-verified → two epics share the machine and land one after the other → locks are seen across machines → a team lands through PRs → verify runs on a trusted runner → a question finds its owner and policy is told from preference`

### Story dependency tree

```text
s1
└── s2
    └── s7

s3
└── s4

s5

s6
```

s2's merge queue lands chains through s1's land path; s7 reuses s2's agent
slots and merge queue (base as target). s4's PR land claims and
releases s3's shared locks. s5 (CI runner and evidence re-check) and s6
(routing and policy precedence) touch disjoint modules.

## Stories

1. [story-24-01-a-worktree-is-ready-and-leaves-nothing](story-24-01-a-worktree-is-ready-and-leaves-nothing/spec.md) *(STRICT — deletes worktrees and stops processes)*
2. [story-24-02-two-chains-run-and-their-merge-is-re-verified](story-24-02-two-chains-run-and-their-merge-is-re-verified/spec.md) *(STRICT — unattended merges)*
3. [story-24-03-locks-are-seen-across-machines](story-24-03-locks-are-seen-across-machines/spec.md) *(STRICT)*
4. [story-24-04-a-team-lands-through-pull-requests](story-24-04-a-team-lands-through-pull-requests/spec.md) *(STANDARD)*
5. [story-24-05-verify-runs-on-a-trusted-runner](story-24-05-verify-runs-on-a-trusted-runner/spec.md) *(STRICT — trust in evidence)*
6. [story-24-06-a-question-finds-its-owner](story-24-06-a-question-finds-its-owner/spec.md) *(STANDARD)*
7. [story-24-07-two-epics-run-at-once](story-24-07-two-epics-run-at-once/spec.md) *(STRICT — unattended merges against the base)*

## Decisions

- **The merge queue is local and sequential:** chains finish in parallel,
  integrate one at a time; each integration re-runs verify on the merged tree
  and an independent review of the files both chains touched. A red merge
  parks the later chain, never the earlier.
- **Two caps**: chains (`maxParallel`) bound what must be re-merged; agent
  slots (`maxAgents`) bound the machine and the spend. Four slots let two
  chains each keep a reviewer running without waiting; two slots (WSL)
  serialise reviewers. Agents are per machine, chains per project.
- **Serial paths wait**: migrations, schema files, lockfiles and generated
  clients conflict by construction, so two chains or epics touching them
  never run at once; other shared files are reviewed at the merge.
- **Locks as refs** (`refs/coding-flow/locks/<story>`), pushed and fetched
  explicitly; a lock carries holder, host, pid, heartbeat; a stale lock is
  reported with its age, never broken silently.
- **Local evidence is a claim in team mode.** With `land: pr`, the PR body
  carries the local evidence; the runner's verify is the proof the merge
  waits for.
- **Personal preferences** live in the user's global config next to the vault
  path; project policy wins on any topic it names.

## Dependencies outside this epic

Epic 20 (driver, run state 20-06, no sub-agents 20-01), epic 19 s3 (machine
verify queue), epic 18 s2 (proof survives the land), epic 22 s1
(`autonomy.md` owners, s6 only).

## Delivery order

s1 → s2 → s7 are delivered right after epic 20, before epic 21: they need
only epics 18, 19 and 20, and until they ship the native run is a chain
while the maintainer runs two at a time by hand. s3–s6 (team mode) stay
last. `maxParallel` ships at 2 (maintainer, 2026-11-13: running two at once
by default surfaces cross-chain errors early; a project sets 1 to opt out);
`maxAgents` is `auto` per machine (4, or 2 under WSL; maintainer,
2026-11-13).

## Risks

- **A tree that lies about independence.** Parallel-safety rests on the
  plan's tree and *Likely files*; bethl had two "independent" stories
  pushing one enum value in opposite directions (DOGFOODING 2026-08-30) and
  two parallel stories of epic 37 crossing unseen. Net: overlap check,
  merged verify, crossing review. Known limit: a shared value with no shared
  file is caught only if a test or the reviewer sees it.
- **Merge debt.** The later chain or epic pays the integration; a park late
  in an epic wastes its spend. Mitigation: serial paths wait up front; park
  rather than auto-resolve.
- **Shared runtime.** One dev database, ports, memory (bethl: exit 143 with
  `next dev` at 5.5 GB). Mitigation: serial migrations, heavy verifies bounded per
  machine (19-03, `verify.maxConcurrent`), `serve` ports; the data itself is still shared.
- **Usage limits.** Four agents on one subscription reach the account's
  window quickly; 20-03 pauses the whole run instead of burning attempts.
- **Spend and review load double.** Two agents spend twice as fast and land
  twice as much for one person to read. Caps per run stay required (20-06);
  `REPORT.md` per epic.
- **Unmeasured until epic 21.** Delivering before `insights` means the first
  parallel runs are judged on the journal (epic 18), not on dashboards. The
  default is 2 anyway, by choice: errors between chains show up early, while
  the merged verify and crossing review still guard each integration.
- **Uncounted agents.** Interactive sessions and other tools on the machine
  take no slot; the cap is the tool's, not the machine's.

## Readiness

`ready` for s1, s2 and s7; s3–s6 are `ready` as designs but should be re-read
against the first month of epic 20 runs before they start (a labeled
assumption, not a blocker).
