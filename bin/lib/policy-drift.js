"use strict";

// Did this diff touch the files that define the bar? A lint rule, a coverage
// threshold, a dependency rule or `harness.json` itself can make a check pass by
// being loosened. Direction is not judged — that would take a parser per format —
// so a tightening is reported too, and one declared sentence clears it. Only a
// contrary signal: it lowers what the verdict claims, it never raises it.

const { cwd } = require("./context");
const { defaultPolicyGlobs } = require("./harness-config");
const { currentDiffBase, runGitList } = require("./diff-scope");
const { matchesPattern, normalizePortable } = require("./util");

// The policy files this branch changed: committed since the base, uncommitted,
// or new. `.coding-flow/` is outside `changedFilesForCoverage`, so git is asked
// directly.
function readPolicyChanged(config) {
  const globs = Array.isArray(config.policyGlobs) ? config.policyGlobs : defaultPolicyGlobs();
  const { mergeBase } = currentDiffBase(cwd);
  const files = new Set([
    ...runGitList(["diff", "--name-only", mergeBase || "HEAD", "--relative"], cwd),
    ...runGitList(["ls-files", "--others", "--exclude-standard"], cwd),
  ]);

  return [...files]
    .map(normalizePortable)
    .filter((file) => globs.some((pattern) => typeof pattern === "string" && matchesPattern(file, pattern)))
    .sort();
}

module.exports = { readPolicyChanged };
