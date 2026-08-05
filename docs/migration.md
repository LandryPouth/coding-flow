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

### 0.5 → next (the skills are renamed and now come from one channel)

Two changes, and unlike the 0.3 → 0.4 renames below, `upgrade` cleans up after
itself here — no manual `trash` pass:

1. **Every skill gained a `flow-` prefix**: `setup`, `plan`, `run`, `verify`,
   `review`, `ship` → **`flow-setup`, `flow-plan`, `flow-run`, `flow-verify`,
   `flow-review`, `flow-ship`**. Claude Code ships its own built-in `run` and
   `review` skills, so the old names sat next to built-ins that do something
   entirely different. `upgrade` installs the new names and removes the old files
   it originally installed; any skill file **you edited** is reported and left in
   place for you to delete once you have moved your changes over.

2. **`flow-verify` is gone as a skill** — the front door is five skills, not six.
   Nothing was lost: verification was never a decision you make. `/flow-run` still
   runs it on every story, `status` and CI still read its evidence, and `ship`
   still attaches it to the PR. The on-demand case — re-proving a story that went
   `stale` after a small edit — is now `ai-flow verify --story <path>`, promoted
   from `ai-flow harness verify`, which still works. `upgrade` removes the skill
   file it installed; an edited copy is reported and left for you to delete.

3. **A project no longer holds a copy of the skills when the plugin is
   installed.** Your project predates that choice, so the first `upgrade` makes
   it for you — no second `init`, no flag:

   ```bash
   ai-flow upgrade
   ```

   With the plugin installed it records `"skills": "plugin"` and removes the
   copies that would otherwise duplicate it; without the plugin it records
   `"project"` and keeps them. Either way the answer lands in
   `.coding-flow/config.json` and is **committed**, so teammates and CI see the
   same install — and from then on it is never re-decided, whatever a given
   machine detects.

   Force it either way whenever you disagree:

   ```bash
   ai-flow upgrade --no-skills    # the plugin serves them; drop the project copies
   ai-flow upgrade --with-skills  # keep them committed in the repo instead
   ```

   Keep `--with-skills` if your repo is shared with people who do not install the
   plugin — that copy is what gives them the workflow.

   Detection errs toward copying: it only believes a plugin is installed when the
   skills it would serve are visible on disk, so a stale registry entry or a
   leftover cache directory leaves you with the project copy rather than with
   nothing. `upgrade` prints which channel it chose and why — read that line, and
   review the diff before committing.

### 0.3 → 0.4 (three renames leave residue to clean by hand)

0.4.0 renamed three things. `upgrade` **adds the new files but never deletes the
old ones**, so a 0.3 project ends up with the new layout working *alongside*
obsolete residue. `upgrade` is still the right path — run it on a branch, then
clean the residue below with `trash` (never `rm`):

1. **The rules merged into one file.** `PROJECT_RULES.md` + `AGENT_RULES.md` →
   a single **`RULES.md`** (imported by `CLAUDE.md`). After upgrading, move any
   custom rules you had in the two old files into `RULES.md`, then trash them.

2. **Stories collapsed from six files to three.** A story folder is now exactly
   **`spec.md`** (what & acceptance), **`plan.md`** (how + decisions + `## Commands`
   + test plan), and **`tasks.md`** (checklist + `## Result` + rollback). The old
   per-story `story.md` / `tests.md` / `decisions.md` (and any separate notes file)
   are residue — fold their content into the three above, then trash them. This is
   per *existing* story folder under `epics/`; new stories already use the layout.

3. **The skill set collapsed from ~30 to six.** The skills are now **`setup`,
   `plan`, `run`, `verify`, `review`, `ship`** (depth like STRICT mode, deep
   validators, TDD, and the context scout are opt-in *sections* inside `run` and
   `review`, not separate skills). Every other Coding Flow skill directory under
   `.claude/skills/` — `plan-epic`, `run-story`, `quick-story`, the `blueprint-*`,
   `agent-*`, and `*-check` folders — is obsolete; trash the ones that are not in
   the set of six. Leave any skill *you* authored in place. Coming from 0.3 you
   land past the rename above, so the six you keep are the `flow-*` ones.

A quick way to spot the residue after upgrading:

```bash
npx @landry_pouth/coding-flow doctor   # flags managed-file problems
ls .claude/skills/                     # anything beyond the six is likely residue
```
