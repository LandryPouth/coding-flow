"use strict";

// The `harness` and `verify` commands: their entry points, the story scope they
// run on, and the export surface the rest of the CLI imports. The work lives in
// the modules below — harness-config (the policy file), security-policy
// (secrets, sensitive paths), diff-scope, risk, validation-run, coverage-gate,
// evidence and harness-report. Those never require this file.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { policyFingerprint } = require("./policy-fingerprint");
const { captureIdentity } = require("./identity");
const { currentBranch } = require("./policy");
const { resolveProjectPath, readStoryBundle, extractSection } = require("./story");
const {
  detectFeature: detectSpecKitFeature,
  isFeatureOf: isSpecKitFeatureOf,
} = require("./speckit");
const {
  fail,
  log,
  normalizePortable,
  readJson,
  writeJson,
  addIssue,
  walkProjectFiles,
} = require("./util");
const {
  harnessConfigPath,
  harnessRunsDir,
  defaultSecretPatterns,
  defaultHarnessConfig,
  readHarnessConfig,
  ensureHarnessConfig,
} = require("./harness-config");
const {
  compileSecretPatterns,
  getSecretPatterns,
  isHeuristicAllowlisted,
  findSecretsInContent,
  checkSensitivePaths,
  checkSecrets,
  checkEnvGitignore,
} = require("./security-policy");
const {
  setDiffBaseRequest,
  publicDiffBase,
  currentDiffBase,
  getChangedFiles,
  filterScopedFiles,
  changedFilesForCoverage,
} = require("./diff-scope");
const { scoreStoryRisk, scoreDiffRisk, combineRisk } = require("./risk");
const {
  resolveStoryDir,
  parseTestsCommands,
  resolveValidationCommands,
  captureEnvironment,
} = require("./validation-run");
const { evaluateCoverage } = require("./coverage-gate");
const {
  buildHarnessPreflight,
  checkStoryEvidence,
  findReusableVerify,
  writeVerifyEvidence,
  verifyStoryOnce,
} = require("./evidence");
const { printHarnessReport, printVerify } = require("./harness-report");

function collectHarnessReport({ quick = false, strict = false, story = null, files: onlyFiles = null } = {}) {
  const { config, exists } = readHarnessConfig();
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    root: cwd,
    policyFingerprint: policyFingerprint(cwd),
    configPath: normalizePortable(path.relative(cwd, harnessConfigPath())),
    configExists: exists,
    mode: config.mode,
    quick,
    strict,
    diffBase: publicDiffBase(currentDiffBase(cwd)),
    story: story || null,
    config,
    stats: {
      filesScanned: 0,
    },
    errors: [],
    warnings: [],
  };

  if (!exists) {
    addIssue(
      report.warnings,
      "missing_harness_config",
      "Harness config is not initialized; run `ai-flow harness init` to make the policy explicit",
      ".coding-flow/harness.json",
    );
  }

  // An explicit list (what `ship` is about to stage) replaces the tree walk.
  const files = Array.isArray(onlyFiles) ? onlyFiles : walkProjectFiles(cwd, { quick });
  report.stats.filesScanned = files.length;

  checkSensitivePaths(files, config, report);
  checkSecrets(files, report);
  checkEnvGitignore(report, { strict });
  checkStoryEvidence(report, { story, strict });

  report.ok = report.errors.length === 0;
  return report;
}

