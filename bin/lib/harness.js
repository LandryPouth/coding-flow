"use strict";

// Security harness: policy (.coding-flow/harness.json), scan of secrets and
// sensitive files, per-story preflight/evidence. The config primitives live in
// harness-config.js, a leaf copyTemplates (templates.js) can require.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const { cwd } = require("./context");
const { readConfig } = require("./config");
const { policyFingerprint } = require("./policy-fingerprint");
const { captureIdentity, currentTreeToken } = require("./identity");
const { currentBranch } = require("./policy");
const { describeScope } = require("./diff-base");
const {
  loadCoverageReports,
  reportCandidates,
  packageOfFile,
  measurePatchCoverage,
  coverageTier,
  tierRank,
  resolveCoverageFloor,
} = require("./coverage");
const {
  readStoryPart,
  storyPartPath,
  resolveProjectPath,
  readStoryBundle,
  extractSection,
} = require("./story");
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
  writeTimestampedEvidence,
  addIssue,
  matchesPattern,
  walkProjectFiles,
  selectFailureLines,
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
  runGitList,
  getChangedFiles,
  isScopedOut,
  filterScopedFiles,
  changedFilesForCoverage,
  runGitText,
  changedLinesForCoverage,
  parseChangedText,
  deletedFilesInDiff,
} = require("./diff-scope");
const {
  scoreStoryRisk,
  scoreDiffRisk,
  combineRisk,
  scoreCombinedRisk,
} = require("./risk");

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

function resolveStoryDir(story) {
  if (!story) {
    return null;
  }

  const resolved = resolveProjectPath(story);

  if (!resolved || !resolved.insideRoot || !resolved.exists) {
    return null;
  }

  return fs.statSync(resolved.fullPath).isDirectory()
    ? resolved.fullPath
    : path.dirname(resolved.fullPath);
}

