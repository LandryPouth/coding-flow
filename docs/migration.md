# Migrating an existing project to a new Coding Flow version

> How to move a project that already has Coding Flow installed to a newer release,
> what `upgrade` protects, and why re-installing from scratch is usually the wrong move.

## TL;DR

- Use **`ai-flow upgrade`** on a branch. It is non-destructive and is the designed
  migration path.
- Do **not** uninstall + re-install unless you never customized the managed files —
  a re-install can wipe the project context you wrote (`PROJECT_RULES.md`, `docs/*`).
- `epics/` (your actual work) is always preserved by both paths.

## How `upgrade` decides what to touch

For every file Coding Flow manages, `upgrade` compares three fingerprints — the file
on disk, the new template, and what Coding Flow originally installed (recorded in
`.coding-flow/manifest.json`):

| Case | Action |
| --- | --- |
| File missing | **Added** (new skills, new docs) |
| Identical to the new template | Skipped |
| Different, but **you never edited it** (hash matches the manifest) | **Updated** |
| Different **because you edited it** | **Skipped** and listed (`Skipped modified`) — your edits are protected |

`upgrade` also creates `.coding-flow/config.json` for projects installed before the
storage seam existed, without overwriting an existing choice. It **adds and updates,
but never deletes**: files removed or renamed in newer versions stay behind as
residue until you clean them up by hand.

## The safe procedure

From the project directory:

```bash
# 1. On a dedicated branch, not main
git checkout -b chore/upgrade-coding-flow

# 2. See what would change, writing nothing
npx @landry_pouth/coding-flow upgrade --dry-run

# 3. Apply
npx @landry_pouth/coding-flow upgrade

# 4. Check the install and surface any drift
npx @landry_pouth/coding-flow doctor

# 5. Review the diff in a PR, run your tests, merge
```

## Three gotchas on a very old install

1. **Customized files are skipped, not migrated.** Any file you edited (e.g.
   `PROJECT_RULES.md`) is listed as `Skipped modified` and left as-is. Re-apply your
   changes on top of the new version by hand, or accept `--force` (which overwrites
   *your* edits — only with full knowledge).

2. **No manifest means nothing moves.** If the project predates
   `.coding-flow/manifest.json`, `upgrade` cannot tell "original" from "edited by
   you", so it skips everything that differs. Back up your customized files, then
   `init --force` (or `upgrade --force`) to reset, and re-apply your content.

3. **Obsolete files are not deleted.** Old renamed/removed skills and stale files
   from previous versions remain. Compare old vs new with `doctor`, then remove the
   residue by hand (`trash`, never `rm`).

## Why re-installing is usually wrong

`uninstall` preserves `epics/` and protects files it can prove you edited — but on an
install with a missing/partial manifest it removes managed files anyway, including the
project knowledge you wrote (`PROJECT_RULES.md`, `docs/project-context.md`,
`architecture.md`, `conventions.md`, `roadmap.md`). A fresh `init` then lays down
blank templates. The only real upside of a clean re-install is that it removes the
obsolete residue that `upgrade` leaves behind.

| Your situation | Do |
| --- | --- |
| You filled/edited the docs & rules (the normal case for a real project) | **`upgrade`** on a branch — a re-install would lose that content |
| You never touched the managed files (only `epics/` is your work) | Clean re-install is fine, and removes residue; `upgrade` also works |
| Very old install with **no manifest** | Neither blindly: back up `PROJECT_RULES.md` + `docs/` first, then re-install, then re-apply your content |

## Best of both worlds

You do not have to choose between "clean" and "safe":

```bash
git checkout -b chore/upgrade-coding-flow
npx @landry_pouth/coding-flow upgrade --dry-run   # preview
npx @landry_pouth/coding-flow upgrade             # migrate without loss
npx @landry_pouth/coding-flow doctor              # spot residue
# -> trash the few obsolete files doctor flags
git diff                                          # review, then PR
```

This gives you the safe migration **and** the residue cleanup, without ever losing
your project context or your epics.

## Notes for this specific line of releases

- **Renamed repo.** If your scripts still point at `github:LandryPouth/codin-flow`,
  they keep working (GitHub redirects renamed repos), but switch to the npm package
  `@landry_pouth/coding-flow`. An `upgrade` regenerates the up-to-date `flow:*`
  scripts.
- **The plugin is separate.** The global Claude Code plugin (skills + `guard` hook)
  updates through the marketplace and is independent of a project's `upgrade`. See
  the README's "Getting started" for the two-layer model.
