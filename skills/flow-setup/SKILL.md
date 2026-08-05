---
name: flow-setup
description: Scaffold Coding Flow into the current project from Claude Code (runs the published `init`). Use once per repo, right after installing the plugin, so setup happens in one place without switching to a terminal. Use when the user wants to install, set up, or scaffold Coding Flow in a repository.
---

# Setup

Install the Coding Flow project scaffold into the current repository, so the
`/flow-plan` and `/flow-run` skills have rules, docs, and a harness to act on. This is the
one-context alternative to running `init` yourself in a terminal: `/plugin install`
then `/flow-setup`.

## When To Use

- Right after installing the plugin, the first time you open a repo that does not
  yet have Coding Flow (`RULES.md`, `epics/`, `.coding-flow/`).
- To re-check or repair an existing install.

## Steps

1. Confirm the working directory is the project root (the git repo root, or where
   `package.json` lives if there is one). Stop and ask if it is not.
2. Run the scaffold:

   ```bash
   npx @landry_pouth/coding-flow init
   ```

   - `init` is **non-destructive by default**: it never overwrites your files. An
     existing file is left untouched, so re-running is safe.
   - If the project has no `package.json`, a minimal private one is created so the
     `flow:*` scripts work.
3. For an existing (brownfield) codebase, optionally prepare durable project docs
   first: run `npx @landry_pouth/coding-flow bootstrap --scan`, then `/flow-plan` (its
   Brownfield Bootstrap section fills the project docs from the scan).
4. Verify the install:

   ```bash
   npx @landry_pouth/coding-flow doctor
   ```

5. Report what was created, then point to the next step: `/flow-plan` to turn an
   objective into implementation-ready stories, followed by `/flow-run`.

## Stop Conditions

- The current directory is not the intended project root.
- `init` reports an unparseable existing config or `settings.json` — surface it,
  do not force. Suggest `--force` only if the user explicitly wants to reinstall
  the templates over local edits.
