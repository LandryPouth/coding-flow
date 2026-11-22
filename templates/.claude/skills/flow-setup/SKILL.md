---
name: flow-setup
description: Scaffold Coding Flow into the current project from inside your coding agent (Claude Code, OpenCode, Codex…) by running `init`. Use once per repo, right after installing the plugin or the global skills, so setup happens in one place without switching to a terminal. Use when the user wants to install, set up, or scaffold Coding Flow in a repository.
---

# Setup

Install the Coding Flow scaffold (rules, docs, harness) into the current repository
from inside the agent: `/plugin install`, then `/flow-setup`. Use it the first time
a repo has no `RULES.md`, `epics/` or `.coding-flow/`, or to re-check and repair an
install.

## Steps

1. Confirm the working directory is the project root (the git root, or where
   `package.json` lives). If it is not, stop and ask.
2. Run the scaffold — `ai-flow init` when `command -v ai-flow` finds it (the version
   this machine installed), otherwise exactly as written here, keeping any pinned
   version:

   ```bash
   npx @landry_pouth/coding-flow init
   ```

   `init` detects the agent (Claude Code, OpenCode) and installs its skills and its
   write guard. **"Platform not recognized"** means it installed neither: re-run with
   `init --target opencode` (or `claude`, `codex`, `gemini`, `antigravity`). It never
   overwrites an existing file, so re-running is safe, and it creates a minimal
   private `package.json` when there is none, for the `flow:*` scripts.
3. Relay `init`'s brownfield verdict. On an existing codebase, say plainly that the
   project docs are still empty — the scan is mechanical — and that `/flow-plan`'s
   Brownfield Bootstrap fills them.
4. Check the install:

   ```bash
   npx @landry_pouth/coding-flow doctor
   ```

5. Report what was created, and name the next step: `/flow-plan`, then `/flow-run`.

## Verification

Before reporting the setup as done:

- [ ] `init` ran and its output was read, brownfield verdict included.
- [ ] `init` did not say "Platform not recognized" — or was re-run with `--target`
      until it named the agent you are in.
- [ ] `doctor` reported the install correct, with no warning about the platform or
      the guard (one there means writes are not protected).
- [ ] `RULES.md`, `epics/` and `.coding-flow/` exist at the project root.
- [ ] The next step was named: `/flow-plan`.

If `doctor` reported an error, or a platform or guard warning, the setup is not
done: report that problem instead of the files `init` created — a scaffold `doctor`
rejects looks installed and is worse than none.

## Stop Conditions

- The current directory is not the intended project root.
- `init` reports an unparseable existing config or `settings.json`: surface it, do
  not force. Suggest `--force` only if the user explicitly wants the templates
  reinstalled over local edits.
