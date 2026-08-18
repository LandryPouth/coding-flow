"use strict";

// Help (`help`) and command shortcuts (`commands`).

const path = require("path");

const { cwd, npxCommand } = require("./context");
const { log, normalizePortable } = require("./util");
const { detectProjectPackageJson, commandsPath } = require("./templates");

function printCommands({ json = false } = {}) {
  const detected = detectProjectPackageJson();
  const commands = {
    // `harness check --quick` is machinery nobody types; `verify` is the one
    // command a user reaches for, to re-prove a story that went stale. The cheat
    // sheet follows the front door, not the list of available subcommands.
    //
    // verify keeps its direct form in both branches: it takes an argument, and
    // `npm run flow:verify -- --story x` is not a command worth teaching.
    daily: detected.exists
      ? {
          doctor: "npm run flow:doctor",
          check: "npm run flow:check",
          skills: "npm run flow:skills",
          status: "npm run flow:status",
          verify: `${npxCommand} verify --story <dir>`,
        }
      : {
          doctor: `${npxCommand} doctor`,
          check: `${npxCommand} doctor --strict`,
          skills: `${npxCommand} list-skills`,
          status: `${npxCommand} status`,
          verify: `${npxCommand} verify --story <dir>`,
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

  // Width from the longest name in both blocks: a hardcoded 8 made "uninstall"
  // eat its own gap.
  const width = Math.max(
    ...Object.keys(commands.daily).map((name) => name.length),
    ...Object.keys(commands.setup).map((name) => name.length),
  );

  log("Coding Flow commands");
  log("");
  log("Daily:");
  for (const [name, value] of Object.entries(commands.daily)) {
    log(`  ${name.padEnd(width)} ${value}`);
  }

  log("");
  log("Setup / update:");
  for (const [name, value] of Object.entries(commands.setup)) {
    log(`  ${name.padEnd(width)} ${value}`);
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
    /flow-plan     turn an objective into implementation-ready stories
    /flow-run      execute one story end-to-end (picks QUICK..STRICT by risk)
    /flow-review   findings-first pre-merge review
    /flow-ship     push the branch and open/update the PR

  With the plugin installed they answer to coding-flow:flow-* too. The flow-
  prefix keeps them clear of Claude Code's own /run and /review.

  In the terminal:
    ai-flow init     install into the current project (once)
    ai-flow status   where each story stands
    ai-flow next     the one thing worth doing right now
    ai-flow ship     push the branch and open/update the PR

That is almost all daily use. Everything else is machinery the skills run for
you (verification, evidence, audit, guard) — you rarely type it yourself.

More
  ai-flow help --all     every command, grouped by role
  ai-flow commands       the easiest commands for THIS project
  ai-flow list-skills    the skills, in workflow order (plus flow-status/flow-next)

Quickstart: docs/QUICKSTART.md`);
}

function printHelp({ all = false } = {}) {
  if (!all) {
    printGoldenPath();
    return;
  }

  log(`Coding Flow — full command reference

Most of these are invoked automatically by the skills, CI, or the git hook. As a
user you mainly need: init, status, next, ship (and the /flow-plan, /flow-run skills).

Usage:
  ai-flow init [--storage local] [--no-branch-per-epic] [--no-guard] [--with-skills|--no-skills] [--force] [--dry-run]
  ai-flow upgrade [--with-skills|--no-skills] [--force] [--dry-run] [--json]
  ai-flow doctor [--fix] [--strict] [--json]
  ai-flow status [--json]
  ai-flow next [--all] [--json]
  ai-flow run [--story path | --epic name] [--driver none] [--dry-run] [--json]
  ai-flow verify --story path [--json] [--dry-run] [--test-exemption "reason"]
  ai-flow bootstrap --scan [--force] [--dry-run] [--json]
  ai-flow harness init|preflight|check|verify|evidence [--story path] [--json]
  ai-flow guard [--input file] [--json]   (PreToolUse hook: reads a tool call on stdin)
  ai-flow audit [--export] [--check] [--since iso] [--decisions] [--json] [--dry-run]
  ai-flow trace [--story path] [--json]
  ai-flow ci init [--force] [--dry-run]
  ai-flow plugin sync|check [--json] [--dry-run]
  ai-flow worktree add <name>|--story <path> [--from ref] [--deps install|link|skip] [--dry-run]
  ai-flow worktree list
  ai-flow worktree remove <name> [--force] [--dry-run]
  ai-flow ship [--base ref] [--title text] [--draft] [--web] [--no-evidence] [--no-commit]
               [--auto-merge|--no-auto-merge] [--merge-method merge|squash|rebase] [--dry-run]
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
  next         Rank the same state status reads and print the one command worth running now.
  run          Verify a batch of stories (all, one --epic, or one --story) and emit one proof report.
  ship         Commit a dirty tree, push, and open/update one PR to the base (uses gh if available).
  verify       Re-prove one story: run its declared validation commands and capture the result.
               --story also accepts a Spec Kit feature (specs/<name>); with no --story in a
               .specify/ project, the active feature is used and the output says where from.
  bootstrap    Write docs/bootstrap-scan.md for a brownfield project (init already scans; this is the artifact).
  report       Collect what went wrong into one sendable file: guard denials, verify failures,
               risk and coverage distribution, install health. Redacted by default (--raw to keep
               absolute paths, --json for machines, --out FILE to write it).

Machinery (usually run FOR you by the skills, CI, or the git hook):
  harness      Run security checks (check), execute declared validation commands (verify), write evidence.
  audit        Aggregate evidence into an append-only ledger; --export writes docs/AUDIT.md, --check is the CI gate.
               --decisions: cross-epic view of every story's recorded ## Decisions (--export writes docs/DECISIONS.md).
  trace        Show the story -> commits -> PR -> evidence -> tests chain and flag missing links.
  guard        PreToolUse hook: deny writes to blocked paths or secret content (wired into settings.json by init).
  hook         Install/remove an opt-in pre-push gate that runs audit --check before each push.
  ci           Scaffold a clean-room GitHub Actions workflow that replays run (per-story verify) + audit on every PR.
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
  --all      Print next's whole ranked queue instead of just the top suggestion.
  --json     Print machine-readable JSON where supported.
  --from     Base ref for a new worktree branch (default: HEAD).
  --deps     Dependency handling for a worktree: install, link, or skip.
  --story    Story dir for a worktree; names the branch after it (status links them).
  --base     Target branch for ship's pull request (default: origin's default branch).
  --title    Title for the pull request ship opens (default: derived from commits).
  --draft    Open ship's pull request as a draft.
  --web      Open the pull request in the browser after ship.
  --no-evidence  Do not attach the latest verify evidence to ship's PR body.
  --no-commit  Do not auto-commit a dirty tree before ship pushes (push existing commits only).
  --auto-merge  Force-enable ship's auto-merge for this run (overrides autoMergeEpic config).
  --no-auto-merge  Force-disable ship's auto-merge for this run.
  --merge-method  Merge strategy for ship's auto-merge: merge (default), squash, or rebase.
  --export   Write docs/AUDIT.md from the audit ledger, or docs/DECISIONS.md with --decisions.
  --check    Exit non-zero if the latest verify per story is failing or missing (CI gate).
  --test-exemption  Reason a verified change carries no test; recorded verbatim in the evidence.
  --since    Filter audit entries to those generated at or after an ISO timestamp.
  --decisions  Aggregate every story's ## Decisions section instead of the run-evidence ledger.
  --epic     Scope run to every story in one epic (matched by name).
  --driver   Executor for run: none (default; verify only). Agent drivers are reserved.
  --storage  Storage backend recorded at init: local (default; github is reserved).
  --no-branch-per-epic  Disable the "one epic = one branch, never main" policy.
  --no-guard  Skip wiring the PreToolUse guard hook into .claude/settings.json at init.
  --with-skills  Install the skills into .claude/skills even when the plugin serves them.
  --no-skills    Leave the skills to the plugin; remove any copy this project holds.
  --input    Read the guard hook payload from a file instead of stdin (for testing).

Skills channel:
  The skills ship through the plugin (coding-flow:flow-run) AND as project files
  (/flow-run). Installing both would give you two names for one skill, so init
  detects the plugin and copies them only when it is absent. The choice is
  recorded in .coding-flow/config.json ("skills": "plugin" | "project") so every
  later command — and every teammate — sees the same install. Change it with
  \`upgrade --with-skills\` / \`upgrade --no-skills\`.
`);
}

module.exports = { printCommands, printHelp };
