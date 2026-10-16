"use strict";

// Which agent platform is this install for? A confirmed signal or nothing: every
// answer below is either stated by the user or observed on disk/in the
// environment, and anything else falls through to "unrecognized" instead of a
// guess. A wrong guess would wire the wrong mechanism and call it a guard.

const fs = require("fs");
const path = require("path");

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

// First to answer wins:
//   1. an explicit --target
//   2. CLAUDECODE=1 or OPENCODE=1, each exported by its own agent into the shells it
//      spawns (OPENCODE confirmed on OpenCode 1.19). Both at once means one agent
//      was launched from the other's terminal: the innermost cannot be told from
//      the outer, so neither is trusted and detection falls through to the directories.
//   3. a .claude/ or .codex/ directory already in the project
//   4. "unrecognized"
// When both directories exist, claude wins: this tool is Claude-native, and a
// project carrying both is one that already runs it there.
function resolveTarget({ flags = {}, env = process.env, cwd = process.cwd() } = {}) {
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