// Extracts the command lines under "## Commands": the lines of a fenced block, plus
// labelled bullets (`- Command: `x``) because a model reading "a block" often writes
// that instead, and verify must not silently find zero commands because of it.
function parseTestsCommands(testsMarkdown) {
  const lines = testsMarkdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === "## commands");

  if (start === -1) {
    return [];
  }

  const commands = [];
  let inFence = false;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("## ")) {
      break;
    }

    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence && trimmed && !trimmed.startsWith("#")) {
      commands.push(trimmed);
    } else if (!inFence) {
      const bullet = trimmed.match(/^[-*]\s+command:\s*`([^`]+)`/i);

      if (bullet) {
        commands.push(bullet[1].trim());
      }
    }
  }

  return commands;
}

// Source of the commands, by decreasing priority: explicit config, then the
// story's plan.md contract, then the usual package.json scripts.
function resolveValidationCommands({ storyDir = null, fresh = false } = {}) {
  const config = readConfig(cwd);

  if (config.validation) {
    // Correctness (`commands`) and deterministic quality (`quality`) both flow
    // through the same executed-and-captured proof; a red quality command blocks
    // exactly like a red test. Tests run first, then quality.
    // `fresh`: the story's risk asks for tests that really ran, so the project's
    // cache-bypassing commands stand in for the usual ones when it declared any.
    const freshCommands = Array.isArray(config.validation.freshCommands) ? config.validation.freshCommands : [];
    const entries = (value) => (Array.isArray(value) ? value : []);
    const quality = entries(config.validation.quality);
    const declared = [
      ...(fresh && freshCommands.length > 0 ? freshCommands : entries(config.validation.commands)),
      ...quality,
    ];

    if (declared.length > 0) {
      // Entries are strings or `{ command, timeoutMs }`; everything downstream
      // keeps seeing command strings, and the limits travel beside them.
      const globalTimeout = Number.isFinite(config.validation.timeoutMs) ? config.validation.timeoutMs : null;
      // Keyed by command string: one limit per distinct command, the last declared wins.
      const timeouts = {};
      const commandOf = (entry) => {
        const command = typeof entry === "string" ? entry : entry.command;
        const timeoutMs = typeof entry === "string" ? globalTimeout : entry.timeoutMs || globalTimeout;

        if (timeoutMs) {
          timeouts[command] = timeoutMs;
        }

        return command;
      };

      // `quality` is returned so a cached lint is not refused as stale tests.
      return {
        source: "config",
        commands: declared.map(commandOf),
        quality: quality.map(commandOf),
        timeouts,
      };
    }
  }

  if (storyDir) {
    // The "plan" role: plan.md, or story.md for a single-file story.
    const planContent = readStoryPart(storyDir, "plan");

    if (planContent) {
      const commands = parseTestsCommands(planContent);

      if (commands.length > 0) {
        return { source: "plan.md", commands };
      }
    }
  }

  const pkg = readJson(path.join(cwd, "package.json"), null);

  if (pkg && pkg.scripts && typeof pkg.scripts === "object") {
    // Correctness first, then deterministic quality (lint/format). These are the
    // conventional script names; a project with other tools declares them in
    // config.validation.quality instead.
    const commands = ["typecheck", "type-check", "lint", "test", "format:check", "format-check"]
      .filter((name) => pkg.scripts[name])
      .map((name) => `npm run ${name}`);

    if (commands.length > 0) {
      return { source: "package.json", commands };
    }
  }

  return { source: null, commands: [] };
}

// A test suite that prints a lot is not a failing test suite. At 10 MB Node kills
// the child with SIGTERM and returns ENOBUFS with status null, which this function
// used to fold into `exit 127` — a green suite reported red, an evidence written,
// and the story marked blocked in the ledger. `turbo test` over a monorepo with
// jsdom clears 10 MB without trying.
//
// Two changes: a much larger buffer, and — when it still overflows — an explicit
// tool failure instead of a fabricated exit code. We only ever keep the last 4 KB
// of each stream, so the buffer exists purely to let the child finish.
// Overridable so a project with an unusually loud suite can raise it without a
// release — and so the overflow path itself is testable without generating a
// quarter of a gigabyte of output.
function outputBufferBytes() {
  const override = Number.parseInt(process.env.CODING_FLOW_MAX_OUTPUT_BYTES || "", 10);
  return Number.isFinite(override) && override > 0 ? override : 256 * 1024 * 1024;
}

// Did this command run, or did a build tool replay a previous run? Read from the
// WHOLE output (the stored tail may have lost the summary). turbo and nx only;
// anything else is "unknown". `cached`/`total` are present when the summary
// gave counts.
function detectCacheState(output) {
  const text = String(output || "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

  const turbo = [...text.matchAll(/Cached:\s+(\d+)\s+cached,\s+(\d+)\s+total/g)].pop();
  if (turbo) {
    const cached = Number(turbo[1]);
    const total = Number(turbo[2]);
    const state = cached === 0 ? "none" : cached >= total ? "full" : "partial";
    return { cache: state, cached, total };
  }

  if (/>>>\s*FULL TURBO/.test(text)) {
    return { cache: "full" };
  }

  const nx = [...text.matchAll(/read the output from the cache instead of running the command for (\d+) out of (\d+) tasks/g)].pop();
  if (nx) {
    const cached = Number(nx[1]);
    const total = Number(nx[2]);
    return { cache: cached >= total ? "full" : "partial", cached, total };
  }

  if (/Nx read the output from the cache|\[existing outputs match the cache|\[local cache\]/.test(text)) {
    return { cache: "partial" };
  }

  return { cache: "unknown" };
}

const DEFAULT_COMMAND_TIMEOUT_MS = 600000;

// Variables a clean-env run drops, by NAME only: the values are never read or recorded.
const SECRET_ENV_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY)/i;

// The child environment with credential-looking variables removed. PATH, HOME and
// CI always stay; anything else (NODE_*, npm_*, the rest) stays unless its name
// looks like a credential — NODE_AUTH_TOKEN is a secret whatever its prefix.
function cleanEnvironment(source = process.env) {
  const env = {};
  const dropped = [];

  for (const [name, value] of Object.entries(source)) {
    if (["PATH", "HOME", "CI"].includes(name) || !SECRET_ENV_NAME.test(name)) {
      env[name] = value;
    } else {
      dropped.push(name);
    }
  }

  return { env, dropped: dropped.sort() };
}

// Nobody is watching: no terminal on both ends, or a CI runner. Agents run with
// no TTY, which is the point. AI_FLOW_FORCE_TTY=1 exists for tests only, so it is
// honoured under NODE_ENV=test alone: an agent cannot use it to skip the refusal.
function isUnattended() {
  const ci = (process.env.CI || "").toLowerCase();

  if (!["", "0", "false"].includes(ci)) {
    return true;
  }

  if (process.env.NODE_ENV === "test" && process.env.AI_FLOW_FORCE_TTY === "1") {
    return false;
  }

  return !(process.stdin.isTTY && process.stdout.isTTY);
}

function runValidationCommand(command, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, env } = {}) {
  const maxOutputBytes = outputBufferBytes();
  const started = Date.now();
  const result = spawnSync(command, [], {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes,
    ...(env ? { env } : {}),
  });

  const cap = 4000;
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
  const overflowed = Boolean(result.error && result.error.code === "ENOBUFS");
  const exitCode = result.status != null ? result.status : timedOut ? 124 : result.error ? 127 : 1;

  // `toolError` says "the harness could not observe this command", which is not
  // the same claim as "this command failed". Both block a verify — an unobserved
  // command proves nothing — but only one of them means the code is broken, and
  // the report must not confuse the two.
  const toolError = overflowed
    ? `output exceeded ${Math.round(maxOutputBytes / (1024 * 1024))} MB and could not be captured; ` +
      "the command's real exit code is unknown"
    : !timedOut && result.error && result.status == null
      ? `could not be executed (${result.error.code || result.error.message})`
      : null;

  const ok = !toolError && exitCode === 0;

  return {
    command,
    exitCode: toolError ? null : exitCode,
    ok,
    timedOut,
    ...(timedOut ? { timeoutMs } : {}),
    toolError,
    durationMs: Date.now() - started,
    ...detectCacheState(`${result.stdout || ""}\n${result.stderr || ""}`),
    stdoutTail: (result.stdout || "").slice(-cap),
    stderrTail: (result.stderr || "").slice(-cap),
    // Selected from the WHOLE output, which only exists here: by the time anyone
    // reads the evidence file, all that survives is the 4 KB tail above, and a
    // verbose runner pushes the failure out of it long before the end. Recorded
    // only on a failure — a green run has nothing to name, and the evidence
    // ledger is append-only.
    ...(ok ? {} : { failureLines: selectFailureLines(`${result.stdout || ""}\n${result.stderr || ""}`) }),
  };
}

// The limit one command runs under, when the project declared one.
function commandTimeout(resolution, command) {
  const timeoutMs = resolution.timeouts && resolution.timeouts[command];

  return timeoutMs ? { timeoutMs } : {};
}

function resultStatus(item) {
  if (item.ok) {
    return "ok";
  }

  if (item.toolError) {
    return "tool error";
  }

  return item.timedOut ? "timeout" : `exit ${item.exitCode}`;
}

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

// Reproducibility fingerprint: a green verify is only auditable if we know the
// toolchain it ran on. We record the Node runtime, the OS/arch, and the hash of
// the dependency lockfile (the first one found). Cheap, no new dependency, and it
// turns "green here" into "green on this exact environment" for the ledger.
function captureEnvironment() {
  const lockfiles = [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
  ];

  let lockfile = null;

  for (const name of lockfiles) {
    const lockPath = path.join(cwd, name);

    if (fs.existsSync(lockPath)) {
      try {
        const sha256 = crypto.createHash("sha256").update(fs.readFileSync(lockPath)).digest("hex");
        lockfile = { name, sha256 };
      } catch {
        lockfile = { name, sha256: null };
      }
      break;
    }
  }

  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    lockfile,
  };
}

// --- coverage gate: a green suite is not evidence that the change is covered --
//
// Executing the declared commands proves they ran and passed. It does NOT prove
// they prove anything about THIS story: a change that adds no test rides on a
// suite that was already green before it, and comes out `verified`. That is the
// gap between "the tests passed" and "the change is tested", and it is the whole
// reason a story can be shipped with a proof behind it and no coverage in it.
//
// So: on a medium/high-risk story, a green run whose diff touches behavior but no
// test is NOT ok. It is not a failure of the suite either — it is a proof that
// does not reach far enough, reported as its own thing.
//
// Deliberately narrow, because a gate that fires wrongly gets disabled:
// - low-risk stories never trip it (copy, styling — the QUICK path stays free);
// - a diff of docs/story/lockfile-only changes trips nothing (no behavior moved);
// - outside git, or with no visible diff, the gate cannot see and stays silent.

// An escape hatch that leaves a mark. Some real changes cannot carry a test (a
// config-only cutover, a vendor bump); refusing them outright would only teach
// people to turn the gate off globally. So the story may declare an exemption —
// and it is copied verbatim into the evidence, printed on the verify, and carried
// into the PR body. The machine cannot judge the reason; it can make sure the
// claim is permanent and visible instead of silent.
function readTestExemption(storyDir) {
  if (!storyDir) {
    return null;
  }

  const bundle = readStoryBundle(storyDir);
  const text = extractSection(Object.values(bundle).join("\n\n"), "Test Exemption");

  return text.trim() ? text.trim() : null;
}

// A story's acceptance criteria are its claims. `verify` proves that the
// commands ran and passed; it has never had anything to say about the claims,
// so a story can go green with every criterion unimplemented. This does not fix
// that — it makes it visible. No gate, no verdict, no new configuration: the
// unticked claims are printed next to the green checkmark, and the reader
// decides.
//
// Deliberately NOT a binding from a criterion to a named test. That binding
// would be written by the same agent that writes the code, so it could only
// ever raise what the tool asserts on the agent's own word. The tool can accept
// a declaration that lowers its claim (`## Test Exemption`); it must not accept
// one that raises it. See docs/design-decisions.md entry 9.
function readAcceptanceCriteria(storyDir) {
  if (!storyDir) {
    return null;
  }

  const section = extractSection(readStoryPart(storyDir, "spec"), "Acceptance Criteria");

  if (!section.trim()) {
    return null;
  }

  const items = [];

  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s*\[([ xX~])\]\s*(.+?)\s*$/);

    if (match) {
      items.push({ state: match[1] === "~" ? "deferred" : match[1] === " " ? "open" : "done", text: match[2] });
    }
  }

  // A criteria section written as prose rather than as a checklist is not a
  // defect to report — there is simply nothing countable in it.
  if (items.length === 0) {
    return null;
  }

  // A criterion is deferred on purpose when its line says `[~]` (the convention
  // `tasks.md` already uses) or when a `## Deferred Criteria` section names it.
  const named = deferredCriteriaNames(storyDir);
  const isDeferred = (item) =>
    item.state === "deferred" ||
    (item.state === "open" && named.some((name) => matchesDeferredName(name, normalizeCriterion(item.text))));

  return {
    total: items.length,
    unchecked: items.filter((item) => item.state !== "done" && !isDeferred(item)).map((item) => item.text),
    deferred: items.filter((item) => item.state !== "done" && isDeferred(item)).map((item) => item.text),
  };
}

