"use strict";

// `ai-flow review capture`: turns a `/flow-review` verdict into durable
// evidence, the same way `harness.js`'s `writeVerifyEvidence` turns a test
// run into one — same `.coding-flow/runs/` directory, same provenance shape
// (`identity.js`'s `captureIdentity`, so `provenance.git.treeToken` is the
// exact token verify evidence already captures), read back per story
// directory by `audit.js`'s `latestReviewByStoryDir`. Nothing gates on this
// yet (story-04-02); this only makes the fact exist and be visible in
// `ai-flow status`.

const path = require("path");

const { cwd } = require("./context");
const { log, fail, normalizePortable, writeTimestampedEvidence } = require("./util");
const { captureIdentity } = require("./identity");
const { resolveStoryDir, requireStoryScope } = require("./harness");

const DIMENSION_NAMES = ["architecture", "tests", "security", "quality", "e2e"];
const DIMENSION_DEPTHS = new Set(["quick", "deep", "skipped"]);
const VERDICTS = new Set(["pass", "fail"]);
const REVIEWERS = new Set(["self", "subagent"]);

function runsDir() {
  return path.join(cwd, ".coding-flow", "runs");
}

function writeReviewEvidence(evidence) {
  return writeTimestampedEvidence(runsDir(), "review", evidence);
}

function parseCount(getFlagValue, flagName) {
  const raw = getFlagValue(flagName, "0");
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 0) {
    fail(`${flagName} must be a non-negative integer, got "${raw}".`);
  }

  return value;
}

function parseDimension(getFlagValue, name) {
  const flagName = `--${name}`;
  const raw = getFlagValue(flagName, "skipped");

  if (!DIMENSION_DEPTHS.has(raw)) {
    fail(`${flagName} must be one of quick, deep, skipped — got "${raw}".`);
  }

  return raw;
}

function reviewCapture({ getFlagValue, flags, json = false }) {
  const story = getFlagValue("--story", null);
  if (!story) {
    fail("review capture requires --story <dir>.");
  }

  // Same guard `verify --story` applies, and for the same reason
  // (harness.js's `requireStoryScope`): a typo'd or arbitrary `--story` must
  // fail loudly rather than silently write evidence keyed to the wrong (or
  // an empty) story path that no later `latestReviewByStoryDir` lookup will
  // ever match.
  requireStoryScope(story);
  const storyDir = resolveStoryDir(story);

  const verdict = getFlagValue("--verdict", null);
  if (!VERDICTS.has(verdict)) {
    fail('review capture requires --verdict pass|fail.');
  }

  const reviewer = getFlagValue("--reviewer", "self");
  if (!REVIEWERS.has(reviewer)) {
    fail(`--reviewer must be one of self, subagent — got "${reviewer}".`);
  }

  const dimensions = {};
  for (const name of DIMENSION_NAMES) {
    dimensions[name] = parseDimension(getFlagValue, name);
  }

  const findingCounts = {
    p0: parseCount(getFlagValue, "--p0"),
    p1: parseCount(getFlagValue, "--p1"),
    p2: parseCount(getFlagValue, "--p2"),
    p3: parseCount(getFlagValue, "--p3"),
  };

  const evidence = {
    generatedAt: new Date().toISOString(),
    story: normalizePortable(path.relative(cwd, storyDir)),
    ok: verdict === "pass",
    verdict,
    dimensions,
    findingCounts,
    reviewer,
    provenance: captureIdentity(cwd),
  };

  const outputPath = writeReviewEvidence(evidence);

  if (json) {
    log(JSON.stringify(evidence, null, 2));
  } else {
    log(
      `Review evidence written to ${normalizePortable(path.relative(cwd, outputPath))} ` +
        `(${evidence.story}: ${verdict}).`,
    );
  }

  if (!evidence.ok) {
    process.exitCode = 1;
  }
}

function reviewCommand({ commandArgs, getFlagValue, flags }) {
  const subcommand = commandArgs[0];

  if (subcommand === "capture") {
    reviewCapture({ getFlagValue, flags, json: flags.has("--json") });
    return;
  }

  fail(`unknown "review" subcommand "${subcommand || ""}". Only "capture" exists.`);
}

module.exports = { reviewCommand, reviewCapture, writeReviewEvidence };
