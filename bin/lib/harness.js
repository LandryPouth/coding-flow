"use strict";

// Harnais de securite : politique (.coding-flow/harness.json), scan de secrets et
// fichiers sensibles, preflight/evidence par story. Les primitives de config sont
// ici aussi car copyTemplates (templates.js) doit pouvoir creer la config.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const {
  fail,
  log,
  normalizePortable,
  readJson,
  writeJson,
  addIssue,
  matchesPattern,
  isAllowedEnvExample,
  readTextFileSafely,
  walkProjectFiles,
} = require("./util");

function harnessConfigPath() {
  return path.join(cwd, ".coding-flow", "harness.json");
}

function harnessRunsDir() {
  return path.join(cwd, ".coding-flow", "runs");
}

function defaultHarnessConfig() {
  return {
    version: 1,
    mode: "standard",
    blockedPaths: [
      ".env",
      ".env.*",
      ".ssh/**",
      "**/id_rsa",
      "**/id_ed25519",
      "**/*.pem",
      "**/*.key",
      "node_modules/**",
    ],
    sensitiveGlobs: [
      "**/.env*",
      "**/*secret*",
      "**/*credential*",
      "**/*private-key*",
      "**/*service-account*",
    ],
    requiredChecks: [
      "secrets",
      "sensitive-files",
      "story-evidence",
      "rollback",
    ],
    highRiskTerms: [
      "auth",
      "authorization",
      "permission",
      "role",
      "admin",
      "payment",
      "stripe",
      "secret",
      "token",
      "password",
      "upload",
      "migration",
      "database",
      "sensitive",
      "private data",
      "external api",
      "webhook",
    ],
  };
}

function readHarnessConfig() {
  const defaults = defaultHarnessConfig();
  const config = readJson(harnessConfigPath(), null);

  if (!config) {
    return { config: defaults, exists: false };
  }

  return {
    exists: true,
    config: {
      ...defaults,
      ...config,
      blockedPaths: Array.isArray(config.blockedPaths) ? config.blockedPaths : defaults.blockedPaths,
      sensitiveGlobs: Array.isArray(config.sensitiveGlobs) ? config.sensitiveGlobs : defaults.sensitiveGlobs,
      requiredChecks: Array.isArray(config.requiredChecks) ? config.requiredChecks : defaults.requiredChecks,
      highRiskTerms: Array.isArray(config.highRiskTerms) ? config.highRiskTerms : defaults.highRiskTerms,
    },
  };
}

function ensureHarnessConfig({ dryRun = false } = {}) {
  if (fs.existsSync(harnessConfigPath())) {
    return false;
  }

  if (!dryRun) {
    writeJson(harnessConfigPath(), defaultHarnessConfig());
    fs.mkdirSync(harnessRunsDir(), { recursive: true });
  }

  return true;
}

function getSecretPatterns() {
  return [
    { name: "Stripe live key", regex: /\bsk_live_[A-Za-z0-9_]{12,}\b/ },
    { name: "OpenAI-style API key", regex: /\bsk-[A-Za-z0-9_-]{32,}\b/ },
    { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
    { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: "Private key block", regex: /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
    {
      name: "Long assigned credential",
      regex: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"']{20,}["']/i,
    },
  ];
}

function checkSensitivePaths(files, config, report) {
  for (const filePath of files) {
    const relativePath = normalizePortable(path.relative(cwd, filePath));

    if (isAllowedEnvExample(relativePath)) {
      continue;
    }

    if (config.blockedPaths.some((pattern) => matchesPattern(relativePath, pattern))) {
      addIssue(
        report.errors,
        "blocked_path_present",
        `${relativePath} matches a blocked harness path`,
        relativePath,
      );
      continue;
    }

    if (config.sensitiveGlobs.some((pattern) => matchesPattern(relativePath, pattern))) {
      addIssue(
        report.warnings,
        "sensitive_path_present",
        `${relativePath} looks sensitive; keep it out of commits unless it is a safe example`,
        relativePath,
      );
    }
  }
}

function checkSecrets(files, report) {
  const patterns = getSecretPatterns();

  for (const filePath of files) {
    const relativePath = normalizePortable(path.relative(cwd, filePath));
    const content = readTextFileSafely(filePath);

    if (content === null) {
      continue;
    }

    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const match = patterns.find((pattern) => pattern.regex.test(line));

      if (match) {
        addIssue(
          report.errors,
          "secret_candidate",
          `Potential secret detected by pattern: ${match.name}`,
          relativePath,
          index + 1,
        );
      }
    }
  }
}

function checkEnvGitignore(report, { strict = false } = {}) {
  const gitignorePath = path.join(cwd, ".gitignore");

  if (!fs.existsSync(gitignorePath)) {
    addIssue(
      strict ? report.errors : report.warnings,
      "missing_gitignore",
      ".gitignore is missing; add .env and local secret files before committing real project code",
      ".gitignore",
    );
    return;
  }

  const content = fs.readFileSync(gitignorePath, "utf8");
  const ignoresEnv = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === ".env" || line === ".env*" || line === ".env.*");

  if (!ignoresEnv) {
    addIssue(
      strict ? report.errors : report.warnings,
      "env_not_ignored",
      ".gitignore does not explicitly ignore .env files",
      ".gitignore",
    );
  }
}