// The criterion must appear in the deferred line (or equal it), never the other
// way round: a generic line such as "performance" must not defer every criterion
// that mentions it, and a one-word criterion must not hide inside any line.
function matchesDeferredName(name, criterion) {
  return name === criterion || (criterion.length >= 8 && name.includes(criterion));
}

function normalizeCriterion(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// The lines of a `## Deferred Criteria` section, normalised for matching. Too
// short a line is skipped: "a" would otherwise "name" every criterion.
function deferredCriteriaNames(storyDir) {
  const text = extractSection(Object.values(readStoryBundle(storyDir)).join("\n\n"), "Deferred Criteria");

  return text
    .split(/\r?\n/)
    .map((line) => normalizeCriterion(line.replace(/^\s*[-*]\s*(\[[ xX~]\]\s*)?/, "")))
    .filter((line) => line.length >= 8);
}

// The line-level verdict, or null when it cannot be established — in which case
// the caller keeps the test-file heuristic. Never guesses: a missing report, an
// unparseable one, or one written before this run all mean "no line-level
// answer", not "uncovered".
function evaluatePatchCoverage({ config, behaviorFiles, testFiles = [], startedAt }) {
  // `testFiles` here are the ones that count as proof: strengthened or neutral,
  // never weakened-only (see scanTestWeakening).
  // Freshness is per report: a package whose report predates the run is ignored
  // on its own, and the others still count. A months-old lcov quietly waving a
  // change through is the failure this guards against.
  const report = loadCoverageReports(cwd, {
    candidates: reportCandidates(cwd, config.coverageReports),
    since: startedAt,
  });

  if (!report) {
    return null;
  }

  const changedLines = changedLinesForCoverage();
  const scoped = {};

  for (const file of behaviorFiles) {
    if (changedLines[file]) {
      scoped[file] = changedLines[file];
    }
  }

  if (Object.keys(scoped).length === 0) {
    return null;
  }

  const measured = measurePatchCoverage({
    report,
    changedLinesByFile: scoped,
  });

  // A behaviour file outside every report's package falls back to the test-file
  // rule for ITS package; the run's rung is the weakest of the two parts.
  const unprovenUnmeasured = measured.unmeasured.filter((file) => {
    const pkg = packageOfFile(cwd, file);
    return !testFiles.some((test) => packageOfFile(cwd, test) === pkg);
  });

  // Nothing executable changed and nothing unmeasured (comments, formatting) —
  // no line-level claim to make, so defer to the heuristic rather than report a
  // vacuous 100%.
  if (measured.totalLines === 0 && measured.unmeasured.length === 0) {
    return null;
  }

  const min = Number.isFinite(config.minPatchCoverage) ? config.minPatchCoverage : 80;

  return {
    ...measured,
    min,
    ok: measured.totalLines === 0 ? true : measured.percent >= min,
    unprovenUnmeasured,
    report: {
      path: report.path,
      format: report.format,
      reports: report.reports,
    },
  };
}

// --- Weakened tests -------------------------------------------------------
//
// The `evidence` rung is earned when a behaviour file and a test file both appear
// in the diff. Until now the *direction* of the test change was never read, so the
// cheapest way past the gate was to touch a test — and deleting an assertion,
// adding `.skip`, or removing the file outright all count as touching one. That is
// a hole in the proof, not a missing feature, and an agent does not have to be
// adversarial to fall into it: "the test was failing, so I removed the assertion"
// is an ordinary move.
//
// These are regexes over a diff, not a parse. They cannot tell a weakened test
// from a legitimately refactored one, which is why the result never blocks on its
// own — it only withholds the `evidence` rung from a diff whose test changes are
// *exclusively* weakening, and reports what it saw at every other rung.

// `.only` is deliberately in this list. It does not skip the test it marks; it
// silently skips every other test in the file, which is worse and easier to spot.
const SKIP_MARKERS = [
  /\.skip\s*\(/,
  /\.only\s*\(/,
  /\b(?:xit|xdescribe|xtest|xcontext)\s*\(/,
  /\b(?:it|test|describe)\.todo\s*\(/,
  /@pytest\.mark\.skip/,
  /@unittest\.skip/,
  /#\[ignore\]/,
  /\bt\.Skip(?:Now)?\s*\(/,
  /@(?:Ignore|Disabled)\b/,
];

const ASSERTION_MARKERS = [
  /\bexpect\s*\(/,
  /\bassert(?:_\w+|[A-Z]\w*)?\s*[(.]/,
  /\bshould\b/,
  /\bXCTAssert\w*\s*\(/,
  /\b(?:EXPECT|ASSERT)_\w+\s*\(/,
  /\brequire\.\w+\s*\(/,
  /\bt\.(?:is|deepEqual|throws|truthy|falsy)\s*\(/,
];

const countMatching = (lines, patterns) =>
  lines.filter((line) => patterns.some((pattern) => pattern.test(line))).length;

// Per test file: did this diff make it stronger, weaker, or neither?
function scanTestWeakening(config) {
  const isTest = (file) => config.testGlobs.some((pattern) => matchesPattern(file, pattern));
  const byFile = {};
  const { mergeBase } = currentDiffBase(cwd);
  const diffs = [["diff", "--find-renames"], ["diff", "--find-renames", "--cached"]];

  if (mergeBase) {
    diffs.push(["diff", "--find-renames", mergeBase]);
  }

  for (const argsForGit of diffs) {
    for (const [file, change] of Object.entries(parseChangedText(runGitText(argsForGit)))) {
      if (!isTest(file) || isScopedOut(file, config)) {
        continue;
      }

      if (!byFile[file]) {
        byFile[file] = { added: [], removed: [] };
      }

      byFile[file].added.push(...change.added);
      byFile[file].removed.push(...change.removed);
    }
  }

  const findings = [];

  for (const file of deletedFilesInDiff()) {
    if (isTest(file)) {
      findings.push({ file, signal: "deleted", detail: "the test file was removed" });
      delete byFile[file];
    }
  }

  const strengthened = [];

  for (const [file, change] of Object.entries(byFile)) {
    const skipsAdded = countMatching(change.added, SKIP_MARKERS) - countMatching(change.removed, SKIP_MARKERS);
    const assertionDelta =
      countMatching(change.added, ASSERTION_MARKERS) - countMatching(change.removed, ASSERTION_MARKERS);

    if (skipsAdded > 0) {
      findings.push({
        file,
        signal: "skipped",
        detail: `${skipsAdded} skip/only marker(s) added`,
      });
    }

    if (assertionDelta < 0) {
      findings.push({
        file,
        signal: "assertions-removed",
        detail: `${Math.abs(assertionDelta)} more assertion(s) removed than added`,
      });
    }

    // Neutral counts as strengthened: renaming a test or fixing a typo is not a
    // weakening, and the gate is about direction, not about effort.
    if (skipsAdded <= 0 && assertionDelta >= 0) {
      strengthened.push(file);
    }
  }

  return { findings, strengthened, weakenedFiles: [...new Set(findings.map((f) => f.file))] };
}

// `ctx.riskLevel` is null until the risk is scored: a result returned before that
// point (coverage off, no diff) has no level, so no floor applies to it.
function evaluateCoverageResult({ storyDir, config, exemption = null, startedAt = null }, ctx = { riskLevel: null }) {
  const skip = (reason) => ({ required: false, ok: true, reason, changedFiles: [], testFiles: [] });

  if (!config.requireTestChange) {
    return skip("disabled by harness config (requireTestChange: false)");
  }

  if (!currentTreeToken(cwd)) {
    return skip("not a git repository; the diff cannot be read");
  }

  const changedFiles = changedFilesForCoverage();

  if (changedFiles.length === 0) {
    return skip("no diff visible against the base branch or the working tree");
  }

  // No story is not "no risk". The diff answers on its own, which is what makes
  // this usable on a branch that never adopted the epics/ layout.
  const storyRisk = storyDir
    ? scoreStoryRisk(Object.values(readStoryBundle(storyDir)).join("\n"), config)
    : { level: "low", matchedTerms: [], reason: "no story to read." };
  const risk = combineRisk(storyRisk, scoreDiffRisk(changedFiles, config));
  ctx.riskLevel = risk.level;

  if (risk.level === "low") {
    return skip(`risk is low (${risk.reason})`);
  }

  const testFiles = changedFiles.filter((file) =>
    config.testGlobs.some((pattern) => matchesPattern(file, pattern)),
  );
  const behaviorFiles = changedFiles.filter(
    (file) =>
      !config.nonBehaviorGlobs.some((pattern) => matchesPattern(file, pattern)) &&
      !testFiles.includes(file),
  );

  if (behaviorFiles.length === 0) {
    return {
      required: true,
      ok: true,
      mode: "none",
      reason: "no behavior file changed (docs, story, or lockfile only)",
      changedFiles,
      testFiles,
    };
  }

  // Read once and attach to every outcome below, including the green ones. A
  // measured 92% next to three deleted tests is a fact the reader needs; hiding
  // it because the number was good is the dishonesty the rungs exist to prevent.
  const weakening = scanTestWeakening(config);
  const withWeakening = (result) =>
    weakening.findings.length ? { ...result, weakenedTests: weakening.findings } : result;

  // Line-level proof when the suite produced a coverage report, the test-file
  // heuristic otherwise. The stronger measure always supersedes the weaker one:
  // "a test file moved" is a proxy for "the change is covered", and a proxy is
  // only worth using while the real thing is unavailable.
  const patch = evaluatePatchCoverage({ config, behaviorFiles, testFiles: weakening.strengthened, startedAt });

  if (patch) {
    const unmeasuredNote = patch.unmeasured.length
      ? `${patch.unmeasured.length} file(s) outside every coverage report are unmeasured: ` +
        patch.unmeasured.slice(0, 3).join(", ") +
        (patch.unmeasured.length > 3 ? ` (+${patch.unmeasured.length - 3} more)` : "")
      : "";

    if (patch.ok && patch.unprovenUnmeasured.length === 0) {
      // The weakest part decides the rung: with unmeasured files in the diff the
      // run is `evidence` (a test file moved in their package), never `verified`.
      if (patch.unmeasured.length > 0) {
        return {
          required: true,
          ok: true,
          mode: "test-file",
          reason:
            (patch.totalLines > 0
              ? `${patch.percent}% of the ${patch.totalLines} measured added line(s) are executed; `
              : "") + `${unmeasuredNote}, with a test file changed in their package`,
          riskSource: risk.source,
          changedFiles,
          testFiles,
          patch,
        };
      }

      return {
        required: true,
        ok: true,
        mode: "diff-lines",
        reason: `${patch.percent}% of the ${patch.totalLines} added line(s) are executed by the suite (min ${patch.min}%)`,
        riskSource: risk.source,
        changedFiles,
        testFiles,
        patch,
      };
    }

    const declaredForPatch = readTestExemption(storyDir) || (exemption && exemption.trim() ? exemption.trim() : null);

    if (declaredForPatch) {
      return {
        required: true,
        ok: true,
        mode: "diff-lines",
        reason: "declared test exemption",
        exemption: declaredForPatch,
        riskSource: risk.source,
        changedFiles,
        testFiles,
        patch,
      };
    }

    return {
      required: true,
      ok: false,
      mode: "diff-lines",
      reason: patch.ok
        ? `${unmeasuredNote}, and no test file changed in their package. ` +
          "No report reaches them; a green suite elsewhere proves nothing about them."
        : `only ${patch.percent}% of the ${patch.totalLines} added line(s) are executed by the suite ` +
          `(min ${patch.min}%). The suite ran; it did not reach this change.`,
      riskSource: risk.source,
      riskPaths: risk.matchedPaths,
      changedFiles,
      testFiles,
      behaviorFiles,
      patch,
    };
  }

  // The direction of the test change decides. A diff whose test files were only
  // weakened — assertions dropped, `.skip` added, the file deleted — has not shown
  // that anything covers this change, so it lands exactly where a diff with no test
  // change lands, and reaches the same exemption path. Neutral edits (a rename, a
  // typo) count as strengthening: this reads direction, not effort.
  if (weakening.strengthened.length > 0) {
    return withWeakening({
      required: true,
      ok: true,
      mode: "test-file",
      reason: `${weakening.strengthened.length} test file(s) strengthened alongside ${behaviorFiles.length} behavior file(s)`,
      riskSource: risk.source,
      changedFiles,
      testFiles,
    });
  }

  if (testFiles.length > 0 && weakening.findings.length === 0) {
    return withWeakening({
      required: true,
      ok: true,
      mode: "test-file",
      reason: `${testFiles.length} test file(s) changed alongside ${behaviorFiles.length} behavior file(s)`,
      riskSource: risk.source,
      changedFiles,
      testFiles,
    });
  }

  // Two ways to declare the same thing: a section in the story (the normal path)
  // or `--test-exemption` on the command (the path for work with no story). Both
  // end up recorded verbatim in the evidence — that is the whole point.
  const declared = readTestExemption(storyDir) || (exemption && exemption.trim() ? exemption.trim() : null);

  if (declared) {
    return withWeakening({
      required: true,
      ok: true,
      mode: "test-file",
      reason: "declared test exemption",
      exemption: declared,
      riskSource: risk.source,
      changedFiles,
      testFiles,
      behaviorFiles,
    });
  }

  return withWeakening({
    required: true,
    ok: false,
    mode: "test-file",
    reason: weakening.findings.length
      ? `${behaviorFiles.length} behavior file(s) changed and every test file in the diff was ` +
        "weakened. Touching a test is not the same as covering a change."
      : `${behaviorFiles.length} behavior file(s) changed and no test file did. A green suite ` +
        "that was already green proves nothing about this change.",
    riskSource: risk.source,
    riskPaths: risk.matchedPaths,
    changedFiles,
    testFiles,
    behaviorFiles,
  });
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

// The verdict, plus the name of the rung it landed on. Stamped in one place so
// no return path can forget it, and so `mode` stays what it has always been —
// how the answer was obtained — while `tier` says how strong the answer is.
function evaluateCoverage(options) {
  const ctx = { riskLevel: null };
  const result = evaluateCoverageResult(options, ctx);
  const floored = applyCoverageFloor(result, ctx.riskLevel, options.config);

  // A run held back by its floor keeps the rung it reached; `ok: false` and
  // `floor` say it is not enough.
  return { ...floored, tier: floored.floor ? floored.floor.reached : coverageTier(floored) };
}

// A run can pass its checks and still sit below the rung this project asks of
// its risk level. Only a measured-or-proxy pass is judged: an exemption is a
// written reason and satisfies any floor, and "not-required" never reached the
// bar to begin with. The reached rung is kept; only `ok` and the reason change.
function applyCoverageFloor(result, riskLevel, config) {
  if (!result.required || !result.ok || result.exemption || !riskLevel) {
    return result;
  }

  const reached = coverageTier(result);
  const required = resolveCoverageFloor(config)[riskLevel];

  if (reached === "not-required" || tierRank(reached) >= tierRank(required)) {
    return result;
  }

  return {
    ...result,
    ok: false,
    floor: { required, reached },
    reason:
      `coverage reached '${reached}' but ${riskLevel} risk requires '${required}' ` +
      `(coverageFloor.${riskLevel}). ${result.reason}`,
  };
}

// Executes the declared validation commands for one story and returns the
// evidence. Pure: it runs the commands and captures their results verbatim but
// writes nothing — the caller decides whether to persist it (writeVerifyEvidence)
// and what a red result means for its own flow. Shared by `harness verify` (a
// single story) and `run` (a batch), so both produce identical evidence.
//
// `skipCoverage`: for callers with no single story to attribute the change to
// (`worktree land`'s post-merge re-verify, story: null). The coverage gate reads
// the diff from the default branch to HEAD — for a re-verify run *after* a merge
// onto a long-lived epic branch, that is every story's accumulated diff since
// main, not just the one that was just landed, and `readTestExemption` cannot
// find a story-scoped exemption a landed story already earned. Judging the
// combined result on the commands it actually declares, not on a heuristic
// scoped to the wrong diff, is what "the same source `ai-flow verify` reads"
// (spec.md) means here — coverage stays a per-story concern.
// True when harness.json `freshTestsFor` lists this story's risk level. Risk is
// scored the way the coverage gate scores it: the story text and the diff.
function freshTestsRequired({ storyDir, config }) {
  if (!Array.isArray(config.freshTestsFor) || config.freshTestsFor.length === 0) {
    return false;
  }

  return config.freshTestsFor.includes(scoreCombinedRisk({ storyDir, config }).level);
}

// Signals that contradict a green verdict: tests deleted from the diff, and
// acceptance criteria the story itself still lists as open. Always collected;
// they only change `ok` where the project asked for strictness — `mode: strict`,
// or a high-risk story with `failOnContrarySignals: true`. Elsewhere they are
// warnings, so a project that never opted in sees a different summary line and
// the same verdict.
//
// `assertions-removed` is a warning even when enforced: refactors move
// assertions, and the detector is a regex over a diff.
//
// A written reason lowers the claim and is accepted: a deleted test file is
// excused by a Test Exemption that names it, an open criterion by `[~]` or a
// `## Deferred Criteria` section. Nothing here raises what the tool asserts.
const NO_CONTRARY = Object.freeze({
  enforced: false,
  ok: true,
  failures: Object.freeze([]),
  warnings: Object.freeze({ deletedTests: Object.freeze([]), openCriteria: Object.freeze([]), assertionsRemoved: Object.freeze([]) }),
});

// What the verdict depends on besides the tree: the mode, the flag, and the risk
// inputs that decide whether "high" applies. `.coding-flow/` is outside the tree
// token, so an edit to any of them must change this key to re-run a proof.
function contraryPolicy(config) {
  return {
    strict: config.mode === "strict",
    failOnContrarySignals: config.failOnContrarySignals === true,
    riskTerms: config.highRiskTerms || null,
    riskPaths: config.highRiskPaths || null,
  };
}

// `text` names `target` when it appears as a whole path token: `index.test.ts`
// is not named by `reindex.test.ts`, and `a.test.ts` is not inside `data.test.ts`.
function mentionsPath(text, target) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`(^|[^\\w./-])${escaped}($|[^\\w-]|\\.(?!\\w))`).test(text);
}

function evaluateContrarySignals({ storyDir, config, exemption = null, criteria = null }) {
  const policy = contraryPolicy(config);
  const weakening = currentTreeToken(cwd) ? scanTestWeakening(config) : { findings: [] };
  const declared = [readTestExemption(storyDir), exemption && exemption.trim()].filter(Boolean).join("\n");
  const deletedFiles = weakening.findings.filter((finding) => finding.signal === "deleted").map((finding) => finding.file);
  const excused = (file) => {
    const base = path.posix.basename(file);
    // The full path always counts. A bare file name counts only when no other
    // deleted file shares it, so "index.test.ts" cannot excuse three of them.
    const uniqueBase = deletedFiles.filter((other) => path.posix.basename(other) === base).length === 1;

    return mentionsPath(declared, file) || (uniqueBase && mentionsPath(declared, base));
  };
  const deletedTests = deletedFiles.filter((file) => !excused(file));
  const assertionsRemoved = weakening.findings
    .filter((finding) => finding.signal === "assertions-removed")
    .map((finding) => finding.file);
  const openCriteria = criteria ? criteria.unchecked : [];

  if (deletedTests.length === 0 && openCriteria.length === 0 && assertionsRemoved.length === 0) {
    return NO_CONTRARY;
  }

  const enforced = policy.strict || (policy.failOnContrarySignals && scoreCombinedRisk({ storyDir, config }).level === "high");
  const failures = [];

  if (enforced && deletedTests.length > 0) {
    failures.push({
      signal: "deleted-tests",
      detail: `${deletedTests.length} test file(s) deleted, and no Test Exemption names them: ${deletedTests.slice(0, 5).join(", ")}`,
      items: deletedTests,
    });
  }

  if (enforced && openCriteria.length > 0) {
    failures.push({
      signal: "open-criteria",
      detail:
        `${openCriteria.length} acceptance criterion(a) still open: ${openCriteria.slice(0, 5).join("; ")}` +
        `${openCriteria.length > 5 ? "; …" : ""}. Mark each [x], defer it with [~] or a '## Deferred Criteria' section`,
      items: openCriteria,
    });
  }

  return { enforced, ok: failures.length === 0, failures, warnings: { deletedTests, openCriteria, assertionsRemoved } };
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

