"use strict";

// What a verify leaves behind: the preflight a story is checked against, the
// story-evidence check, fingerprints that decide whether a past run still
// proves today's tree, and the evidence file itself.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { cwd } = require("./context");
const { policyFingerprint } = require("./policy-fingerprint");
const { currentTreeToken, captureIdentity } = require("./identity");
const { resolveCoverageFloor } = require("./coverage");
const {
  storyPartPath,
  resolveProjectPath,
  readStoryBundle,
  extractSection,
} = require("./story");
const {
  normalizePortable,
  readJson,
  writeTimestampedEvidence,
  addIssue,
  log,
} = require("./util");
const {
  harnessConfigPath,
  harnessRunsDir,
  readHarnessConfig,
} = require("./harness-config");
const {
  currentDiffBase,
  runGitList,
  changedFilesForCoverage,
  setDiffBaseRequest,
  diffBaseFlag,
  publicDiffBase,
} = require("./diff-scope");
const { scoreStoryRisk, scoreDiffRisk, combineRisk } = require("./risk");
const {
  contraryPolicy,
  freshTestsRequired,
  evaluateCoverage,
  readAcceptanceCriteria,
  evaluateContrarySignals,
  NO_CONTRARY,
} = require("./coverage-gate");
const {
  isUnattended,
  resolveStoryDir,
  resolveValidationCommands,
  cleanEnvironment,
  runValidationCommand,
  commandTimeout,
  captureEnvironment,
} = require("./validation-run");

function buildHarnessPreflight({ story = null } = {}) {
  const { config, exists } = readHarnessConfig();
  const resolvedStory = resolveProjectPath(story);
  let storyText = "";
  let storyFiles = [];

  if (resolvedStory && resolvedStory.insideRoot && resolvedStory.exists) {
    const stat = fs.statSync(resolvedStory.fullPath);
    const storyDir = stat.isDirectory() ? resolvedStory.fullPath : path.dirname(resolvedStory.fullPath);
    const bundle = readStoryBundle(storyDir);
    storyText = Object.values(bundle).join("\n");
    storyFiles = Object.entries(bundle)
      .filter(([, content]) => content.trim().length > 0)
      .map(([name]) => normalizePortable(path.relative(cwd, path.join(storyDir, name))));
  }

  // Both sources, highest wins — but they do not have the same ceiling. The
  // diff is the only one that can say `high`, because it is the only one that
  // shows what the change actually reaches; the story can raise a quiet change
  // to `medium`. So wording a story mildly still cannot talk the score down,
  // and wording it dramatically can no longer buy STRICT ceremony for a
  // heading change.
  const risk = combineRisk(
    scoreStoryRisk(storyText, config),
    scoreDiffRisk(currentTreeToken(cwd) ? changedFilesForCoverage() : [], config),
  );
  const mode = risk.level === "high" ? "strict" : risk.level === "medium" ? "standard" : "fast";
  const requiredChecks = [...config.requiredChecks];

  if (risk.level === "high") {
    requiredChecks.push("security-check", "server-side-validation", "rollback-evidence");
  }

  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
    policyFingerprint: policyFingerprint(cwd),
    configPath: normalizePortable(path.relative(cwd, harnessConfigPath())),
    configExists: exists,
    story: resolvedStory ? resolvedStory.relativePath : null,
    storyExists: resolvedStory ? resolvedStory.exists : null,
    risk,
    recommendedMode: mode,
    storyFiles,
    requiredChecks: [...new Set(requiredChecks)],
    stopConditions: [
      "Secrets or local env files are present in the diff.",
      "Security-sensitive behavior lacks server-side enforcement.",
      "Rollback notes are missing for risky changes.",
      "Validation commands cannot run or fail outside story scope.",
      "The implementation touches files outside the declared story scope without explanation.",
    ],
  };
}