function resolveProjectPath(relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) {
    return null;
  }

  const fullPath = path.resolve(cwd, relativeOrAbsolutePath);
  const relativePath = path.relative(cwd, fullPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return {
      fullPath,
      relativePath: normalizePortable(relativePath),
      insideRoot: false,
      exists: false,
    };
  }

  return {
    fullPath,
    relativePath: normalizePortable(relativePath),
    insideRoot: true,
    exists: fs.existsSync(fullPath),
  };
}

function readStoryBundle(storyFullPath) {
  const files = {};

  for (const name of ["story.md", "tasks.md", "tests.md", "decisions.md", "implementation-notes.md"]) {
    const filePath = path.join(storyFullPath, name);
    files[name] = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  }

  return files;
}

function scoreStoryRisk(storyText, config) {
  const lower = storyText.toLowerCase();
  const matchedTerms = config.highRiskTerms.filter((term) => lower.includes(term.toLowerCase()));
  const mediumTerms = ["api", "crud", "form", "persistence", "integration", "config", "settings"]
    .filter((term) => lower.includes(term));

  if (matchedTerms.length > 0) {
    return {
      level: "high",
      matchedTerms,
      reason: "Security-sensitive or trust-boundary terms were found.",
    };
  }

  if (mediumTerms.length > 0) {
    return {
      level: "medium",
      matchedTerms: mediumTerms,
      reason: "Integration or persistence terms were found.",
    };
  }

  return {
    level: "low",
    matchedTerms: [],
    reason: "No high-risk terms found.",
  };
}

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

  const risk = scoreStoryRisk(storyText, config);
  const mode = risk.level === "high" ? "strict" : risk.level === "medium" ? "standard" : "fast";
  const requiredChecks = [...config.requiredChecks];

  if (risk.level === "high") {
    requiredChecks.push("security-check", "server-side-validation", "rollback-evidence");
  }

  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
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

  if (!bundle["story.md"].trim()) {
    addIssue(report.errors, "missing_story_file", "story.md is required for story-scoped harness checks", `${relativeStoryDir}/story.md`);
  }

  const notes = bundle["implementation-notes.md"];
  const notesPath = `${relativeStoryDir}/implementation-notes.md`;
  const highAssurance = strict || report.config.mode === "strict" || risk.level === "high";

  if (highAssurance && !notes.trim()) {
    addIssue(report.errors, "missing_implementation_notes", "High-assurance story checks require implementation-notes.md", notesPath);
    return;
  }

  if (notes.trim() && !/rollback/i.test(notes)) {
    addIssue(
      highAssurance ? report.errors : report.warnings,
      "missing_rollback_notes",
      "implementation-notes.md should include rollback notes",
      notesPath,
    );
  }

  if (risk.level === "high" && notes.trim() && !/(security|auth|permission|trust boundary|server-side)/i.test(notes)) {
    addIssue(
      report.warnings,
      "missing_security_evidence",
      "High-risk story notes should mention the security validation performed",
      notesPath,
    );
  }

  if (risk.level === "high" && !bundle["tests.md"].trim()) {
    addIssue(
      report.warnings,
      "missing_tests_plan",
      "High-risk stories should keep tests.md up to date",
      `${relativeStoryDir}/tests.md`,
    );
  }
}

function collectHarnessReport({ quick = false, strict = false, story = null } = {}) {
  const { config, exists } = readHarnessConfig();
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    root: cwd,
    configPath: normalizePortable(path.relative(cwd, harnessConfigPath())),
    configExists: exists,
    mode: config.mode,
    quick,
    strict,
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

  const files = walkProjectFiles(cwd, { quick });
  report.stats.filesScanned = files.length;

  checkSensitivePaths(files, config, report);
  checkSecrets(files, report);
  checkEnvGitignore(report, { strict });
  checkStoryEvidence(report, { story, strict });

  report.ok = report.errors.length === 0;
  return report;
}

function runGitList(argsForGit) {
  try {
    const childProcess = require("child_process");
    return childProcess
      .execFileSync("git", argsForGit, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getChangedFiles() {
  return [...new Set([
    ...runGitList(["diff", "--name-only"]),
    ...runGitList(["diff", "--cached", "--name-only"]),
  ])].sort();
}

function extractSection(content, heading) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);

  if (start === -1) {
    return "";
  }

  const section = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      break;
    }

    section.push(lines[index]);
  }

  return section.join("\n").trim();
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
      const notesPath = path.join(storyDir, "implementation-notes.md");

      if (fs.existsSync(notesPath)) {
        rollbackNotes = extractSection(fs.readFileSync(notesPath, "utf8"), "Rollback Notes");
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
    story: preflight.story,
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

function harnessCheck({ json = false, quick = false, strict = false, story = null } = {}) {
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

function harnessCommand({ commandArgs, getFlagValue, flags }) {
  const subcommand = commandArgs[0] || "check";
  const story = getFlagValue("--story", null);

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
    });
  } else if (subcommand === "preflight") {
    harnessPreflight({
      json: flags.has("--json"),
      story,
    });
  } else if (subcommand === "evidence") {
    harnessEvidence({
      json: flags.has("--json"),
      dryRun: flags.has("--dry-run"),
      story,
    });
  } else {
    fail(`unknown harness command "${subcommand}". Use init, preflight, check, or evidence.`);
  }
}

module.exports = {
  harnessConfigPath,
  harnessRunsDir,
  defaultHarnessConfig,
  readHarnessConfig,
  ensureHarnessConfig,
  collectHarnessReport,
  harnessCommand,
};
