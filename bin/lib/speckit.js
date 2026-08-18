"use strict";

// Spec Kit as an input, not as a dependency.
//
// A Spec Kit feature directory already holds spec.md / plan.md / tasks.md — the
// exact three roles `story.js` resolves. So a Spec Kit user does not need to
// adopt the epics/ layout to get the proof layer: the feature directory IS the
// story directory, and everything downstream (risk from the spec, commands from
// plan.md, coverage from the diff) works unchanged.
//
// This module answers one question — "which feature is active?" — and it answers
// it the way Spec Kit itself answers it (scripts/bash/common.sh:get_feature_paths):
//
//   1. SPECIFY_FEATURE_DIRECTORY
//   2. .specify/feature.json → feature_directory
//
// with one addition Spec Kit does not need and we do: when neither is set, we
// fall back to the feature under specs/ whose name matches the current branch,
// then to the most recently touched one. Spec Kit errors out there because it is
// about to WRITE; we are only about to read, and refusing to verify because a
// json file is missing would be the kind of friction that gets a tool bypassed.
//
// Nothing here shells out to Spec Kit, imports it, or requires it to be
// installed. If the directories look like Spec Kit, we can read them.

const fs = require("fs");
const path = require("path");

const { readJson, normalizePortable } = require("./util");

// Spec Kit puts features under specs/. The marker directory is what tells us the
// project is a Spec Kit project at all rather than a repo that happens to have a
// specs/ folder.
const MARKER_DIR = ".specify";
const FEATURE_ROOT = "specs";
const FEATURE_FILES = ["spec.md", "plan.md", "tasks.md"];

function isSpecKitProject(root) {
  return fs.existsSync(path.join(root, MARKER_DIR));
}

// A feature directory is one that holds at least one of the three role files.
// One is enough: `/speckit.specify` writes spec.md long before plan.md exists,
// and a spec alone is already enough to score risk against.
function isFeatureDir(dir) {
  return FEATURE_FILES.some((name) => fs.existsSync(path.join(dir, name)));
}

function listFeatureDirs(root) {
  const featureRoot = path.join(root, FEATURE_ROOT);

  let entries = [];
  try {
    entries = fs.readdirSync(featureRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(featureRoot, entry.name))
    .filter(isFeatureDir);
}

// The value stored by Spec Kit is repo-relative (or absolute under the repo).
// Anything pointing outside the repo is dropped rather than followed.
function resolvePinned(root, value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const full = path.isAbsolute(value) ? value : path.join(root, value);
  const relative = path.relative(root, full);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return fs.existsSync(full) && fs.statSync(full).isDirectory() ? full : null;
}

function mostRecent(dirs) {
  let best = null;
  let bestTime = -1;

  for (const dir of dirs) {
    let time = 0;

    for (const name of FEATURE_FILES) {
      try {
        time = Math.max(time, fs.statSync(path.join(dir, name)).mtimeMs);
      } catch {
        // The file simply is not there yet.
      }
    }

    if (time > bestTime) {
      best = dir;
      bestTime = time;
    }
  }

  return best;
}

// Returns { dir, source } for the active feature, or null. `source` is reported
// to the user, because a scope that was guessed must say so — the alternative is
// an evidence file claiming to prove a feature nobody selected.
function detectFeature(root, { branch = null, env = process.env } = {}) {
  if (!isSpecKitProject(root)) {
    return null;
  }

  const fromEnv = resolvePinned(root, env.SPECIFY_FEATURE_DIRECTORY);

  if (fromEnv) {
    return { dir: fromEnv, source: "SPECIFY_FEATURE_DIRECTORY" };
  }

  const pinned = readJson(path.join(root, MARKER_DIR, "feature.json"), null);
  const fromJson = pinned ? resolvePinned(root, pinned.feature_directory) : null;

  if (fromJson) {
    return { dir: fromJson, source: ".specify/feature.json" };
  }

  const features = listFeatureDirs(root);

  if (features.length === 0) {
    return null;
  }

  if (branch) {
    const match = features.find((dir) => path.basename(dir) === branch);

    if (match) {
      return { dir: match, source: `branch ${branch}` };
    }
  }

  if (features.length === 1) {
    return { dir: features[0], source: "the only feature under specs/" };
  }

  const recent = mostRecent(features);

  return recent ? { dir: recent, source: "most recently edited feature under specs/" } : null;
}

// True when `dir` is a Spec Kit feature directory of THIS project. Used by the
// verify scope check, which otherwise only accepts epics/.
function isFeatureOf(root, dir) {
  if (!isSpecKitProject(root)) {
    return false;
  }

  const relative = normalizePortable(path.relative(root, dir));

  return (
    relative.startsWith(`${FEATURE_ROOT}/`) &&
    relative.split("/").length === 2 &&
    isFeatureDir(dir)
  );
}

module.exports = {
  MARKER_DIR,
  FEATURE_ROOT,
  FEATURE_FILES,
  isSpecKitProject,
  isFeatureDir,
  listFeatureDirs,
  detectFeature,
  isFeatureOf,
};