function checkStoryEvidence(report, { story = null, strict = false } = {}) {
  if (!story) {
    return;
  }

  const resolvedStory = resolveProjectPath(story);

  if (!resolvedStory || !resolvedStory.insideRoot) {
    addIssue(report.errors, "story_outside_root", "Story path must stay inside the project root", story);
    return;
  }

  if (!resolvedStory.exists) {
    addIssue(report.errors, "story_missing", `${resolvedStory.relativePath} does not exist`, resolvedStory.relativePath);
    return;
  }

  const storyDir = fs.statSync(resolvedStory.fullPath).isDirectory()
    ? resolvedStory.fullPath
    : path.dirname(resolvedStory.fullPath);
  const bundle = readStoryBundle(storyDir);
  const risk = scoreStoryRisk(Object.values(bundle).join("\n"), report.config);
  const relativeStoryDir = normalizePortable(path.relative(cwd, storyDir));

  // Paths come from the resolver, so a single-file story is told about story.md
  // and never sent looking for a spec.md it was never meant to have.
  const partPath = (part) => normalizePortable(path.relative(cwd, storyPartPath(storyDir, part)));

  if (!bundle["spec.md"].trim()) {
    addIssue(
      report.errors,
      "missing_spec_file",
      "a story-scoped harness check needs story content (spec.md or story.md)",
      partPath("spec"),
    );
  }

  // The executed outcome lives under `## Result` in tasks.md (Status, files
  // changed, tests run, rollback). The checklist above it must not satisfy the
  // high-assurance requirement, so we look at the Result section specifically.
  const notes = extractSection(bundle["tasks.md"], "Result");
  const notesPath = partPath("tasks");
  const highAssurance = strict || report.config.mode === "strict" || risk.level === "high";

  if (highAssurance && !notes.trim()) {
    addIssue(report.errors, "missing_result", "High-assurance story checks require a filled ## Result in tasks.md", notesPath);
    return;
  }

  if (notes.trim() && !/rollback/i.test(notes)) {
    addIssue(
      highAssurance ? report.errors : report.warnings,
      "missing_rollback_notes",
      "the tasks.md ## Result should include rollback notes",
      notesPath,
    );
  }

  if (risk.level === "high" && notes.trim() && !/(security|auth|permission|trust boundary|server-side)/i.test(notes)) {
    addIssue(
      report.warnings,
      "missing_security_evidence",
      "High-risk story results should mention the security validation performed",
      notesPath,
    );
  }

  if (risk.level === "high" && !bundle["plan.md"].trim()) {
    addIssue(
      report.warnings,
      "missing_tests_plan",
      "High-risk stories should keep the test plan in plan.md up to date",
      partPath("plan"),
    );
  }
}

// Identifies WHAT was proved, so a recorded proof is only reusable for the same
// set of commands. Changing config.validation must invalidate every prior green.
// A different limit is a different command contract: a run that passed under a
// 20 min limit proves nothing about the same command under 1 s. Commands with no
// declared limit hash exactly as before, so existing proofs stay valid.
function commandsFingerprint(commands, timeouts = {}) {
  const lines = commands.map((command) => (timeouts && timeouts[command] ? `${command}\u0000${timeouts[command]}` : command));

  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 40);
}

// The tree token deliberately ignores untracked files (see identity.js), which is
// fine for flagging staleness but not for skipping a run: a brand-new, untracked
// source file is exactly the case where re-running matters. Folding the untracked
// listing into the cache key closes that hole without touching what `stale` means.
// Only ever called once currentTreeToken() has confirmed a git repository, so an
// empty listing here means "no untracked files", not "git unavailable".
//
// `.coding-flow/` is excluded for the same reason the tree token excludes it: it
// is where proofs are written, so counting it would mean every verify invalidates
// the proof it just recorded.
function untrackedDigest() {
  const listing = runGitList(["ls-files", "--others", "--exclude-standard"]).filter(
    (file) => file !== ".coding-flow" && !file.startsWith(".coding-flow/"),
  );

  return crypto.createHash("sha256").update(listing.join("\n")).digest("hex").slice(0, 40);
}

