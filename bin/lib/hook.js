"use strict";

// `ai-flow hook install|uninstall|status`: an OPT-IN local pre-push gate that runs
// `ai-flow audit --check` before every push, so a story's latest verify being red,
// missing, or STALE blocks the push out of the agent's hands. The CI gate is the
// hard guarantee; this is the local convenience that catches it before it leaves
// the machine.
//
// Design constraints (inherited): opt-in (never wired by init), idempotent,
// --dry-run-able, and degrades cleanly — the hook skips itself if the CLI cannot
// run, and we manage only a marked block so a user's own pre-push hook is
// preserved. We install into git's resolved hooks path (honors core.hooksPath and
// worktrees) rather than hardcoding .git/hooks.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { log, fail } = require("./util");

const BLOCK_START = "# >>> coding-flow (managed) >>>";
const BLOCK_END = "# <<< coding-flow (managed) <<<";
const SHEBANG = "#!/bin/sh";

// The managed block, built line by line to avoid JS interpolating the shell's own
// ${...} expansions. CODING_FLOW_CLI lets a caller (and the tests) point at a
// specific CLI; otherwise we auto-detect ai-flow, then npx.
function managedBlock() {
  return [
    BLOCK_START,
    "# Opt-in pre-push gate installed by `ai-flow hook install`.",
    "# Blocks a push when a story's latest verify is red, missing, or stale.",
    "# Remove with `ai-flow hook uninstall`; bypass once with `git push --no-verify`.",
    'CF="${CODING_FLOW_CLI:-}"',
    'if [ -z "$CF" ]; then',
    "  if command -v ai-flow >/dev/null 2>&1; then CF=\"ai-flow\";",
    '  elif command -v npx >/dev/null 2>&1; then CF="npx --no-install @landry_pouth/coding-flow";',
    "  fi",
    "fi",
    'if [ -z "$CF" ] || ! $CF version >/dev/null 2>&1; then',
    '  echo "coding-flow: CLI unavailable, skipping pre-push audit gate" >&2',
    "  exit 0",
    "fi",
    "if ! $CF audit --check; then",
    '  echo "coding-flow: push blocked — a story\'s latest verify is red, missing, or stale." >&2',
    "  echo \"Re-run 'ai-flow harness verify', or bypass once with 'git push --no-verify'.\" >&2",
    "  exit 1",
    "fi",
    BLOCK_END,
  ].join("\n");
}

// Path git actually uses for the pre-push hook (respects core.hooksPath and
// worktree/submodule layouts). Null when we are not inside a git work tree.
function prePushHookPath(cwd) {
  try {
    const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (inside !== "true") {
      return null;
    }

    const rel = execFileSync("git", ["rev-parse", "--git-path", "hooks/pre-push"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return rel ? path.resolve(cwd, rel) : null;
  } catch {
    return null;
  }
}

function hasBlock(content) {
  return content.includes(BLOCK_START) && content.includes(BLOCK_END);
}

// Inserts or refreshes the managed block, preserving any surrounding user hook.
function upsertBlock(content, block) {
  if (!content) {
    return `${SHEBANG}\n\n${block}\n`;
  }

  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = content.slice(0, start);
    const after = content.slice(end + BLOCK_END.length);
    return `${before}${block}${after}`;
  }

  // Existing user hook without our block: append, keeping a shebang up top.
  const base = content.startsWith("#!") ? content.replace(/\n*$/, "") : `${SHEBANG}\n\n${content.replace(/\n*$/, "")}`;
  return `${base}\n\n${block}\n`;
}

// Removes the managed block; drops the file if only a shebang/blank lines remain.
function removeBlock(content) {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);

  if (start === -1 || end === -1 || end < start) {
    return { changed: false, content, empty: false };
  }

  const before = content.slice(0, start);
  const after = content.slice(end + BLOCK_END.length);
  const next = `${before}${after}`.replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
  const residual = next.replace(/^#!.*\n?/, "").trim();

  return { changed: true, content: next, empty: residual.length === 0 };
}

function hookInstall(cwd, { dryRun = false } = {}) {
  const hookPath = prePushHookPath(cwd);

  if (!hookPath) {
    fail("not inside a git work tree — `ai-flow hook install` needs a git repository.");
  }

  const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf8") : "";
  const next = upsertBlock(existing, managedBlock());

  if (existing && hasBlock(existing) && next === existing) {
    log("Pre-push hook already installed and up to date.");
    return;
  }

  const verb = existing ? (hasBlock(existing) ? "refresh" : "add the gate to") : "create";

  if (dryRun) {
    log(`Would ${verb} the pre-push hook at ${hookPath} (dry run, nothing written).`);
    return;
  }

  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, next);
  fs.chmodSync(hookPath, 0o755);
  log(`Pre-push gate installed: ${hookPath}`);
  log("It runs `ai-flow audit --check` before each push. Bypass once with `git push --no-verify`.");
}

function hookUninstall(cwd, { dryRun = false } = {}) {
  const hookPath = prePushHookPath(cwd);

  if (!hookPath || !fs.existsSync(hookPath)) {
    log("No pre-push hook to remove.");
    return;
  }

  const content = fs.readFileSync(hookPath, "utf8");
  const { changed, content: next, empty } = removeBlock(content);

  if (!changed) {
    log("Pre-push hook is not managed by coding-flow; leaving it untouched.");
    return;
  }

  if (dryRun) {
    log(empty ? `Would remove the pre-push hook ${hookPath} (dry run).` : `Would strip the coding-flow block from ${hookPath} (dry run).`);
    return;
  }

  if (empty) {
    fs.rmSync(hookPath, { force: true });
    log(`Pre-push gate removed: ${hookPath}`);
  } else {
    fs.writeFileSync(hookPath, next);
    fs.chmodSync(hookPath, 0o755);
    log(`Removed the coding-flow block from ${hookPath} (your own hook is preserved).`);
  }
}

function hookStatus(cwd, { json = false } = {}) {
  const hookPath = prePushHookPath(cwd);
  const installed =
    Boolean(hookPath) && fs.existsSync(hookPath) && hasBlock(fs.readFileSync(hookPath, "utf8"));

  if (json) {
    log(JSON.stringify({ hookPath, installed }, null, 2));
    return;
  }

  if (!hookPath) {
    log("Not inside a git work tree.");
    return;
  }

  log(installed ? `Pre-push gate is installed: ${hookPath}` : "Pre-push gate is not installed. Run `ai-flow hook install`.");
}

function hookCommand({ commandArgs, flags, cwd }) {
  const subcommand = commandArgs[0] || "status";
  const dryRun = flags.has("--dry-run");

  if (subcommand === "install") {
    hookInstall(cwd, { dryRun });
  } else if (subcommand === "uninstall") {
    hookUninstall(cwd, { dryRun });
  } else if (subcommand === "status") {
    hookStatus(cwd, { json: flags.has("--json") });
  } else {
    fail(`unknown hook command "${subcommand}". Use install, uninstall, or status.`);
  }
}

module.exports = { hookCommand, prePushHookPath, managedBlock, upsertBlock, removeBlock, hasBlock };
