"use strict";

// Did this diff touch the files that define the bar? A lint rule, a coverage
// threshold, a dependency rule or `harness.json` itself can make a check pass by
// being loosened. Direction is not judged — that would take a parser per format —
// so a tightening is reported too, and one declared sentence clears it. Only a
// contrary signal: it lowers what the verdict claims, it never raises it.

const { execFileSync } = require("child_process");

const { cwd } = require("./context");
const { defaultPolicyGlobs } = require("./harness-config");
const { currentDiffBase, runGitList } = require("./diff-scope");
const { matchesPattern, normalizePortable } = require("./util");

// Coding Flow's own config is always policy: an override that leaves it out
// would let the next diff edit the bar unseen.
const OWN_POLICY_FILES = [".coding-flow/harness.json", ".coding-flow/config.json"];

// `harness.json` as the base commit holds it, or null when the base has none (or
// it does not parse). The diff under proof is judged by the bar it started from,
// so it cannot unlist itself from policyGlobs or step down from strict.
function readBaseHarness(mergeBase = currentDiffBase(cwd).mergeBase) {
  if (!mergeBase) return null;

  try {
    const text = execFileSync("git", ["show", `${mergeBase}:./.coding-flow/harness.json`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(text);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The policy files this branch changed: committed since the base, uncommitted,
// or new. `.coding-flow/` is outside `changedFilesForCoverage`, so git is asked
// directly. A rename is its old path leaving, so renames are not paired. A
// caller with its own list (the refactor claim) passes `globs`; otherwise the
// list is the base's.
function readPolicyChanged(config, { globs: own = null } = {}) {
  const { mergeBase } = currentDiffBase(cwd);
  const atBase = mergeBase ? readBaseHarness(mergeBase) : config;
  const listed = own || (atBase && Array.isArray(atBase.policyGlobs) ? atBase.policyGlobs : defaultPolicyGlobs());
  const globs = [...listed, ...OWN_POLICY_FILES];
  const files = new Set([
    ...runGitList(["diff", "--name-only", "--no-renames", mergeBase || "HEAD", "--relative"], cwd),
    ...runGitList(["ls-files", "--others", "--exclude-standard"], cwd),
  ]);

  return [...files]
    .map(normalizePortable)
    .filter((file) => globs.some((pattern) => typeof pattern === "string" && matchesPattern(file, pattern)))
    .sort();
}

module.exports = { readPolicyChanged, readBaseHarness };
