"use strict";

// Aide (`help`) et raccourcis de commandes (`commands`).

const path = require("path");

const { cwd, githubNpxCommand } = require("./context");
const { log, normalizePortable } = require("./util");
const { detectProjectPackageJson, commandsPath } = require("./templates");

function printCommands({ json = false } = {}) {
  const detected = detectProjectPackageJson();
  const commands = {
    daily: detected.exists
      ? {
          doctor: "npm run flow:doctor",
          check: "npm run flow:check",
          skills: "npm run flow:skills",
          status: "npm run flow:status",
          harness: "npm run flow:harness",
        }
      : {
          doctor: `${githubNpxCommand} doctor`,
          check: `${githubNpxCommand} doctor --strict`,
          skills: `${githubNpxCommand} list-skills`,
          status: `${githubNpxCommand} status`,
          harness: `${githubNpxCommand} harness check --quick`,
        },
    setup: {
      init: `${githubNpxCommand} init`,
      upgrade: detected.exists ? "npm run flow:upgrade" : `${githubNpxCommand} upgrade`,
      fix: detected.exists ? "npm run flow:fix" : `${githubNpxCommand} doctor --fix`,
      uninstall: detected.exists ? "npm run flow:uninstall" : `${githubNpxCommand} uninstall`,
    },
    cheatsheet: normalizePortable(path.relative(cwd, commandsPath())),
  };

  if (json) {
    log(JSON.stringify(commands, null, 2));
    return;
  }

  log("Coding Flow commands");
  log("");
  log("Daily:");
  for (const [name, value] of Object.entries(commands.daily)) {
    log(`  ${name.padEnd(8)} ${value}`);
  }

  log("");
  log("Setup / update:");
  for (const [name, value] of Object.entries(commands.setup)) {
    log(`  ${name.padEnd(8)} ${value}`);
  }

  log("");
  log(`Local cheat sheet: ${commands.cheatsheet}`);

  if (!detected.exists) {
    log("");
    log("No package.json detected, so npm run flow:* scripts are not available in this project.");
  }
}

function printHelp() {
  log(`Coding Flow

Usage:
  ai-flow init [--force] [--dry-run]
  ai-flow upgrade [--force] [--dry-run] [--json]
  ai-flow doctor [--fix] [--strict] [--json]
  ai-flow status [--json]
  ai-flow bootstrap --scan [--dry-run] [--json]
  ai-flow harness init|preflight|check|evidence [--story path] [--json]
  ai-flow worktree add <name>|--story <path> [--from ref] [--deps install|link|skip] [--dry-run]
  ai-flow worktree list
  ai-flow worktree remove <name> [--force] [--dry-run]
  ai-flow ship [--base ref] [--title text] [--draft] [--web] [--dry-run]
  ai-flow commands [--json]
  ai-flow uninstall [--dry-run] [--force] [--json]
  ai-flow list-skills [--json]
  ai-flow help

Commands:
  init         Install workflow files and the default harness policy into the current project.
  upgrade      Update installed workflow files without overwriting local edits.
  doctor       Check installed files, skill frontmatter, manifest, and the .agents mirror.
  status       List epics, stories, and inferred story status.
  bootstrap    Scan a brownfield project and write docs/bootstrap-scan.md.
  harness      Run security evidence checks and write lightweight run evidence.
  worktree     Manage Git worktrees for parallel work (add/list/remove) with shared env/deps wiring.
  ship         Push the current branch and open/update one PR to the base (uses gh if available).
  commands     Show the easiest commands for this project.
  uninstall    Remove Coding Flow files and scripts while preserving epics/stories.
  list-skills  List available workflow skills.
  help         Show this help message.

Flags:
  --force    Overwrite local edits for init or upgrade.
  --dry-run  Show what would happen without writing files.
  --fix      Restore missing files and resync .agents/skills from .claude/skills.
  --strict   Enable stricter doctor checks for docs and manifest.
  --scan     Run brownfield bootstrap scan.
  --story    Scope harness preflight/check/evidence to one story directory.
  --quick    Limit harness check traversal depth.
  --json     Print machine-readable JSON where supported.
  --from     Base ref for a new worktree branch (default: HEAD).
  --deps     Dependency handling for a worktree: install, link, or skip.
  --story    Story dir for a worktree; names the branch after it (status links them).
  --base     Target branch for ship's pull request (default: origin's default branch).
  --title    Title for the pull request ship opens (default: derived from commits).
  --draft    Open ship's pull request as a draft.
  --web      Open the pull request in the browser after ship.
`);
}

module.exports = { printCommands, printHelp };
