"use strict";

// Which agent platform is this install for? A confirmed signal or nothing: every
// answer below is either stated by the user or observed on disk/in the
// environment, and anything else falls through to "unrecognized" instead of a
// guess. A wrong guess would wire the wrong mechanism and call it a guard.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// What `init --target` accepts. The rest of `TARGETS` (config.js) is derived.
const EXPLICIT_TARGETS = ["claude", "codex", "gemini", "opencode", "antigravity"];

// The only things recorded about an install nobody recognized: presence of these
// named env vars and directories, as booleans. An explicit list on purpose — a
// list derived from `process.env` is one refactor from capturing a value, or a
// secret's name. `.claude`, `.codex` and CLAUDECODE=1 resolve to a target above, so
// they read false in an unrecognized record: kept as a negative confirmation of
// that resolution order, not as a signal expected to fire.
const KNOWN_ENV_SIGNALS = ["CLAUDECODE", "OPENCODE"];
const KNOWN_DIR_SIGNALS = [".claude", ".codex", ".gemini", ".config/opencode"];

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

// Our parent chain, nearest first: /proc where it exists, `ps` elsewhere. Best
// effort and bounded; any failure ends the chain, which only means "not resolved".
function processAncestors(limit = 64) {
  const chain = [];
  let pid = process.ppid;

  while (pid > 1 && chain.length < limit) {
    chain.push(pid);
    pid = parentOf(pid);
  }

  return chain;
}

function parentOf(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name sits in parentheses and may hold spaces: fields resume after the last ")".
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) || 0;
  } catch {
    // No /proc (macOS): ask ps.
  }

  try {
    return Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) || 0;
  } catch {
    return 0;
  }
}

function innermostAgent(env, ancestors) {
  const ids = { claude: Number(env.CLAUDE_PID), opencode: Number(env.OPENCODE_PID) };

  if (!(ids.claude > 0 && ids.opencode > 0)) {
    return null;
  }

  for (const pid of ancestors()) {
    if (pid === ids.opencode) return "opencode";
    if (pid === ids.claude) return "claude";
  }

  return null;
}

// First to answer wins:
//   1. an explicit --target
//   2. CLAUDECODE=1 or OPENCODE=1, each exported by its own agent into the shells it
//      spawns (OPENCODE confirmed on OpenCode 1.19). Both at once means one agent
//      was launched from the other's terminal. Each also exports its own process id
//      (CLAUDE_PID, OPENCODE_PID): the one nearer up our parent chain is the agent
//      that ran this command. Without both ids, or when neither is an ancestor,
//      neither is trusted and detection falls through to the directories.
//   3. a .claude/ or .codex/ directory already in the project
//   4. "unrecognized"
// When both directories exist, claude wins: this tool is Claude-native, and a
// project carrying both is one that already runs it there.
function resolveTarget({ flags = {}, env = process.env, cwd = process.cwd(), ancestors = processAncestors } = {}) {
  if (EXPLICIT_TARGETS.includes(flags.target)) {
    return { target: flags.target, source: "flag" };
  }

  const inClaude = Boolean(env) && env.CLAUDECODE === "1";
  const inOpenCode = Boolean(env) && env.OPENCODE === "1";

  if (inClaude && !inOpenCode) {
    return { target: "claude", source: "env:CLAUDECODE" };
  }

  if (inOpenCode && !inClaude) {
    return { target: "opencode", source: "env:OPENCODE" };
  }

  if (inClaude && inOpenCode) {
    const innermost = innermostAgent(env, ancestors);

    if (innermost) {
      return { target: innermost, source: `env:${innermost === "claude" ? "CLAUDECODE" : "OPENCODE"} (innermost of both)` };
    }
  }

  if (isDir(path.join(cwd, ".claude"))) {
    // Claude still wins, but the evidence names the ambiguity instead of hiding it.
    const both = isDir(path.join(cwd, ".codex"));
    return { target: "claude", source: both ? "dir:.claude (also .codex)" : "dir:.claude" };
  }

  if (isDir(path.join(cwd, ".codex"))) {
    return { target: "codex", source: "dir:.codex" };
  }

  return { target: "unrecognized", source: "none" };
}

// Booleans only: whether each allowlisted signal is present. Never a value, never
// a directory listing.
function collectSignals({ env = process.env, cwd = process.cwd() } = {}) {
  const signals = {};

  for (const name of KNOWN_ENV_SIGNALS) {
    signals[`env:${name}`] = Boolean(env && Object.prototype.hasOwnProperty.call(env, name) && env[name] !== "");
  }

  for (const dir of KNOWN_DIR_SIGNALS) {
    signals[`dir:${dir}`] = isDir(path.join(cwd, dir));
  }

  return signals;
}

module.exports = { EXPLICIT_TARGETS, KNOWN_ENV_SIGNALS, KNOWN_DIR_SIGNALS, resolveTarget, collectSignals };
