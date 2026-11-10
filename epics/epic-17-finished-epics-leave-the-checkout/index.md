# Epic 17 — Finished epics leave the checkout, and the index remembers them

## Goal

A finished epic can be archived in one command. Its directory leaves the
checkout, and one file, `epics/INDEX.md`, lists every epic and story, active
or archived, simply enough for any agent or human to see what was done. That
file also says how to recover an archived epic from git. An epic number is
never handed out twice, whether to an archived epic or to one on another
branch.

## Why

- **`epics/` only grows.** On 2026-11-10 it held 15 epics, 65 stories, 177
  files and 1.4 MB, at MVP stage. Every agent glob or grep, and every
  `listEpics` walk, pays for it. The maintainer does not want "une tonne de
  dossiers" in the long run.
- **Proof cannot be the archive gate.** On 2026-11-10 only epic 08 had clean
  proof. Almost every other `done` reads `written; no verify captured` or
  `proof is stale`: autoland deletes evidence along with its worktree (the
  `docs/DOGFOODING.md` row of 2026-11-09), and old proof goes stale as the
  tree moves. The gate is therefore *finished and merged*. The proof state is
  copied as it stands and never upgraded (entry 9: signals only lower
  claims).
- **Archiving opens a numbering hole.** Today `checkDuplicateNumbering`
  (`bin/lib/doctor.js:313`) sees only the directories on disk. Once epic 08
  is gone, a new plan would pick `epic-08-` again, and "story 08-02" would
  then name two different things in commits, DOGFOODING rows and evidence.

**Freeze.** This is DX and performance, which the freeze allows, but it adds
one command, `ai-flow archive`. The test, asked out loud: *if it is not
built, does the tool fail at its mission?* Not the guard's or the proof's.
But the corpus the tool reads grows without bound, and an archive without
collision detection would break story identity. Hence the command, and
collision detection in the same epic.

## Scope

**Out of scope**:

- the GitHub storage backend;
- restoring through a command (the recovery line is a plain `git checkout`);
- editing documents that link into an archived epic (they are listed, not
  rewritten);
- compressing or bundling the archived text.

## Backbone

`Backbone: archive one finished epic → the index lists every epic, live and archived → a new epic never reuses a number → coding-flow archives its own finished epics`

The stories form a plain chain, so there is no tree. s2 regenerates the
section of the file that s1 creates. s3 reads the archived entries s1 writes.
s4 needs all three.

## Stories

1. **story-17-01-archive-one-epic** *(STRICT: it deletes tracked files)*
2. **story-17-02-the-index-lists-every-epic** *(STANDARD)*
3. **story-17-03-epic-numbers-never-collide** *(STANDARD)*
4. **story-17-04-archive-coding-flows-own-epics** *(QUICK; dogfooding)*

## Decisions

- **`git rm` plus an index entry, not a move.** This is the maintainer's
  decision (2026-11-10). A directory moved to `epics/archive/` is still a
  directory. The text lives on in git history, at the commit the entry
  names.
- **The gate is "finished and merged", the proof state is recorded.** This
  is the maintainer's decision (2026-11-10). Every story must be past
  planned, in-progress and blocked, no worktree may be linked, and the
  directory must be clean and identical on the default branch. Today that
  admits 13 of 15 epics.
- **`epics/INDEX.md` has two parts.** The live part sits between markers and
  is regenerated. The archived part is append-only, because nothing on disk
  could regenerate it.
- **The live part shows the written status (`## Status:`), not the
  proof-derived one.** Proof goes stale on every commit, so the file would
  churn and `doctor` would never find it current. The file says that the
  live state comes from `ai-flow status`.
- **Collision detection is best-effort beyond the checkout.** It covers local
  branches and remote-tracking refs as last fetched, with no network call.
  The comment at `doctor.js:305` still holds: without a shared counter, a
  race between two unfetched clones is caught only after the merge.

## Readiness

`ready`. Settled on 2026-11-10:

- the form (`git rm` plus an index entry, and an index of every epic and
  story, as the maintainer asked);
- the gate (merged, proof state recorded);
- that collision detection is in scope (the maintainer asked for it).

**Assumption (confirmed by default, open to veto):** the index is generated
by the tool and not hand-kept. Story s2 owns that decision.