// Looks for a green verify that already proves this exact story, at this exact
// working-tree content, for this exact command set. Re-running `tsc && test &&
// lint` to reconfirm a result nothing has invalidated is pure latency.
//
// Conservative by construction: outside git, or when anything cannot be
// determined, this returns null and the commands run for real.
function findReusableVerify({ storyRelativePath, commands, timeouts = {} }) {
  const token = currentTreeToken(cwd);
  const mergeBase = currentDiffBase(cwd).mergeBase;

  if (!token || commands.length === 0) {
    return null;
  }

  const untracked = untrackedDigest();
  const fingerprint = commandsFingerprint(commands, timeouts);
  const harnessConfig = readHarnessConfig().config;
  const floor = JSON.stringify(resolveCoverageFloor(harnessConfig));
  const contrary = JSON.stringify(contraryPolicy(harnessConfig));
  const policy = policyFingerprint(cwd);
  const runsDir = harnessRunsDir();

  if (!fs.existsSync(runsDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(runsDir)
    .filter((name) => name.endsWith("-verify.json"))
    .sort()
    .reverse();

  for (const name of candidates) {
    const fullPath = path.join(runsDir, name);
    const evidence = readJson(fullPath, null);

    if (!evidence || evidence.ok !== true || evidence.story !== storyRelativePath) {
      continue;
    }

    const provenanceToken = evidence.provenance && evidence.provenance.git
      ? evidence.provenance.git.treeToken
      : null;

    if (
      provenanceToken === token &&
      evidence.commandsFingerprint === fingerprint &&
      // A proof judged under another floor is a different proof; evidence from
      // before the floor existed has none and is re-run once.
      JSON.stringify(evidence.coverageFloor || null) === floor &&
      JSON.stringify(evidence.contraryPolicy || null) === contrary &&
      // Evidence without the field predates the policy fingerprint: never reused.
      evidence.policyFingerprint === policy &&
      // A proof made against another base is a different proof.
      (evidence.diffBase ? evidence.diffBase.mergeBase : null) === mergeBase &&
      evidence.untrackedDigest === untracked
    ) {
      return { evidence, path: fullPath };
    }
  }

  return null;
}

// Persists a verify evidence under .coding-flow/runs and returns its path. The
// name always ends in -verify.json (so the ledger/audit ingest it) and stays
// unique even inside a tight batch loop: same-millisecond writes get a counter.
function writeVerifyEvidence(evidence) {
  return writeTimestampedEvidence(harnessRunsDir(), "verify", evidence);
}

// A command an agent wrote into plan.md runs with the developer's (or the CI
// runner's) secrets, so it needs a human watching — or an explicit say-so.
const PLAN_COMMANDS_REFUSAL =
  "commands from plan.md are not run unattended; declare them in .coding-flow/config.json " +
  "(with the user's agreement) or pass --allow-plan-commands";

function verifyStoryOnce({
  story = null,
  exemption = null,
  skipCoverage = false,
  unattended = isUnattended(),
  allowPlanCommands = false,
  cleanEnv = false,
  announce = false,
} = {}) {
  const resolvedStory = story ? resolveProjectPath(story) : null;
  const storyDir = resolveStoryDir(story);
  setDiffBaseRequest({ flagBase: diffBaseFlag(), story });
  const { config } = readHarnessConfig();
  const freshRequired = freshTestsRequired({ storyDir, config });
  const resolution = resolveValidationCommands({ storyDir, fresh: freshRequired });
  const refused = resolution.source === "plan.md" && unattended && !allowPlanCommands ? PLAN_COMMANDS_REFUSAL : null;
  const cleaned = cleanEnv ? cleanEnvironment() : null;

  if (announce && !refused && resolution.source === "plan.md") {
    log("Running commands from plan.md (not from .coding-flow/config.json):");

    for (const command of resolution.commands) {
      log(`  ${command}`);
    }
  }

  // Captured before the commands run: a coverage report older than this was not
  // produced by this run, and must not be read as if it were.
  const startedAt = Date.now();
  const results = (refused ? [] : resolution.commands).map((command) => {
    const item = runValidationCommand(command, {
      ...commandTimeout(resolution, command),
      ...(cleaned ? { env: cleaned.env } : {}),
    });

    // A full replay is not wrong, but at this risk level it is not proof that the
    // tests ran against this code either.
    // Quality commands (lint, format) are exempt: `freshCommands` cannot replace them.
    if (freshRequired && item.ok && item.cache === "full" && !(resolution.quality || []).includes(command)) {
      return {
        ...item,
        ok: false,
        freshRequired:
          "fully replayed from a build-tool cache, and this story's risk asks for tests that ran: " +
          "re-run with the tool's force flag (e.g. --force), or declare validation.freshCommands " +
          "(`verify --no-cache` only skips the reuse of an earlier proof, not the build tool's cache).",
      };
    }

    return item;
  });
  const commandsOk = results.length > 0 && results.every((item) => item.ok);
  // Only evaluated on a green suite: a red one is already not a proof, and
  // telling someone their failing story also lacks tests is noise.
  const coverage = !commandsOk
    ? { required: false, ok: true, reason: "not evaluated (commands did not pass)", changedFiles: [], testFiles: [] }
    : skipCoverage
      ? { required: false, ok: true, reason: "not evaluated (no single story to attribute this run to)", changedFiles: [], testFiles: [] }
      : evaluateCoverage({ storyDir, config, exemption, startedAt });

  const acceptanceCriteria = readAcceptanceCriteria(storyDir);
  // Like coverage, only judged on a green suite for a single story.
  const contrary = commandsOk && !skipCoverage
    ? evaluateContrarySignals({ storyDir, config, exemption, criteria: acceptanceCriteria })
    : NO_CONTRARY;

  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
    provenance: captureIdentity(cwd),
    story: resolvedStory ? resolvedStory.relativePath : null,
    commandSource: resolution.source,
    commandsFound: resolution.commands.length,
    // Recorded so a later verify can recognise this proof as still applicable.
    commandsFingerprint: commandsFingerprint(resolution.commands, resolution.timeouts),
    // The floor this verdict was judged against. `.coding-flow/` is outside the
    // tree token, so without it an edit to the floor would leave a stale "ok".
    coverageFloor: resolveCoverageFloor(config),
    // The rules this verdict was computed under; a different value is a different proof.
    policyFingerprint: policyFingerprint(cwd),
    untrackedDigest: currentTreeToken(cwd) ? untrackedDigest() : null,
    environment: { ...captureEnvironment(), ...(cleaned ? { cleaned: true, dropped: cleaned.dropped } : {}) },
    unattended,
    ...(refused ? { refused } : {}),
    commandsOk,
    // Which base every diff-derived signal below was measured from: a surprising
    // coverage or risk verdict is explained by this line before anything else.
    diffBase: publicDiffBase(currentDiffBase(cwd)),
    coverage,
    acceptanceCriteria,
    // The policy the contrary-signals verdict was judged under, for the same
    // reason as `coverageFloor`: an edit to it must not leave a stale "ok".
    contraryPolicy: contraryPolicy(config),
    contrary,
    ok: commandsOk && coverage.ok && contrary.ok,
    results,
  };
}

module.exports = {
  buildHarnessPreflight,
  checkStoryEvidence,
  commandsFingerprint,
  findReusableVerify,
  writeVerifyEvidence,
  verifyStoryOnce,
};
