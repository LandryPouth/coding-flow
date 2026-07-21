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
  ai-flow init [--storage local] [--no-branch-per-epic] [--no-guard] [--force] [--dry-run]
  ai-flow upgrade [--force] [--dry-run] [--json]
  ai-flow doctor [--fix] [--strict] [--json]
  ai-flow status [--json]
  ai-flow bootstrap --scan [--dry-run] [--json]
  ai-flow harness init|preflight|check|verify|evidence [--story path] [--json]
  ai-flow guard [--input file] [--json]   (PreToolUse hook: reads a tool call on stdin)
  ai-flow audit [--export] [--check] [--since iso] [--json] [--dry-run]
  ai-flow trace [--story path] [--json]
  ai-flow ci init [--force] [--dry-run]
  ai-flow plugin sync|check [--json] [--dry-run]
  ai-flow worktree add <name>|--story <path> [--from ref] [--deps install|link|skip] [--dry-run]
  ai-flow worktree list
  ai-flow worktree remove <name> [--force] [--dry-run]
  ai-flow ship [--base ref] [--title text] [--draft] [--web] [--no-evidence] [--dry-run]
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
  harness      Run security evidence checks (check), execute declared validation commands (verify), and write run evidence.
  guard        PreToolUse hook: deny writes to blocked paths or secret content at the tool boundary (wired into .claude/settings.json by init).
  audit        Aggregate evidence runs into an append-only ledger; --export writes docs/AUDIT.md, --check gates on the latest verify.
  trace        Show the story -> commits -> PR -> evidence -> tests chain and flag missing links.
  ci           Scaffold a clean-room GitHub Actions workflow that reruns harness verify + audit on every PR.
  plugin       Sync/check the native Claude Code plugin's skills/ against templates (distribution channel).
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
  --no-evidence  Do not attach the latest verify evidence to ship's PR body.
  --export   Write docs/AUDIT.md from the audit ledger.
  --check    Exit non-zero if the latest verify per story is failing or missing (CI gate).
  --since    Filter audit entries to those generated at or after an ISO timestamp.
  --storage  Storage backend recorded at init: local (default; github is reserved).
  --no-branch-per-epic  Disable the "one epic = one branch, never main" policy.
  --no-guard  Skip wiring the PreToolUse guard hook into .claude/settings.json at init.
  --input    Read the guard hook payload from a file instead of stdin (for testing).
`);
}

module.exports = { printCommands, printHelp };
