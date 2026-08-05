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

// Where this project's skills come from. "plugin" = the coding-flow plugin
// serves them globally (`coding-flow:flow-run`), so the project holds no copy.
// "project" = they are committed under .claude/skills (`/flow-run`), for repos
// whose users do not install the plugin. Never both: two identical skills under
// two names is the single most confusing thing this tool can do.
const SKILLS_MODES = ["plugin", "project"];

function configPath(cwd) {
  return path.join(cwd, ".coding-flow", "config.json");
}

function defaultConfig() {
  return {
    version: 1,
    storage: "local",
    branchPerEpic: true,
    // "project" is the fallback on purpose: a config written before this field
    // existed described an install that DID copy the skills, and doctor must
    // keep requiring them for those projects.
    skills: "project",
    // Validation commands run by `ai-flow verify`. Empty by default: the
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
  const skills = SKILLS_MODES.includes(existing.skills) ? existing.skills : defaults.skills;

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
    skills,
    branchPerEpic:
      typeof existing.branchPerEpic === "boolean" ? existing.branchPerEpic : defaults.branchPerEpic,
    validation,
  };
}

// Creates the config if it does not exist yet. Never overwrites it: decisions
// already made stay stable across upgrades.
function ensureConfig(cwd, { dryRun = false, storage = "local", branchPerEpic = true, skills = "project" } = {}) {
  const target = configPath(cwd);

  if (fs.existsSync(target)) {
    return { created: false, path: target, config: readConfig(cwd) };
  }

  const config = { ...defaultConfig(), storage, branchPerEpic, skills };

  if (!dryRun) {
    writeJson(target, config);
  }

  return { created: true, path: target, config };
}

// The channel this project RECORDED, or null when it never recorded one — which
// is what a project installed before the field existed looks like. readConfig
// cannot answer this: it merges in the default, so "never chose" and "chose
// project" come back identical. `upgrade` needs the difference to know whether
// it may decide for the user.
function readConfigSkillsChoice(cwd) {
  const raw = readJson(configPath(cwd), null);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  return SKILLS_MODES.includes(raw.skills) ? raw.skills : null;
}

// The one decision a project is allowed to change after install: which channel
// serves its skills. Everything else in the config is set once at init.
function writeConfigSkills(cwd, skills) {
  if (!SKILLS_MODES.includes(skills)) {
    return readConfig(cwd);
  }

  const config = { ...readConfig(cwd), skills };
  writeJson(configPath(cwd), config);
  return config;
}

module.exports = {
  STORAGE_BACKENDS,
  SKILLS_MODES,
  readConfigSkillsChoice,
  writeConfigSkills,
  configPath,
  defaultConfig,
  readConfig,
  ensureConfig,
};
