# Evidence hardening: freshness, reproducibility, local gate

> Three changes that tighten the "proven, not asserted" spine where it was still
> loose. The evidence layer already *executes* guardrails and attaches a *human
> identity*; these close the gaps that let a proof drift from the code, hide the
> environment it ran on, or escape a machine before the gate saw it.

## Thesis

An evidence layer is only as strong as the weakest link between "the machine
proved X" and "X is true of what ships". Three links were weak:

1. **Freshness.** A green `verify` counted forever, even after the code changed.
   A *stale* proof silently passed as a current one — exactly what an auditor
   attacks first.
2. **Reproducibility.** A green run recorded *what* passed but not the *toolchain*
   it passed on, so "green here" was not auditable as "green on this environment".
3. **Locality.** The hard gate (`audit --check`) lived only in CI, so a red or
   stale proof could still be pushed and only fail after the fact.

## Non-negotiable constraints (inherited)

- **Zero runtime dependencies.** `node:*` + optional `git` shell-out only.
- **Nothing blocks by surprise.** The local gate is opt-in; freshness degrades to
  the old lenient behavior outside git or on tokenless evidence.
- **Idempotence + `--dry-run`.**
- **Evidence is the truth.** Freshness is decided from a captured token, not from
  the agent's word.

---

## #1 — Evidence freshness (anti-stale proof)

**Intent.** Make a green `verify` count only for the code it actually proved.

- `identity.js` captures a **working-tree content token** with every evidence
  (`git.treeToken`): `git stash create` gives a tree of the dirty working tree
  without touching refs/index/worktree; we hash its top-level `ls-tree` listing
  **minus `.coding-flow/`** (the evidence home — letting the proof's own outputs
  into the token would be absurd). The token is content-addressed, so it is
  **stable across the commit** that materializes exactly what was verified, and
  moves the moment any source content changes.
- `audit.js`: `entryFromRunFile` carries `treeToken`; `gate` gains a `stale`
  bucket (green latest verify whose token ≠ the current one) and `audit --check`
  computes the current token and fails on stale. `latestVerifyByStoryDir` carries
  the token too.
- `storage/local.js`: `inferStoryStatus` gains a `fresh` signal — a green but
  stale proof reads as **`stale`**, not `verified`. `listEpics` computes the
  current token once per listing.
- **Decidable only when both tokens exist.** Outside git, or on pre-freshness /
  non-git evidence, the check stays lenient (green → verified, gate passes).

**Acceptance:** green verify → `verified`; edit tracked code → `stale` and
`audit --check` fails; re-verify → `verified`; committing the exact verified
content stays `verified` (no false stale); tokenless evidence never goes stale.
Proven in `test/evidence-freshness.test.js`.

## #2 — Reproducibility fingerprint

**Intent.** Make a green run auditable as "green on this exact environment".

- `harness.js` (`verify`): the evidence gains an `environment` block — Node
  version, `platform`/`arch`, and the **sha256 of the dependency lockfile** (first
  of `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lockb`), or `null` when none exists. `crypto` only, no new dependency.
- `ship.js`: the PR evidence block shows a one-line **Toolchain** summary.

**Acceptance:** verify evidence carries `environment.node/platform/arch`; a present
lockfile is hashed (full sha256); absent → `null`. In `test/harness-verify.test.js`.

## #3 — Opt-in local pre-push gate (`ai-flow hook`)

**Intent.** Catch a red/missing/stale proof before it leaves the machine, without
forcing anything on anyone.

- New `bin/lib/hook.js`: `ai-flow hook install|uninstall|status`. Installs a
  **marker-delimited managed block** into git's resolved `pre-push` path
  (`git rev-parse --git-path`, so it honors `core.hooksPath` and worktrees),
  preserving any existing user hook. The hook runs `ai-flow audit --check`; it
  **degrades cleanly** (a `version` probe; skip with exit 0 if the CLI cannot
  run) and blocks the push (exit 1) on a failing gate. Idempotent, `--dry-run`,
  and uninstall drops the file only when nothing but our block remains.
- New `ai-flow version` command (also the hook's availability probe).
- **Never wired by `init`.** It mutates the user's git hooks, so it is a command
  the user runs deliberately. CI stays the hard guarantee; this is local
  convenience.

**Acceptance:** install is idempotent and executable, preserves a user hook,
blocks on a failing gate, passes on a fresh green proof, skips when the CLI is
absent, and uninstall is clean. Fails cleanly outside a git work tree. In
`test/hook.test.js`.

---

## Explicitly out of scope (do NOT do)

- No freshness enforcement outside git (no token → no claim).
- No per-file story-scoped diffing: the token is repo-wide source content minus
  the evidence dir — coarse but sound and cheap. A finer per-story scope can come
  later if a real need appears.
- No pre-push hook enabled by default, ever.
- No bundled toolchain manager; we only *record* the environment, we do not pin it.

## Resume checklist

- [x] **#1 Freshness — shipped.** `treeToken` in `identity.js`; `stale` in
      `status` and `audit --check`; content-addressed (survives commit), lenient
      without a token. `test/evidence-freshness.test.js`.
- [x] **#2 Fingerprint — shipped.** `environment` (node/platform/arch + lockfile
      sha256) in the verify evidence; Toolchain line in `ship`.
      `test/harness-verify.test.js`.
- [x] **#3 Local gate — shipped.** `ai-flow hook install|uninstall|status` +
      `ai-flow version`; opt-in, idempotent, `--dry-run`, degrades cleanly.
      `test/hook.test.js`.
