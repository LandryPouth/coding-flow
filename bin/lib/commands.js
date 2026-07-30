"use strict";

// Help (`help`) and command shortcuts (`commands`).

const path = require("path");

const { cwd, npxCommand } = require("./context");
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
          doctor: `${npxCommand} doctor`,
          check: `${npxCommand} doctor --strict`,
          skills: `${npxCommand} list-skills`,
          status: `${npxCommand} status`,
          harness: `${npxCommand} harness check --quick`,
        },
    setup: {
      init: `${npxCommand} init`,
      upgrade: detected.exists ? "npm run flow:upgrade" : `${npxCommand} upgrade`,
      fix: detected.exists ? "npm run flow:fix" : `${npxCommand} doctor --fix`,
      uninstall: detected.exists ? "npm run flow:uninstall" : `${npxCommand} uninstall`,
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

// Golden-path help: the 95% front door. Machinery is one command away, not in
// your face. `ai-flow help --all` prints the full reference below.
function printGoldenPath() {
  log(`Coding Flow — AI-native engineering workflow for Claude Code

START HERE

  In Claude Code (daily):
    /plan     turn an objective into implementation-ready stories
    /run      execute one story end-to-end (picks QUICK..STRICT by risk)
    /review   findings-first pre-merge review
    /ship     push the branch and open/update the PR

  In the terminal:
    ai-flow init     install into the current project (once)
    ai-flow status   where each story stands
    ai-flow ship     push the branch and open/update the PR

That is almost all daily use. Everything else is machinery the skills run for
you (verification, evidence, audit, guard) — you rarely type it yourself.

More
  ai-flow help --all     every command, grouped by role
  ai-flow commands       the easiest commands for THIS project
  ai-flow list-skills    the six skills, in workflow order

Quickstart: docs/QUICKSTART.md`);
}

function printHelp({ all = false } = {}) {
  if (!all) {
    printGoldenPath();
    return;
  }

  log(`Coding Flow — full command reference

Most of these are invoked automatically by the skills, CI, or the git hook. As a
user you mainly need: init, status, ship (and the /plan, /run skills).

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
  ai-flow hook install|uninstall|status [--dry-run] [--json]
  ai-flow commands [--json]
  ai-flow uninstall [--dry-run] [--force] [--json]
  ai-flow list-skills [--json]
  ai-flow version
  ai-flow help [--all]

Setup (you run these):
  init         Install workflow files and the default harness policy into the current project.
  upgrade      Update installed workflow files without overwriting local edits.
  uninstall    Remove Coding Flow files and scripts while preserving epics/stories.
  doctor       Check installed files, skill frontmatter, and manifest.

Daily (you run these):
  status       List epics, stories, and inferred story status (verified / stale / blocked).
  ship         Push the current branch and open/update one PR to the base (uses gh if available).
  bootstrap    Scan a brownfield project and write docs/bootstrap-scan.md.

Machinery (usually run FOR you by the skills, CI, or the git hook):
  harness      Run security checks (check), execute declared validation commands (verify), write evidence.
  audit        Aggregate evidence into an append-only ledger; --export writes docs/AUDIT.md, --check is the CI gate.
  trace        Show the story -> commits -> PR -> evidence -> tests chain and flag missing links.
  guard        PreToolUse hook: deny writes to blocked paths or secret content (wired into settings.json by init).
  hook         Install/remove an opt-in pre-push gate that runs audit --check before each push.
  ci           Scaffold a clean-room GitHub Actions workflow that reruns harness verify + audit on every PR.
  worktree     Manage Git worktrees for parallel work (add/list/remove) with shared env/deps wiring.

Meta:
  commands     Show the easiest commands for this project.
  list-skills  List available workflow skills.
  plugin       (maintainer) Sync/check the native plugin's skills/ against templates.
  version      Print the installed CLI version.
  help         Show the golden-path help; add --all for this full reference.

Flags:
  --force    Overwrite local edits for init or upgrade.
  --dry-run  Show what would happen without writing files.
  --fix      Restore missing template files.
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
