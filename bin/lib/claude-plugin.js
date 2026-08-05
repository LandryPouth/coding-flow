"use strict";

// Detects whether the coding-flow plugin is already installed in the user's
// Claude Code. It decides exactly ONE thing: the default for `init` — whether
// this project needs its own copy of the skills, or whether the plugin already
// serves them globally under the `coding-flow:` namespace.
//
// Two skills with the same name (`/flow-run` from the project AND
// `coding-flow:flow-run` from the plugin) is pure confusion, so we install one
// or the other, never both.
//
// Detection is best-effort BY DESIGN. It reads Claude Code's private plugin
// registry, so any format change must degrade to "not detected" — which falls
// back to copying the skills, the historical behavior — and never to a crash.
// The resolved answer is written to .coding-flow/config.json at init, so every
// later command reads the recorded decision instead of detecting again: an
// installed project must not behave differently on a teammate's machine.

const fs = require("fs");
const os = require("os");
const path = require("path");

const { readJson, toPortable } = require("./util");

const PLUGIN_NAME = "coding-flow";

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function pluginsDir() {
  return path.join(claudeConfigDir(), "plugins");
}

function readdirSafely(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// The skills the plugin would actually serve. A NAME is not evidence that a
// plugin is installed: uninstalling leaves the cache directory behind, and a
// marketplace can be named after one of its plugins. Only the artifact counts —
// if we cannot see a skill on disk, nothing is going to serve one, and skipping
// the project copy would leave the user with no skills at all.
function servesSkills(dir) {
  const skills = path.join(dir, "skills");

  for (const name of readdirSafely(skills)) {
    if (fs.existsSync(path.join(skills, name, "SKILL.md"))) {
      return true;
    }
  }

  return false;
}

// Claude Code installs a plugin as <plugin>/<version>/, so the usable root is
// either the directory itself or one version level down.
function findServingRoot(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return null;
  }

  if (servesSkills(dir)) {
    return dir;
  }

  for (const name of readdirSafely(dir)) {
    const nested = path.join(dir, name);

    if (servesSkills(nested)) {
      return nested;
    }
  }

  return null;
}

// Identity check for a directory we reached WITHOUT the registry naming it.
function declaresItself(dir) {
  const manifest = readJson(path.join(dir, ".claude-plugin", "plugin.json"), null);
  return Boolean(manifest && manifest.name === PLUGIN_NAME);
}

// Signal 1 — we are literally running from the installed plugin. Claude Code
// sets CLAUDE_PLUGIN_ROOT when it invokes a plugin's own binary (our guard
// hook does exactly that), so this is proof, not a guess.
function detectFromEnv() {
  const root = process.env.CLAUDE_PLUGIN_ROOT;

  if (!root || !fs.existsSync(root)) {
    return null;
  }

  // Its own manifest, not its path: a plugin living under a marketplace that
  // happens to be named "coding-flow" is a different plugin.
  if (!declaresItself(root) || !servesSkills(root)) {
    return null;
  }

  return { source: "env", detail: toPortable(root) };
}

// Signal 2 — the plugin registry. Keys look like "coding-flow@<marketplace>",
// each holding one or more install records.
function detectFromRegistry() {
  const data = readJson(path.join(pluginsDir(), "installed_plugins.json"), null);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const plugins = data.plugins;

  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
    return null;
  }

  for (const [key, value] of Object.entries(plugins)) {
    if (key !== PLUGIN_NAME && !key.startsWith(`${PLUGIN_NAME}@`)) {
      continue;
    }

    for (const entry of Array.isArray(value) ? value : [value]) {
      const installPath = entry && typeof entry === "object" ? entry.installPath : null;

      // A registry entry is a claim, not proof. It survives a plugin removed by
      // hand and a half-finished install; both would silently leave the project
      // with no skills at all. Believe it only if the skills are really there.
      const serving = findServingRoot(installPath);

      if (!serving) {
        continue;
      }

      return { source: "registry", detail: key };
    }
  }

  return null;
}

// Signal 3 — the on-disk cache (<plugins>/cache/<marketplace>/<plugin>/...).
// Catches an install the registry does not describe in a shape we understand.
function detectFromCache() {
  const cache = path.join(pluginsDir(), "cache");

  if (!fs.existsSync(cache)) {
    return null;
  }

  for (const marketplace of readdirSafely(cache)) {
    const serving = findServingRoot(path.join(cache, marketplace, PLUGIN_NAME));

    if (serving) {
      return { source: "cache", detail: toPortable(path.relative(cache, serving)) };
    }
  }

  return null;
}

// Never throws: an unreadable or unfamiliar Claude Code config means "unknown",
// and unknown means we keep the historical behavior.
function detectPlugin() {
  let hit = null;

  try {
    hit = detectFromEnv() || detectFromRegistry() || detectFromCache();
  } catch {
    hit = null;
  }

  return {
    installed: Boolean(hit),
    source: hit ? hit.source : null,
    detail: hit ? hit.detail : null,
  };
}

module.exports = { detectPlugin, PLUGIN_NAME, claudeConfigDir };
