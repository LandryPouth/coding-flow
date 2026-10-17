"use strict";

// Security harness: policy (.coding-flow/harness.json), scan of secrets and
// sensitive files, per-story preflight/evidence. The config primitives live in
// harness-config.js, a leaf copyTemplates (templates.js) can require.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { policyFingerprint } = require("./policy-fingerprint");
const { captureIdentity, currentTreeToken } = require("./identity");
const { currentBranch } = require("./policy");
const { describeScope } = require("./diff-base");
const { coverageTier, resolveCoverageFloor } = require("./coverage");
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
  diffBaseFlag,
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
  cleanEnvironment,
  isUnattended,
  runValidationCommand,
  commandTimeout,
  resultStatus,
  captureEnvironment,
} = require("./validation-run");
const {
  readAcceptanceCriteria,
  evaluateCoverage,
  freshTestsRequired,
  NO_CONTRARY,
  contraryPolicy,
  evaluateContrarySignals,
} = require("./coverage-gate");
const {
  buildHarnessPreflight,
  checkStoryEvidence,
  commandsFingerprint,
  untrackedDigest,
  findReusableVerify,
  writeVerifyEvidence,
} = require("./evidence");

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

function printHarnessReport(report) {
  if (report.ok) {
    log("Harness check passed.");
  } else {
    log("Harness check failed.");
  }

  log(`Files scanned: ${report.stats.filesScanned}`);

  if (report.errors.length > 0) {
    log("");
    log("Errors:");
    for (const error of report.errors) {
      log(`- ${error.file ? `${error.file}: ` : ""}${error.message}${error.line ? ` (line ${error.line})` : ""}`);
    }
  }

  if (report.warnings.length > 0) {
    log("");
    log("Warnings:");
    for (const warning of report.warnings) {
      log(`- ${warning.file ? `${warning.file}: ` : ""}${warning.message}${warning.line ? ` (line ${warning.line})` : ""}`);
    }
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

// 41,42,43,47 -> "41-43, 47". Uncovered lines come in runs, and a run printed as
// a range is one glance instead of four.
function formatLineRanges(lines) {
  const ranges = [];
  let start = null;
  let previous = null;

  for (const line of lines) {
    if (start === null) {
      start = line;
    } else if (line !== previous + 1) {
      ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
      start = line;
    }

    previous = line;
  }

  if (start !== null) {
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  }

  return `lines ${ranges.join(", ")} not executed`;
}

function printVerify(evidence, outputPath) {
  const coverage = evidence.coverage || { required: false, ok: true };
  const coverageBlocked = evidence.commandsOk && !coverage.ok;
  const contrary = evidence.contrary || NO_CONTRARY;
  const contraryBlocked = evidence.commandsOk && coverage.ok && !contrary.ok;

  if (evidence.refused) {
    log(`Harness verify REFUSED — ${evidence.refused}.`);
    log(`Nothing was executed (${evidence.commandsFound} command(s) found in plan.md).`);
  } else if (evidence.commandsFound === 0) {
    log("Harness verify: no validation commands found.");
    log("Declare them in plan.md under '## Commands' as a fenced code block, one command per line,");
    log("or in config.validation.commands.");
  } else if (coverageBlocked) {
    // Every command passed. The proof still does not hold, and saying "FAILED"
    // here would send someone hunting a broken test that does not exist.
    log(`Harness verify NOT PROVEN — ${evidence.results.length} command(s) passed, coverage gate blocked.`);
    log(`  ${coverage.reason}`);

    // Naming WHY this counted as risky matters: "the diff touches src/auth.js"
    // is checkable, "the story mentioned auth" is arguable.
    if (coverage.riskSource === "diff" && coverage.riskPaths && coverage.riskPaths.length > 0) {
      log(`  Risk read from the diff, not the story: ${coverage.riskPaths.slice(0, 3).join(", ")}`);
    }

    // Line-level: name the lines. "80% of the diff is uncovered" sends someone
    // reading the whole change; "src/auth.js:41-46" sends them to the code.
    if (coverage.patch) {
      const reports = coverage.patch.report.reports || [];
      log(reports.length > 1
        ? `  Measured from ${reports.length} reports: ${reports.map((r) => r.path).join(", ")}.`
        : `  Measured from ${coverage.patch.report.path} (${coverage.patch.report.format}).`);

      for (const entry of coverage.patch.uncovered.slice(0, 5)) {
        const detail = entry.absentFromReport
          ? "not executed at all (absent from the report)"
          : formatLineRanges(entry.lines);
        log(`  - ${entry.file}: ${detail}`);
      }
    } else if (coverage.behaviorFiles) {
      log(`  Changed without a test: ${coverage.behaviorFiles.slice(0, 5).join(", ")}` +
        (coverage.behaviorFiles.length > 5 ? ` (+${coverage.behaviorFiles.length - 5} more)` : ""));
    }

    printWeakenedTests(coverage);
    if (coverage.floor) {
      log("  Emit a coverage report (lcov.info / coverage-final.json) so the added lines are measured,");
      log("  or declare a '## Test Exemption' section (or --test-exemption) to ship on a written reason.");
    } else {
      log("  Add a test that covers this change, declare a '## Test Exemption' section in the story,");
      log('  or re-run with --test-exemption "<reason>" if there is no story.');
    }
  } else if (evidence.ok) {
    const warnings = describeContraryWarnings(contrary);
    log(warnings
      ? `Harness verify passed, with warnings (${warnings}): ${evidence.results.length} command(s).`
      : `Harness verify passed (${evidence.results.length} command(s)).`);

    // Name the rung before the sentence. "Coverage: evidence — 1 test file(s)
    // changed" and "Coverage: verified — 92% of the added lines ran" now read as
    // the different claims they are; before this they read as one.
    const tier = coverage.tier || coverageTier(coverage);

    if (coverage.exemption) {
      log(`  Coverage: exempted — "${coverage.exemption.split(/\r?\n/)[0]}"`);
    } else if (coverage.required) {
      const reportCount = coverage.patch ? (coverage.patch.report.reports || []).length : 0;
      log(`  Coverage: ${tier} — ${coverage.reason}` +
        (tier === "verified" && reportCount > 1 ? ` (${reportCount} reports)` : ""));

      // The one rung worth explaining: it passed on a proxy, and the way to earn
      // the stronger word is a coverage report this run actually produced.
      if (tier === "evidence" && coverage.patch) {
        log("  Some changed files lie outside every coverage report's package, so they are");
        log("  unmeasured; emit a report in their package to get 'verified'.");
      } else if (tier === "evidence") {
        log("  A test file moved; no fresh coverage report was found, so nothing measured");
        log("  this change. Emit lcov.info or coverage-final.json to get 'verified'.");
      }
    }

    // Printed at every rung, including `verified`. A measured 92% next to three
    // deleted tests is still three deleted tests, and the reader decides what that
    // means — this only refuses to let a good number hide it.
    printWeakenedTests(coverage);
    printOpenCriteria(evidence);
    printContraryFailures(contrary);
  } else if (contraryBlocked) {
    // The commands passed and the coverage gate held. What stops this is the
    // project's own strictness reading the story and the diff against the verdict.
    log(`Harness verify NOT PROVEN — ${evidence.results.length} command(s) passed, but the run contradicts itself.`);
    printContraryFailures(contrary);
    printWeakenedTests(coverage);
    printOpenCriteria(evidence);
  } else {
    log("Harness verify FAILED.");
    printWeakenedTests(coverage);
  }

  // Which commands ran, and why those. The silent fallback from a config that was
  // never found to whatever package.json happened to hold is exactly how a verify
  // ends up proving less than it claims; naming the source makes the drift visible
  // on the line above the results instead of only inside the JSON.
  if (evidence.commandsFound > 0) {
    log(`Commands from: ${evidence.commandSource}`);
  }

  // Which diff the coverage and risk verdicts above were measured on. "82 test
  // files" means one thing against the epic branch and another against main.
  const scopeLine = describeScope(
    evidence.diffBase,
    // A skipped coverage gate (low risk) never listed the files; "0 files" would lie.
    coverage.required !== false && Array.isArray(coverage.changedFiles) ? coverage.changedFiles.length : null,
  );

  if (scopeLine) {
    log(scopeLine);
  }

  for (const item of evidence.results) {
    const replay = item.cache === "full" || item.cache === "partial"
      ? `, replayed from cache${item.total ? `: ${item.cached}/${item.total} tasks` : ""}`
      : "";
    log(`- [${resultStatus(item)}] ${item.command} (${item.durationMs}ms${replay})`);

    if (item.freshRequired) {
      log(`    ${item.freshRequired}`);
    }

    // Name the knob: a timeout is a limit the project can raise, not a failure of the code.
    if (item.timedOut) {
      log(`    timeout after ${Number((item.timeoutMs / 1000).toFixed(1))} s (validation.timeoutMs)`);
    }

    if (item.toolError) {
      log(`    ${item.toolError}`);
    }

    // Prefer the lines that name the failure over the tail of stderr. A runner
    // that reports on stdout — node:test, vitest, pytest — leaves stderr empty,
    // so the old branch printed nothing at all for the most common case and the
    // reader had to re-run the command to find out what broke.
    if (!item.ok) {
      const named = Array.isArray(item.failureLines) && item.failureLines.length
        ? item.failureLines.slice(-3)
        : item.stderrTail.trim()
          ? item.stderrTail.trim().split(/\r?\n/).slice(-3)
          : [];

      for (const line of named) {
        log(`    ${line}`);
      }
    }
  }

  if (outputPath) {
    log(`Evidence: ${normalizePortable(path.relative(cwd, outputPath))}`);
  }
}

// Reported, never silently swallowed. These are regexes over a diff, so the
// wording stays descriptive — "assertions removed", not "test weakened on purpose".
function printWeakenedTests(coverage) {
  const findings = (coverage && coverage.weakenedTests) || [];

  if (!findings.length) {
    return;
  }

  log(`  Tests weakened in this diff (${findings.length}):`);

  for (const finding of findings.slice(0, 5)) {
    log(`    - ${finding.file}: ${finding.detail}`);
  }

  if (findings.length > 5) {
    log(`    - … and ${findings.length - 5} more`);
  }
}

// Only on a green verify, and only when something is still unticked. On a red
// one the failing command is the message, and on a fully ticked story there is
// nothing to say. The closing line is not filler: without it, a list printed
// under a passing verdict reads like a new gate, and the next thing someone
// does is look for the flag that turns it off.
function printOpenCriteria(evidence) {
  const criteria = evidence.acceptanceCriteria;

  if (!criteria || criteria.unchecked.length === 0) {
    return;
  }

  const deferred = criteria.deferred || [];
  const ticked = criteria.total - criteria.unchecked.length - deferred.length;

  log(`  Acceptance criteria: ${ticked}/${criteria.total} ticked in the story` +
    (deferred.length > 0 ? ` (${deferred.length} deferred)` : "") + ". Still open:");

  for (const text of criteria.unchecked.slice(0, 5)) {
    log(`    - [ ] ${text}`);
  }

  if (criteria.unchecked.length > 5) {
    log(`    - … and ${criteria.unchecked.length - 5} more`);
  }

  if (evidence.contrary && evidence.contrary.enforced) {
    log("  The commands passed, but this project is strict: open criteria block the verdict.");
    return;
  }

  log("  The commands passed. These are the story's own claims, unproven either way —");
  log("  this changes no verdict and blocks nothing.");
}

function printContraryFailures(contrary) {
  for (const failure of contrary.failures) {
    log(`  ${failure.detail}`);
  }

  if (contrary.failures.some((failure) => failure.signal === "deleted-tests")) {
    log("  Restore the test, or name the deleted file in a '## Test Exemption' section with the reason.");
  }
}

// "3 deleted test files, 5 open criteria" — what a passing run still carries.
function describeContraryWarnings(contrary) {
  const w = contrary && contrary.warnings;
  const parts = [];

  if (w && w.deletedTests.length > 0) {
    parts.push(`${w.deletedTests.length} deleted test file${w.deletedTests.length === 1 ? "" : "s"}`);
  }

  if (w && w.openCriteria.length > 0) {
    parts.push(`${w.openCriteria.length} open criteri${w.openCriteria.length === 1 ? "on" : "a"}`);
  }

  if (w && w.assertionsRemoved && w.assertionsRemoved.length > 0) {
    parts.push(`assertions removed in ${w.assertionsRemoved.length} test file${w.assertionsRemoved.length === 1 ? "" : "s"}`);
  }

  return parts.join(", ");
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

