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
const { reviewHistoryByStoryDir } = require("./audit");

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

// Story 19-09: every capture is the story's next review round. A pass right
// after a fail must say it is that next round (`--round`): a failed review is
// cleared by a new review of the whole diff, never by a green verify or by the
// fixer's own word. `--accept` stays the user's way to take the risk instead.
function resolveRound(getFlagValue, { story, verdict, last, accept }) {
  const expected = last ? last.round + 1 : 1;
  const raw = getFlagValue("--round", null);

  if (raw !== null) {
    const declared = Number(raw);
    if (!Number.isInteger(declared) || declared < 1) {
      fail(`--round must be a positive integer, got "${raw}".`);
    }
    if (declared !== expected) {
      const previous = last ? `the last review of ${story} was round ${last.round} (${last.ok ? "pass" : "fail"})` : `${story} has no review yet`;
      fail(`--round ${declared} does not follow: ${previous}, so this one is round ${expected}.`);
    }
  }

  const clearsFail = verdict === "pass" && Boolean(last) && !last.ok;
  const unconfirmed = clearsFail && raw === null;

  if (unconfirmed && !(accept && accept.trim())) {
    fail(
      `review capture refuses --verdict pass right after a failed review (round ${last.round}, ${last.file}): ` +
        "a failed review is cleared by a new review of the whole diff, not by verify alone. " +
        "Fix every finding, have a new reviewer read the whole diff, then run " +
        `\`ai-flow review capture --story ${story} --verdict pass --round ${expected}\` — ` +
        'or accept the risk with --accept "<reason>" (with the user\'s agreement).',
    );
  }

  return { round: expected, after: clearsFail ? last.file : null, unconfirmed };
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

  // A pass is a claim that nothing blocking was left open. Recording one next to
  // an open P0/P1 needs a written reason, which is stored with the verdict.
  const accept = getFlagValue("--accept", null);
  const openBlocking = findingCounts.p0 + findingCounts.p1;
  const storyKey = normalizePortable(path.relative(cwd, storyDir));
  const history = reviewHistoryByStoryDir(cwd).get(storyKey) || [];
  const { round, after, unconfirmed } = resolveRound(getFlagValue, {
    story: storyKey,
    verdict,
    last: history[history.length - 1] || null,
    accept,
  });
  const needsAcceptance = (verdict === "pass" && openBlocking > 0) || unconfirmed;

  if (needsAcceptance && !(accept && accept.trim())) {
    fail(
      `review capture refuses --verdict pass with ${findingCounts.p0} P0 and ${findingCounts.p1} P1 open. ` +
        'Fix them and re-review, capture --verdict fail, or accept the risk with --accept "<reason>" ' +
        "(with the user's agreement).",
    );
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    story: storyKey,
    ok: verdict === "pass",
    verdict,
    round,
    ...(after ? { after } : {}),
    dimensions,
    findingCounts,
    reviewer,
    ...(needsAcceptance ? { acceptedRisk: accept.trim() } : {}),
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
