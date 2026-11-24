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
function resolveRound(getFlagValue, { story, verdict }) {
  const history = reviewHistoryByStoryDir(cwd).get(story) || [];
  const last = history[history.length - 1] || null;
  const expected = last ? last.round + 1 : 1;
  const raw = getFlagValue("--round", null);

  if (raw !== null) {
    if (!/^\d+$/.test(String(raw)) || Number(raw) < 1) {
      fail(`--round must be a positive whole number, got "${raw}".`);
    }
    if (Number(raw) !== expected) {
      const previous = last ? `the last review of ${story} was round ${last.round} (${last.ok ? "pass" : "fail"})` : `${story} has no review yet`;
      fail(`--round ${raw} does not follow: ${previous}, so this one is round ${expected}.`);
    }
  }

  const clearsFail = verdict === "pass" && Boolean(last) && !last.ok;
  return { round: expected, after: clearsFail ? last.file : null, lastFailed: clearsFail ? last : null, unconfirmed: clearsFail && raw === null };
}

// What a pass would claim without being entitled to: open P0/P1 findings, and
// a failed review left without a new round. Each needs the user's
// `--accept "<reason>"`; refused together, so one run names every gap.
function unacceptedRisks({ verdict, findingCounts, lastFailed, unconfirmed, story, round }) {
  const risks = [];
  if (verdict === "pass" && findingCounts.p0 + findingCounts.p1 > 0) {
    risks.push({
      kind: "open-findings",
      message: `${findingCounts.p0} P0 and ${findingCounts.p1} P1 are open — fix them and re-review, or capture --verdict fail`,
    });
  }
  if (unconfirmed) {
    risks.push({
      kind: "round",
      message:
        `the last review failed (round ${lastFailed.round}, ${lastFailed.file}): a failed review is cleared by a new review of the whole diff, not by verify alone. ` +
        `Fix every finding, have a new reviewer read the whole diff, then run \`ai-flow review capture --story ${story} --verdict pass --round ${round}\``,
    });
  }
  return risks;
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

  const dimensions = Object.fromEntries(DIMENSION_NAMES.map((name) => [name, parseDimension(getFlagValue, name)]));

  const findingCounts = Object.fromEntries(["p0", "p1", "p2", "p3"].map((name) => [name, parseCount(getFlagValue, `--${name}`)]));

  // A pass is a claim that nothing blocking was left open (story 19-09: nor a
  // failed review left without a new round). Recording one anyway needs a
  // written reason, stored with the verdict and what it was accepted for.
  const accept = getFlagValue("--accept", null);
  const storyKey = normalizePortable(path.relative(cwd, storyDir));
  const rounds = resolveRound(getFlagValue, { story: storyKey, verdict });
  const risks = unacceptedRisks({ verdict, findingCounts, ...rounds, story: storyKey });

  if (risks.length > 0 && !(accept && accept.trim())) {
    fail(
      `review capture refuses --verdict pass: ${risks.map((risk) => risk.message).join("; and ")}. ` +
        'Or accept the risk with --accept "<reason>" (with the user\'s agreement).',
    );
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    story: storyKey,
    ok: verdict === "pass",
    verdict,
    round: rounds.round,
    ...(rounds.after ? { after: rounds.after } : {}),
    dimensions,
    findingCounts,
    reviewer,
    ...(risks.length > 0 ? { acceptedRisk: accept.trim(), acceptedFor: risks.map((risk) => risk.kind) } : {}),
    provenance: captureIdentity(cwd),
  };

  const outputPath = writeReviewEvidence(evidence);

  if (json) {
    log(JSON.stringify(evidence, null, 2));
  } else {
    log(
      `Review evidence written to ${normalizePortable(path.relative(cwd, outputPath))} ` +
        `(${evidence.story}: ${verdict}, round ${evidence.round}).`,
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
