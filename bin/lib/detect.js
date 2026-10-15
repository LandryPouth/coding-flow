"use strict";

// Which agent platform is this install for? A confirmed signal or nothing: every
// answer below is either stated by the user or observed on disk/in the
// environment, and anything else falls through to "unrecognized" instead of a
// guess. A wrong guess would wire the wrong mechanism and call it a guard.

const fs = require("fs");
const path = require("path");

// What `init --target` accepts. The rest of `TARGETS` (config.js) is derived.
const EXPLICIT_TARGETS = ["claude", "codex", "gemini", "opencode", "antigravity"];

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

// First to answer wins:
//   1. an explicit --target
//   2. CLAUDECODE=1 (the one environment signal confirmed reliable)
//   3. a .claude/ or .codex/ directory already in the project
//   4. "unrecognized"
// When both directories exist, claude wins: this tool is Claude-native, and a
// project carrying both is one that already runs it there.
function resolveTarget({ flags = {}, env = process.env, cwd = process.cwd() } = {}) {
  if (EXPLICIT_TARGETS.includes(flags.target)) {
    return { target: flags.target, source: "flag" };
  }

  if (env && env.CLAUDECODE === "1") {
    return { target: "claude", source: "env:CLAUDECODE" };
  }

  if (isDir(path.join(cwd, ".claude"))) {
    return { target: "claude", source: "dir:.claude" };
  }

  if (isDir(path.join(cwd, ".codex"))) {
    return { target: "codex", source: "dir:.codex" };
  }

  return { target: "unrecognized", source: "none" };
}

module.exports = { EXPLICIT_TARGETS, resolveTarget };