function buildHarnessEvidence({ story = null } = {}) {
  const preflight = buildHarnessPreflight({ story });
  const report = collectHarnessReport({ story, strict: false });
  let rollbackNotes = "";

  if (story) {
    const resolvedStory = resolveProjectPath(story);

    if (resolvedStory && resolvedStory.insideRoot && resolvedStory.exists) {
      const storyDir = fs.statSync(resolvedStory.fullPath).isDirectory()
        ? resolvedStory.fullPath
        : path.dirname(resolvedStory.fullPath);
      const notesPath = path.join(storyDir, "tasks.md");

      if (fs.existsSync(notesPath)) {
        rollbackNotes = extractSection(fs.readFileSync(notesPath, "utf8"), "Rollback Notes");
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
    policyFingerprint: policyFingerprint(cwd),
    provenance: captureIdentity(cwd),
    story: preflight.story,
    diffBase: publicDiffBase(currentDiffBase(cwd)),
    risk: preflight.risk,
    recommendedMode: preflight.recommendedMode,
    filesChanged: getChangedFiles(),
    requiredChecks: preflight.requiredChecks,
    validation: {
      harnessCheck: report.ok ? "pass" : "fail",
      errors: report.errors,
      warnings: report.warnings,
    },
    rollbackNotes,
    remainingRisks: report.errors.map((issue) => issue.message),
  };
}

function harnessInit({ json = false, dryRun = false, force = false, mode = null } = {}) {
  const existing = readJson(harnessConfigPath(), null);
  const allowedModes = new Set(["fast", "standard", "strict"]);
  const config = {
    ...defaultHarnessConfig(),
    ...(existing || {}),
  };

  if (mode) {
    if (!allowedModes.has(mode)) {
      fail(`invalid harness mode "${mode}". Use fast, standard, or strict.`);
    }

    config.mode = mode;
  }

  if (json || dryRun) {
    log(JSON.stringify(config, null, 2));
  }

  if (dryRun) {
    return;
  }

  if (existing && !force) {
    if (!json) {
      log("Harness config already exists. Use --force to overwrite it.");
    }
    return;
  }

  writeJson(harnessConfigPath(), config);
  fs.mkdirSync(harnessRunsDir(), { recursive: true });

  if (!json) {
    log("Security evidence harness initialized.");
    log(`Config: ${normalizePortable(path.relative(cwd, harnessConfigPath()))}`);
    log(`Runs: ${normalizePortable(path.relative(cwd, harnessRunsDir()))}`);
  }
}

function harnessCheck({ json = false, quick = false, strict = false, story = null, base = null } = {}) {
  setDiffBaseRequest({ flagBase: base, story });
  const report = collectHarnessReport({ quick, strict, story });

  if (json) {
    log(JSON.stringify(report, null, 2));
  } else {
    printHarnessReport(report);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

function harnessPreflight({ json = false, story = null } = {}) {
  const contract = buildHarnessPreflight({ story });

  if (json) {
    log(JSON.stringify(contract, null, 2));
    return;
  }

  log("Harness preflight complete.");
  log(`Risk: ${contract.risk.level} (${contract.risk.reason})`);
  log(`Recommended mode: ${contract.recommendedMode.toUpperCase()}`);

  if (contract.story) {
    log(`Story: ${contract.story}${contract.storyExists ? "" : " (missing)"}`);
  }

  if (contract.risk.matchedTerms.length > 0) {
    log(`Matched terms: ${contract.risk.matchedTerms.join(", ")}`);
  }

  log("");
  log("Required checks:");
  for (const check of contract.requiredChecks) {
    log(`- ${check}`);
  }

  log("");
  log("Stop conditions:");
  for (const condition of contract.stopConditions) {
    log(`- ${condition}`);
  }
}

function harnessEvidence({ json = false, dryRun = false, story = null } = {}) {
  const evidence = buildHarnessEvidence({ story });
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-evidence.json`;
  const outputPath = path.join(harnessRunsDir(), fileName);

  if (json || dryRun) {
    log(JSON.stringify(evidence, null, 2));
  }

  if (dryRun) {
    return;
  }

  fs.mkdirSync(harnessRunsDir(), { recursive: true });
  writeJson(outputPath, evidence);

  if (!json) {
    log(`Harness evidence written to ${normalizePortable(path.relative(cwd, outputPath))}`);
  }

  if (evidence.validation.harnessCheck === "fail") {
    process.exitCode = 1;
  }
}

// --- verify: actual execution of the validation commands -----------------
//
// `evidence` captures the diff + the security scan but does NOT run your test
// suite. `verify` really runs it: it executes the declared validation commands,
// captures their exit codes and outputs verbatim, and fails if one of them
// breaks. Proof executed by the machine, not asserted by the agent.

// `--story` scopes the proof, and a scope that silently misses is worse than no
// scope at all: verify falls back to the project-wide commands and then writes an
// evidence claiming it proved a story that does not exist — which `audit` ingests
// as-is. `run` already refuses this (run.js selectStories); now that
// `verify --story` is the promoted, typed-by-hand escape hatch, it must too.
//
// Verify and `review capture` (review.js — the same "a typo'd --story must not
// silently produce evidence for the wrong thing" reasoning) are this strict.
// `preflight` deliberately reports a missing story as "(missing)", and `check`
// legitimately scopes its secret scan to any directory.
function requireStoryScope(story) {
  const storyDir = resolveStoryDir(story);

  if (storyDir === null) {
    fail(`--story "${story}" is not a story directory inside the project.`);
  }

  const relative = normalizePortable(path.relative(cwd, storyDir));

  // A Spec Kit feature directory is a story directory: spec.md / plan.md /
  // tasks.md are the same three roles under a different parent. Accepting it here
  // is the whole of the adapter — nothing downstream needs to know which layout
  // produced the work item.
  if (!relative.startsWith("epics/") && !isSpecKitFeatureOf(cwd, storyDir)) {
    fail(
      `--story "${story}" is not under epics/ or specs/. Verify proves stories, not arbitrary directories.`,
    );
  }
}

// With no --story, a Spec Kit project still has an active feature. Reading it
// costs nothing and makes the proof layer usable without adopting epics/.
// The source is always reported: a scope we guessed must say it guessed.
function detectStoryScope() {
  const feature = detectSpecKitFeature(cwd, { branch: currentBranch(cwd) });

  return feature
    ? { story: normalizePortable(path.relative(cwd, feature.dir)), source: feature.source }
    : null;
}

function harnessVerify({
  json = false,
  dryRun = false,
  story = null,
  noCache = false,
  exemption = null,
  base = null,
  allowPlanCommands = false,
  cleanEnv = false,
} = {}) {
  if (story !== null) {
    requireStoryScope(story);
  }

  setDiffBaseRequest({ flagBase: base, story });

  // No --story, but a Spec Kit project knows which feature is active. Scoping to
  // it is what lets a Spec Kit user run `ai-flow verify` and get the spec's risk
  // read and plan.md's commands, with no epics/ directory anywhere.
  let scopeNote = null;

  if (story === null) {
    const detected = detectStoryScope();

    if (detected) {
      story = detected.story;
      scopeNote = `Story: ${detected.story} (Spec Kit feature, from ${detected.source})`;
    }
  }

  setDiffBaseRequest({ flagBase: base, story });

  const resolvedStory = story ? resolveProjectPath(story) : null;

  if (scopeNote && !json) {
    log(scopeNote);
  }

  if (dryRun) {
    const resolution = resolveValidationCommands({ storyDir: resolveStoryDir(story) });
    const plan = {
      root: cwd,
      story: resolvedStory ? resolvedStory.relativePath : null,
      commandSource: resolution.source,
      commands: resolution.commands,
    };

    if (json) {
      log(JSON.stringify(plan, null, 2));
      return;
    }

    log("Harness verify — dry run (no command executed).");
    log(`Source: ${resolution.source || "none"}`);

    if (resolution.commands.length === 0) {
      log("No validation commands found.");
    }

    for (const command of resolution.commands) {
      log(`- ${command}`);
    }

    return;
  }

  // A green proof is reusable while the code it proved has not moved. Re-running
  // the suite to reconfirm it costs minutes and establishes nothing new.
  //
  // The hit does NOT write a fresh evidence: claiming a run that did not happen is
  // the one thing this tool must never do. The earlier evidence still carries the
  // current tree token, so `status` and `audit` already read it as verified.
  // A clean-env run is asked for a proof made without the secrets; replaying one
  // made with them would answer a different question.
  if (!noCache && !cleanEnv) {
    const resolution = resolveValidationCommands({ storyDir: resolveStoryDir(story) });
    const reusable = findReusableVerify({
      storyRelativePath: resolvedStory ? resolvedStory.relativePath : null,
      commands: resolution.commands,
      timeouts: resolution.timeouts,
    });

    if (reusable) {
      if (json) {
        log(JSON.stringify({ ...reusable.evidence, reused: true }, null, 2));
      } else {
        log(`Harness verify: already proved (${reusable.evidence.results.length} command(s), nothing changed since).`);
        log(`Commands from: ${reusable.evidence.commandSource}`);
        log(`Evidence: ${normalizePortable(path.relative(cwd, reusable.path))}`);
        log("Re-run anyway with --no-cache.");
      }

      return;
    }
  }

  const evidence = verifyStoryOnce({ story, exemption, allowPlanCommands, cleanEnv, announce: !json });

  // A refusal executed nothing: it says who may run these commands, not whether the
  // code passes. Recording it would overwrite an earlier green proof and turn a
  // verified story into a blocked one.
  if (evidence.refused) {
    if (json) {
      log(JSON.stringify(evidence, null, 2));
    } else {
      printVerify(evidence, null);
    }

    process.exitCode = 1;
    return;
  }

  const outputPath = writeVerifyEvidence(evidence);

  if (json) {
    log(JSON.stringify(evidence, null, 2));
  } else {
    printVerify(evidence, outputPath);
  }

  // "Nothing executed" is not "verified": we fail if no command ran.
  if (!evidence.ok) {
    process.exitCode = 1;
  }
}

// The request is per command: ship, doctor and status read the same helpers in
// the same process and must not inherit a --base given to a verify.
function harnessCommand(args) {
  try {
    return harnessCommandInner(args);
  } finally {
    setDiffBaseRequest();
  }
}

function harnessCommandInner({ commandArgs, getFlagValue, flags }) {
  const subcommand = commandArgs[0] || "check";
  const story = getFlagValue("--story", null);
  const base = getFlagValue("--base", null);

  if (flags.has("--base") && base === null) {
    fail("--base requires a ref, e.g. --base feature/EPIC-07-proof-scope.");
  }

  // A flag with no value is a typo in any subcommand: `verify --story --json`
  // used to swallow the flag and quietly verify the whole project.
  if (flags.has("--story") && story === null) {
    fail("--story requires a path, e.g. --story epics/epic-01/story-01-01-name.");
  }

  if (subcommand === "init") {
    harnessInit({
      json: flags.has("--json"),
      dryRun: flags.has("--dry-run"),
      force: flags.has("--force"),
      mode: getFlagValue("--mode", null),
    });
  } else if (subcommand === "check") {
    harnessCheck({
      json: flags.has("--json"),
      quick: flags.has("--quick"),
      strict: flags.has("--strict"),
      story,
      base,
    });
  } else if (subcommand === "preflight") {
    setDiffBaseRequest({ flagBase: base, story });
    harnessPreflight({
      json: flags.has("--json"),
      story,
    });
  } else if (subcommand === "evidence") {
    setDiffBaseRequest({ flagBase: base, story });
    harnessEvidence({
      json: flags.has("--json"),
      dryRun: flags.has("--dry-run"),
      story,
    });
  } else if (subcommand === "verify") {
    const exemption = getFlagValue("--test-exemption", null);

    // An exemption with no reason is the one form this must never accept: the
    // reason IS the artifact. A bare flag is a typo or an attempt to wave the
    // gate through, and both deserve the same answer.
    if (flags.has("--test-exemption") && !exemption) {
      fail('--test-exemption requires a reason, e.g. --test-exemption "vendor SDK bump, no behavior change".');
    }

    harnessVerify({
      json: flags.has("--json"),
      dryRun: flags.has("--dry-run"),
      story,
      noCache: flags.has("--no-cache"),
      exemption,
      base,
      allowPlanCommands: flags.has("--allow-plan-commands"),
      cleanEnv: flags.has("--clean-env"),
    });
  } else {
    fail(`unknown harness command "${subcommand}". Use init, preflight, check, verify, or evidence.`);
  }
}

module.exports = {
  harnessConfigPath,
  harnessRunsDir,
  defaultHarnessConfig,
  readHarnessConfig,
  filterScopedFiles,
  ensureHarnessConfig,
  collectHarnessReport,
  parseTestsCommands,
  getSecretPatterns,
  compileSecretPatterns,
  findSecretsInContent,
  isHeuristicAllowlisted,
  defaultSecretPatterns,
  evaluateCoverage,
  scoreDiffRisk,
  scoreStoryRisk,
  combineRisk,
  readStoryBundle,
  changedFilesForCoverage,
  harnessCommand,
  // Reused by `run` (batch orchestration) so it shares the single-story verify
  // execution path instead of duplicating it.
  verifyStoryOnce,
  writeVerifyEvidence,
  resolveValidationCommands,
  resolveStoryDir,
  requireStoryScope,
  captureEnvironment,
  // Reused by `worktree land`'s post-merge re-verify so a failing command is
  // reported in the exact shape `ai-flow verify` already reports one in.
  printVerify,
};

