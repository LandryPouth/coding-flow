"use strict";

// The two OpenCode wirings that are not the guard plugin:
//
//  - `instructions`: OpenCode reads `CLAUDE.md` as a fallback but does not expand
//    its `@RULES.md` import, so a project's rulebook never reaches the model.
//    `opencode.json` `instructions` is the mechanism OpenCode itself honours
//    (checked against OpenCode 1.19: the file text lands in the context), so the
//    install adds `RULES.md` there instead of leaving the rules to be "read when
//    a command remembers to".
//  - the global skill set: OpenCode loads `~/.config/opencode/skills/*/SKILL.md` in
//    every project, the equivalent of installing the Claude plugin once. (Earlier
//    versions wrote `command/*.md` there; install and uninstall retire those.)
//
// Both are non-destructive: an existing config is merged, never rewritten blind,
// and a global command the user edited is kept (same hash rule as the project's).

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const INSTRUCTIONS_ENTRY = "RULES.md";
const GLOBAL_MANIFEST = "coding-flow-global.json";

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function projectConfigPath(root) {
  return ["opencode.json", "opencode.jsonc"].map((n) => path.join(root, n)).find((p) => fs.existsSync(p)) || null;
}

// Statuses: "created", "merged", "unchanged", "skipped" (a config we cannot parse
// — typically JSONC with comments — is left alone and named), "no-rules" (nothing
// to point at: a minimal install has no RULES.md).
function ensureOpenCodeInstructions({ root, dryRun = false } = {}) {
  if (!fs.existsSync(path.join(root, INSTRUCTIONS_ENTRY))) {
    return { status: "no-rules" };
  }

  const existing = projectConfigPath(root);
  const target = existing || path.join(root, "opencode.json");
  let config = { $schema: "https://opencode.ai/config.json" };

  if (existing) {
    try {
      config = JSON.parse(fs.readFileSync(existing, "utf8"));
    } catch {
      return { status: "skipped", path: existing };
    }

    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      return { status: "skipped", path: existing };
    }
  }

  if (config.instructions !== undefined && !Array.isArray(config.instructions)) {
    return { status: "skipped", path: target };
  }

  const list = config.instructions || [];

  if (list.includes(INSTRUCTIONS_ENTRY)) {
    return { status: "unchanged", path: target };
  }

  if (!dryRun) {
    fs.writeFileSync(target, `${JSON.stringify({ ...config, instructions: [...list, INSTRUCTIONS_ENTRY] }, null, 2)}\n`);
  }

  return { status: existing ? "merged" : "created", path: target };
}

function inspectOpenCodeInstructions(root) {
  const existing = projectConfigPath(root);

  if (!existing) {
    return "absent";
  }

  try {
    const config = JSON.parse(fs.readFileSync(existing, "utf8"));
    return Array.isArray(config.instructions) && config.instructions.includes(INSTRUCTIONS_ENTRY) ? "wired" : "absent";
  } catch {
    return "unreadable";
  }
}

function globalOpenCodeDir({ env = process.env, home = os.homedir() } = {}) {
  const base = env.XDG_CONFIG_HOME ? env.XDG_CONFIG_HOME : path.join(home, ".config");

  return path.join(base, "opencode");
}

function readGlobalManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, GLOBAL_MANIFEST), "utf8"));
  } catch {
    return { files: {} };
  }
}

// Manifest keys are paths relative to the OpenCode config dir
// ("skills/flow-run/SKILL.md"). A bare name ("flow-run.md") is a command written by
// an earlier version, under command/.
function globalFile(dir, key) {
  return key.includes("/") ? path.join(dir, key) : path.join(dir, "command", key);
}

function removeIfOurs(dir, key, hash, { dryRun }) {
  const target = globalFile(dir, key);

  if (!fs.existsSync(target)) {
    return "missing";
  }

  if (hashText(fs.readFileSync(target, "utf8")) !== hash) {
    return "modified";
  }

  if (!dryRun) {
    fs.unlinkSync(target);
    // A skill lives in its own directory: drop it once empty.
    const parent = path.dirname(target);
    if (parent !== dir && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
      fs.rmdirSync(parent);
    }
  }

  return "removed";
}

// `files`: [{ rel: "skills/flow-run/SKILL.md", content }]. A file whose current
// text matches what we last wrote is ours to refresh; anything else is the user's
// and is kept. Commands an earlier version wrote are retired on the way.
function installGlobalCommands(files, { dir = globalOpenCodeDir(), force = false, dryRun = false, version = null } = {}) {
  const manifest = readGlobalManifest(dir);
  const recorded = { ...(manifest.files || {}) };
  const written = [];
  const skipped = [];
  const retired = [];

  for (const [key, hash] of Object.entries(recorded)) {
    if (key.includes("/")) {
      continue;
    }

    const outcome = removeIfOurs(dir, key, hash, { dryRun });

    if (outcome !== "modified") {
      delete recorded[key];
    }

    if (outcome === "removed") {
      retired.push(`command/${key}`);
    }
  }

  for (const { rel, content } of files) {
    const target = path.join(dir, rel);
    const rendered = hashText(content);

    if (fs.existsSync(target)) {
      const current = hashText(fs.readFileSync(target, "utf8"));

      if (current === rendered) {
        recorded[rel] = rendered;
        skipped.push(rel);
        continue;
      }

      if (!force && recorded[rel] !== current) {
        skipped.push(rel);
        continue;
      }
    }

    if (!dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      recorded[rel] = rendered;
    }

    written.push(rel);
  }

  if (!dryRun && (written.length > 0 || skipped.length > 0 || retired.length > 0)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, GLOBAL_MANIFEST), `${JSON.stringify({ version, files: recorded }, null, 2)}\n`);
  }

  return { dir: path.join(dir, "skills"), written, skipped, retired };
}

// Removes only the files still matching what we wrote; edited ones are reported.
function uninstallGlobalCommands({ dir = globalOpenCodeDir(), dryRun = false } = {}) {
  const manifest = readGlobalManifest(dir);
  const removed = [];
  const modified = [];

  for (const [key, hash] of Object.entries(manifest.files || {})) {
    const outcome = removeIfOurs(dir, key, hash, { dryRun });

    if (outcome === "removed") {
      removed.push(key);
    } else if (outcome === "modified") {
      modified.push(key);
    }
  }

  if (!dryRun && modified.length === 0) {
    fs.rmSync(path.join(dir, GLOBAL_MANIFEST), { force: true });
  }

  return { dir, removed, modified };
}

function inspectGlobalCommands({ dir = globalOpenCodeDir() } = {}) {
  const manifest = readGlobalManifest(dir);

  return { installed: Object.keys(manifest.files || {}).length > 0, version: manifest.version || null };
}

module.exports = {
  ensureOpenCodeInstructions,
  inspectOpenCodeInstructions,
  globalOpenCodeDir,
  installGlobalCommands,
  uninstallGlobalCommands,
  inspectGlobalCommands,
  INSTRUCTIONS_ENTRY,
};
