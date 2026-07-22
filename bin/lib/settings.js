"use strict";

// Wiring of the `guard` PreToolUse hook into the target project's .claude/settings.json.
// A settings.json is a user config file: we MERGE it, we never overwrite it
// (unlike the templates copied verbatim). Idempotent: if our hook is already
// there, we don't duplicate it. Non-destructive: we don't touch any other
// existing hook or setting.

const fs = require("fs");
const path = require("path");

const { cwd, packageJson } = require("./context");
const { readJson, writeJson } = require("./util");

// Write tools the guard must intercept (Claude Code matcher regex).
const GUARD_MATCHER = "Write|Edit|MultiEdit|NotebookEdit";

// Command run by the hook: the published npm package, resolved by npx and cached
// after the first call. Built from packageJson.name to stay in sync with the
// published scope.
function guardCommandString() {
  return `npx --yes ${packageJson.name} guard`;
}

function settingsPath() {
  return path.join(cwd, ".claude", "settings.json");
}

function guardHookEntry() {
  return {
    matcher: GUARD_MATCHER,
    hooks: [{ type: "command", command: guardCommandString(), timeout: 30 }],
  };
}

// Is our hook already wired? We recognize any PreToolUse entry whose command
// invokes `guard` on our package — tolerant of matcher variants.
function hasGuardHook(settings) {
  const pre = settings && settings.hooks && Array.isArray(settings.hooks.PreToolUse)
    ? settings.hooks.PreToolUse
    : [];

  return pre.some(
    (entry) =>
      entry &&
      Array.isArray(entry.hooks) &&
      entry.hooks.some(
        (hook) =>
          hook &&
          typeof hook.command === "string" &&
          hook.command.includes(" guard") &&
          (hook.command.includes(packageJson.name) || hook.command.includes("coding-flow")),
      ),
  );
}

// Merges the guard hook into settings.json. Creates the file if it's missing.
// Modifies nothing else. Returns the status for the init output.
function ensureHookSettings({ dryRun = false } = {}) {
  const target = settingsPath();
  const existed = fs.existsSync(target);
  const settings = readJson(target, null);

  // File present but unreadable: we don't touch it, we report it.
  if (existed && (!settings || typeof settings !== "object" || Array.isArray(settings))) {
    return { status: "unparseable", path: target };
  }

  const next = settings && typeof settings === "object" ? settings : {};

  if (hasGuardHook(next)) {
    return { status: "unchanged", path: target };
  }

  if (!next.hooks || typeof next.hooks !== "object" || Array.isArray(next.hooks)) {
    next.hooks = {};
  }

  if (!Array.isArray(next.hooks.PreToolUse)) {
    next.hooks.PreToolUse = [];
  }

  next.hooks.PreToolUse.push(guardHookEntry());

  if (!dryRun) {
    writeJson(target, next);
  }

  return { status: existed ? "merged" : "created", path: target };
}

module.exports = { ensureHookSettings, hasGuardHook, guardCommandString, GUARD_MATCHER };
