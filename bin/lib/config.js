"use strict";

// Project configuration: .coding-flow/config.json. This file records the
// decisions made at install time (storage backend, branch policy) so that every
// command reads the same source. JSON and not YAML: the project stays
// zero-dependency (parsing YAML would require a lib).

const fs = require("fs");
const path = require("path");

const { readJson, writeJson } = require("./util");

// Known storage backends. "local" = epics/stories as versioned files (default).
// "github" = GitHub issues/sub-issues (seam in place, see storage/github.js —
// implementation deferred until a real need exists).
const STORAGE_BACKENDS = ["local", "github"];

function configPath(cwd) {
  return path.join(cwd, ".coding-flow", "config.json");
}

function defaultConfig() {
  return {
    version: 1,
    storage: "local",
    branchPerEpic: true,
    // Validation commands run by `ai-flow harness verify`. Empty by default: the
    // command then falls back to the "## Commands" block of plan.md, then to the
    // package.json scripts. Declaring them here makes validation explicit and
    // language-independent.
    //
    // `commands` are the correctness checks (tests, typecheck). `quality` is the
    // deterministic code-quality bucket (lint, format:check, duplication like
    // jscpd). Both run through the same `verify` proof pipeline and are captured
    // verbatim — a red quality command blocks exactly like a red test. Splitting
    // them is documentation, not behavior: it says "these gate quality" without
    // inventing a second pipeline. The tool never judges quality; it executes what
    // the project declared and captures the proof.
    validation: { commands: [], quality: [] },
  };
}

// Reads the config, merging with the defaults and validating the known values.
// A missing or corrupt config falls back cleanly to the defaults.
function readConfig(cwd) {
  const defaults = defaultConfig();
  const existing = readJson(configPath(cwd), null);

  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return { ...defaults };
  }

  const storage = STORAGE_BACKENDS.includes(existing.storage) ? existing.storage : defaults.storage;

  const cleanCommandList = (value) =>
    Array.isArray(value) ? value.filter((c) => typeof c === "string" && c.trim()) : [];

  const validation =
    existing.validation && typeof existing.validation === "object" && !Array.isArray(existing.validation)
      ? {
          commands: cleanCommandList(existing.validation.commands),
          quality: cleanCommandList(existing.validation.quality),
        }
      : defaults.validation;

  return {
    ...defaults,
    ...existing,
    storage,
    branchPerEpic:
      typeof existing.branchPerEpic === "boolean" ? existing.branchPerEpic : defaults.branchPerEpic,
    validation,
  };
}

// Creates the config if it does not exist yet. Never overwrites it: decisions
// already made stay stable across upgrades.
function ensureConfig(cwd, { dryRun = false, storage = "local", branchPerEpic = true } = {}) {
  const target = configPath(cwd);

  if (fs.existsSync(target)) {
    return { created: false, path: target, config: readConfig(cwd) };
  }

  const config = { ...defaultConfig(), storage, branchPerEpic };

  if (!dryRun) {
    writeJson(target, config);
  }

  return { created: true, path: target, config };
}

module.exports = {
  STORAGE_BACKENDS,
  configPath,
  defaultConfig,
  readConfig,
  ensureConfig,
};
