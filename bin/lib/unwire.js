"use strict";

// What `uninstall` takes back besides the template files: the guard wiring of
// every platform, and the OpenCode rules pointer. Each one is removed only where
// it is recognisably ours, and nothing else in the same file is touched:
//
//   - Claude Code: our PreToolUse entry in .claude/settings.json (other hooks and
//     settings stay; the file goes only if nothing else is left in it).
//   - Codex: .codex/config.toml, only when it carries our generated marker.
//   - OpenCode: the guard plugin (marker-checked), and `RULES.md` in
//     opencode.json's `instructions` (the file goes only if we left it empty).

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { readJson, writeJson } = require("./util");
const { findGuardEntry } = require("./settings");
const { inspectCodexSandbox } = require("./codex-settings");
const { removeOpenCodePlugin, PLUGIN_RELATIVE } = require("./opencode");
const { INSTRUCTIONS_ENTRY } = require("./opencode-config");

function isEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

function unwireClaudeHook({ dryRun }) {
  const file = path.join(cwd, ".claude", "settings.json");
  const settings = readJson(file, null);

  if (!settings || typeof settings !== "object") {
    return null;
  }

  const found = findGuardEntry(settings);

  if (!found) {
    return null;
  }

  const { entry, hook } = found;
  entry.hooks = entry.hooks.filter((h) => h !== hook);

  const pre = settings.hooks.PreToolUse;

  if (entry.hooks.length === 0) {
    settings.hooks.PreToolUse = pre.filter((e) => e !== entry);
  }

  if (settings.hooks.PreToolUse.length === 0) {
    delete settings.hooks.PreToolUse;
  }

  if (isEmptyObject(settings.hooks)) {
    delete settings.hooks;
  }

  if (!dryRun) {
    if (isEmptyObject(settings)) {
      fs.unlinkSync(file);
    } else {
      writeJson(file, settings);
    }
  }

  return "guard hook removed from .claude/settings.json";
}

function unwireCodexSandbox({ dryRun }) {
  const { state, path: file } = inspectCodexSandbox(cwd);

  if (state !== "current" && state !== "stale") {
    return null;
  }

  if (!dryRun) {
    fs.unlinkSync(file);
  }

  return "sandbox profile .codex/config.toml removed";
}

function unwireOpenCodePlugin({ dryRun }) {
  const result = removeOpenCodePlugin({ file: path.join(cwd, PLUGIN_RELATIVE), dryRun });

  return result.status === "removed" ? `guard plugin ${PLUGIN_RELATIVE.split(path.sep).join("/")} removed` : null;
}

function unwireOpenCodeInstructions({ dryRun }) {
  const file = ["opencode.json", "opencode.jsonc"].map((n) => path.join(cwd, n)).find((p) => fs.existsSync(p));

  if (!file) {
    return null;
  }

  let config;

  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // A config with comments is not ours to rewrite; say so instead of guessing.
    return `${path.basename(file)} left as is (not plain JSON) — remove "${INSTRUCTIONS_ENTRY}" from its instructions by hand`;
  }

  if (!config || !Array.isArray(config.instructions) || !config.instructions.includes(INSTRUCTIONS_ENTRY)) {
    return null;
  }

  config.instructions = config.instructions.filter((entry) => entry !== INSTRUCTIONS_ENTRY);

  if (config.instructions.length === 0) {
    delete config.instructions;
  }

  const onlySchema = Object.keys(config).every((key) => key === "$schema");

  if (!dryRun) {
    if (onlySchema) {
      fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    }
  }

  return onlySchema ? `${path.basename(file)} removed (it only pointed at ${INSTRUCTIONS_ENTRY})` : `${INSTRUCTIONS_ENTRY} removed from ${path.basename(file)}`;
}

// Returns one line per thing it took back (or would, on a dry run).
function unwireGuards({ dryRun = false } = {}) {
  return [unwireClaudeHook, unwireCodexSandbox, unwireOpenCodePlugin, unwireOpenCodeInstructions]
    .map((step) => step({ dryRun }))
    .filter(Boolean);
}

module.exports = { unwireGuards };
