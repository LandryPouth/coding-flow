"use strict";

// The usage table: one source for `help --all` and for `<command> --help`.
// No requires on purpose — `--help` is answered before anything else loads, so
// asking for help cannot touch a file, git or the network.

const USAGE = `  ai-flow init [--target claude|codex|gemini|opencode|antigravity] [--opencode] [--minimal|--full] [--global] [--storage local] [--no-branch-per-epic] [--no-guard] [--with-skills|--no-skills] [--force] [--dry-run]
  ai-flow upgrade [--global] [--with-skills|--no-skills] [--no-guard] [--force] [--dry-run] [--json]
  ai-flow doctor [--fix] [--strict] [--json]
  ai-flow status [--json]
  ai-flow next [--all] [--json]
  ai-flow run [--story path | --epic name] [--driver none] [--dry-run] [--json]
  ai-flow verify --story path [--json] [--dry-run] [--test-exemption "reason"]
               [--allow-plan-commands] [--clean-env]
  ai-flow bootstrap --scan [--force] [--dry-run] [--json]
  ai-flow harness init|preflight|check|verify|evidence [--story path] [--json]
  ai-flow guard [--input file] [--json]   (PreToolUse hook: reads a tool call on stdin)
  ai-flow audit [--export] [--check] [--since iso] [--decisions] [--json] [--dry-run]
  ai-flow review capture --story path --verdict pass|fail [--reviewer self|subagent]
                [--accept "reason"]
                [--architecture|--tests|--security|--quality|--e2e quick|deep|skipped]
                [--p0 n] [--p1 n] [--p2 n] [--p3 n] [--json]
  ai-flow trace [--story path] [--json]
  ai-flow report [--raw] [--json] [--out file]
  ai-flow ci init [--force] [--dry-run]
  ai-flow plugin sync|check [--json] [--dry-run]
  ai-flow worktree add <name>|--story <path> [--from ref] [--deps install|link|skip] [--dry-run]
  ai-flow worktree list
  ai-flow worktree remove <name> [--force] [--dry-run]
  ai-flow worktree lock --story <path>
  ai-flow worktree unlock [--story <path>] [--force]
  ai-flow worktree land <name>|--story <path>
  ai-flow worktree place --epic <path> --story <path> [--json]
  ai-flow worktree autoland --epic <path> --story <path> [--json]
  ai-flow ship [--base ref] [--title text] [--draft] [--web] [--no-evidence] [--no-commit] [--all]
               [--auto-merge|--no-auto-merge] [--merge-method merge|squash|rebase] [--dry-run]
  ai-flow hook install|uninstall|status [--dry-run] [--json]
  ai-flow commands [--json]
  ai-flow uninstall [--global] [--dry-run] [--force] [--json]
  ai-flow list-skills [--json]
  ai-flow version
  ai-flow help [--all]`;

// A command's usage is its entry lines plus the indented continuation lines
// that follow them.
function usageFor(command) {
  const out = [];
  let inside = false;

  for (const line of USAGE.split("\n")) {
    const head = line.match(/^ {2}ai-flow (\S+)/);

    if (head) {
      inside = head[1] === command;
    }

    if (inside) {
      out.push(line);
    }
  }

  return out.length > 0 ? `Usage:\n${out.join("\n")}` : null;
}

// Commands that write answer to a closed set of flags: an unknown one (a typo
// such as `--hlep`) must stop the command, not be ignored while it installs.
const FLAGS = {
  init: [
    "--target", "--opencode", "--minimal", "--full", "--global", "--storage", "--no-branch-per-epic",
    "--no-guard", "--guard", "--with-skills", "--no-skills", "--force", "--dry-run", "--help", "-h",
  ],
  upgrade: ["--global", "--with-skills", "--no-skills", "--no-guard", "--force", "--dry-run", "--json", "--opencode", "--help", "-h"],
  uninstall: ["--global", "--dry-run", "--force", "--json", "--target", "--help", "-h"],
};

function unknownFlags(command, argv) {
  const known = FLAGS[command];

  if (!known) {
    return [];
  }

  return argv.filter((arg) => arg.startsWith("-") && !known.includes(arg.split("=")[0]));
}

module.exports = { USAGE, usageFor, unknownFlags };
