# Epic 05 — Guard hardening: real paths, the shell's own cwd, and an honest "not checked"

## Goal

The guard decides on the file a write will **actually** reach — through
symlinks, `cd`, `~`, absolute paths into the primary checkout — and when it
cannot tell, it says "unchecked" instead of "allowed". In `mode: strict`,
"unchecked" refuses.

## Why

Replayed against the real `evaluate()` on 2026-10-16
(`docs/plans/hardening-roadmap.md`, Guard table). The obvious cases are
refused; these are **allowed**:

- a symlink to `.env` (`Write alias`, `echo > alias`, `ln -s .env x && echo > x`);
- `cd sub && echo > ../.env` (targets are resolved against the root, `cd` is
  ignored);
- `echo >> ~/.ssh/authorized_keys` (`~` not expanded);
- an absolute path outside the root — which includes the **primary checkout's
  `.env` seen from a story worktree** (worktrees symlink `.env`), and the
  repository's `.env` when the session's cwd is a monorepo subdirectory (root
  = hook `cwd`);
- `git checkout <ref> -- .env`;
- `F=.env; echo > $F`, `python -c "open('.env','w')"`, `bash script.sh`;
- an unknown tool name, an unparseable input, or any exception → allow, and
  the decision looks identical to "checked and fine".

The README already says the guard is not a sandbox, and it should stay that
way: interpreters and scripts cannot be fully read. But the first five rows
are plain path-resolution bugs, and the last one makes a non-check
indistinguishable from a pass — which is exactly what the external audit
called its P1.

## Scope

**In scope**

- Path resolution: project root from git/`.coding-flow`, not the hook cwd;
  lexical **and** real path (symlinks, nearest existing parent for new files);
  outside-root real paths checked against the primary checkout and `$HOME`;
  `~` and `$HOME` expansion.
- A third decision, `unchecked`, with a reason, logged and surfaced.
- Shell: `cd`/`pushd` tracking inside one command, `ln` creating an alias to
  a protected path, `git checkout|restore … -- <path>`, inline interpreter
  code naming a protected path, variables in a write target → `unchecked`.
- `mode: strict` (existing `harness.json` key) turns `unchecked` into deny on
  every host (Claude hook, OpenCode plugin).
- One adversarial corpus test file and a README section listing what is still
  out of reach.

**Out of scope — decisions made while planning**

- **A shell parser or a sandbox.** Scripts, compiled programs and downloaded
  code stay out of reach by design; the answer for them is OS isolation, and
  the README says so. A guard that tries to emulate bash grows regexes
  forever.
- **TOCTOU.** A check-then-write race cannot be closed from a pre-tool hook.
  Documented, not attempted.
- **Default fail-closed.** `standard` mode keeps today's ergonomics; only the
  visibility changes. A gate that fires wrongly gets turned off
  (DOGFOODING.md).

## Backbone

`Backbone: a tool call arrives → targets are resolved the way the filesystem will resolve them → each target is allow / deny / unchecked with a reason → deny and unchecked are logged → strict mode refuses unchecked → report/doctor show how many writes were not checked`

### Story dependency tree

```text
s1
└── s2
    └── s3
        └── s4
            └── s5
```

One chain, one worktree: every story edits `bin/lib/guard.js`.

## Stories

1. **story-05-01-resolve-paths-like-the-filesystem** — root, symlinks,
   outside-root, `~`. *(STRICT)*
2. **story-05-02-unchecked-is-not-allowed** — the third decision, logged and
   surfaced; exceptions and unknown write-shaped tools become `unchecked`.
   *(STRICT)*
3. **story-05-03-follow-the-shell** — `cd`, `ln`, `git checkout --`,
   interpreters, variables. *(STRICT)*
4. **story-05-04-strict-mode-fails-closed** — `mode: strict` refuses
   `unchecked`, on Claude and OpenCode, including "guard module could not
   load". *(STRICT)*
5. **story-05-05-adversarial-corpus-and-honest-limits** — one table-driven
   test file holding every case above; README "What the guard does not see".
   *(QUICK)*

## Decisions

- **Deny if either the lexical or the real path is protected.** Checking only
  the real path would let `.env` (a worktree symlink pointing outside the
  worktree) through; checking only the lexical path is today's bug.
- **`unchecked` is a decision, not a log level.** It travels in the same
  result object as allow/deny so every host (hook, plugin) and every reader
  (`report`, `doctor`) gets it without a side channel.
- **Depends on epic-06 having landed** (the OpenCode plugin body changes in
  06-01 and again in 05-04).

## Readiness

**ready** once epic-06 has landed.

## First story to run

`story-05-01-resolve-paths-like-the-filesystem` via `/flow-run`.
