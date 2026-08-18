"use strict";

// Security harness: policy (.coding-flow/harness.json), scan of secrets and
// sensitive files, per-story preflight/evidence. The config primitives live here
// too because copyTemplates (templates.js) must be able to create the config.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const { cwd } = require("./context");
const { readConfig } = require("./config");
const { captureIdentity, currentTreeToken } = require("./identity");
const { defaultBranch, currentBranch } = require("./policy");
const {
  loadCoverageReport,
  measurePatchCoverage,
  coverageTier,
  DEFAULT_REPORT_PATHS,
} = require("./coverage");
const { PART_FILES, readStoryPart, storyPartPath } = require("./story");
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

// Secret detectors, serialized as strings so a project can read, edit, extend, or
// delete them in .coding-flow/harness.json — the policy has to be inspectable to
// be trusted, and a hard-coded regex is neither.
//
// `precision` is the load-bearing field. An "exact" pattern matches a real
// credential FORMAT (a Stripe live key looks like nothing else), so it applies
// everywhere, always — no allowlist relaxes it. A "heuristic" pattern matches a
// SHAPE (`password: "…"`), which is exactly what documentation, fixtures, and
// story files legitimately contain; those are the ones `secretScanAllowlist`
// switches off, per path. Without the split, the only two options are a scanner
// that blocks every example in the docs or one that stops looking for AWS keys in
// test files. Both are wrong.
function defaultSecretPatterns() {
  return [
    { name: "Stripe live key", pattern: "\\bsk_live_[A-Za-z0-9_]{12,}\\b", precision: "exact" },
    { name: "OpenAI-style API key", pattern: "\\bsk-[A-Za-z0-9_-]{32,}\\b", precision: "exact" },
    { name: "GitHub token", pattern: "\\bgh[pousr]_[A-Za-z0-9_]{20,}\\b", precision: "exact" },
    { name: "AWS access key", pattern: "\\bAKIA[0-9A-Z]{16}\\b", precision: "exact" },
    {
      name: "Private key block",
      pattern: "-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----",
      precision: "exact",
    },
    {
      name: "Long assigned credential",
      pattern: "\\b(api[_-]?key|secret|token|password)\\b\\s*[:=]\\s*[\"'][^\"']{20,}[\"']",
      flags: "i",
      precision: "heuristic",
    },
  ];
}

// Where a placeholder credential is the normal, correct thing to write. Only the
// heuristic patterns are skipped here; a real key format still blocks.
function defaultSecretScanAllowlist() {
  return [
    "docs/**",
    "epics/**",
    "**/*.md",
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/test/**",
    "**/tests/**",
    "**/fixtures/**",
    "**/*.example.*",
    "**/*.sample.*",
    "**/*.template.*",
  ];
}

// What counts as a test file for the coverage gate (see verifyStoryOnce). Broad
// on purpose across ecosystems; a project with another convention overrides it.
function defaultTestGlobs() {
  return [
    "**/*.test.*",
    "**/*.spec.*",
    "**/*_test.*",
    "**/test_*.py",
    "**/*Test.java",
    "**/*Tests.cs",
    "**/__tests__/**",
    "**/test/**",
    "**/tests/**",
    "**/spec/**",
    "**/e2e/**",
    "**/cypress/**",
    "**/*.feature",
  ];
}

// Paths whose contents ARE the risk, whatever the story says about them. The
// list mirrors the four STRICT triggers the run skill states: an authorization
// decision, a persistence schema, a payment or secret path, a new
// externally-reachable boundary.
//
// This exists because story text is written by the agent, and a risk score read
// only from that text is a score the agent controls: describe an auth change as
// "update the login page" and every gate keyed on risk quietly stands down. A
// path is not a claim, it is a fact about the diff.
function defaultHighRiskPaths() {
  return [
    "**/auth/**",
    "**/*auth.*",
    "**/*authoriz*",
    "**/*permission*",
    "**/*session*",
    "**/*rbac*",
    "**/*acl.*",
    "**/policies/**",
    "**/*policy.*",
    "**/middleware.*",
    "**/migrations/**",
    "**/migrate/**",
    "**/*.sql",
    "**/schema.prisma",
    "**/*.schema.*",
    "**/payments/**",
    "**/*payment*",
    "**/billing/**",
    "**/*stripe*",
    "**/*checkout*",
    "**/*credential*",
    "**/*secret*",
    "**/webhooks/**",
    "**/*webhook*",
  ];
}

// Changes that cannot be covered by a test because they are not behavior:
// documentation, the story files themselves, and the evidence directory. A story
// that only touches these never trips the coverage gate.
// Files that carry no executable behavior of their own. Excluding them is not a
// weakening of the gate — it is what keeps the gate believable. A change that
// only adds a type declaration or a build config CANNOT be executed by a test
// suite, so demanding coverage for it produces a block the developer can only
// clear by lying (a fake test) or by turning the tool off. Every entry below is
// a case where "not covered" carries no information.
//
// Note the asymmetry with `highRiskPaths`: a migration is still high-risk, and
// still shows up in the risk reason and in the ship evidence. It is only exempt
// from "prove a unit test executes these lines", which no coverage tool can
// answer for a DDL file.
function defaultNonBehaviorGlobs() {
  return [
    "docs/**",
    "epics/**",
    "specs/**",
    ".specify/**",
    ".coding-flow/**",
    // The coverage report is an output of the run, not behavior the run covers.
    "coverage/**",
    "**/coverage/**",
    "**/*.md",
    ".gitignore",
    "**/*.lock",
    "**/package-lock.json",
    "**/pnpm-lock.yaml",
    "**/yarn.lock",
    // Type declarations are erased before anything runs. They can never appear
    // in a coverage report, and a .ts extension makes the report LOOK like it
    // should have covered them — the exact shape of a false block.
    "**/*.d.ts",
    // Build and tool configuration: executed by the toolchain, not by the suite.
    "**/*.config.js",
    "**/*.config.cjs",
    "**/*.config.mjs",
    "**/*.config.ts",
    "**/tsconfig*.json",
    "**/.eslintrc*",
    "**/.prettierrc*",
    // Schema and migration files: the risk is real, the unit test is not.
    "**/migrations/**",
    "**/*.sql",
    // Generated code is proven by whatever generated it.
    "**/generated/**",
    "**/__generated__/**",
    "**/*.gen.*",
    "**/*.generated.*",
  ];
}

function defaultHarnessConfig() {
  return {
    version: 1,
    mode: "standard",
    // Refuse a green verify on a medium/high-risk story whose diff adds no test.
    // Executing the suite proves the commands ran; it does not prove the change
    // is covered. See verifyStoryOnce.
    requireTestChange: true,
    // Where to look for a coverage report, and how much of the change's added
    // lines it must show as executed. When no report is found the gate falls
    // back to "did a test file change?" — the weaker question, asked only while
    // the stronger one cannot be.
    coverageReports: DEFAULT_REPORT_PATHS,
    minPatchCoverage: 80,
    secretPatterns: defaultSecretPatterns(),
    secretScanAllowlist: defaultSecretScanAllowlist(),
    highRiskPaths: defaultHighRiskPaths(),
    testGlobs: defaultTestGlobs(),
    nonBehaviorGlobs: defaultNonBehaviorGlobs(),
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
      // A config written before these fields existed has none of them, and the
      // defaults must apply — an older project gets the new policy, not a
      // silently disarmed one. An empty array, on the other hand, is a real
      // choice ("scan nothing here") and is honoured.
      secretPatterns: Array.isArray(config.secretPatterns) ? config.secretPatterns : defaults.secretPatterns,
      secretScanAllowlist: Array.isArray(config.secretScanAllowlist)
        ? config.secretScanAllowlist
        : defaults.secretScanAllowlist,
      highRiskPaths: Array.isArray(config.highRiskPaths) ? config.highRiskPaths : defaults.highRiskPaths,
      testGlobs: Array.isArray(config.testGlobs) ? config.testGlobs : defaults.testGlobs,
      nonBehaviorGlobs: Array.isArray(config.nonBehaviorGlobs)
        ? config.nonBehaviorGlobs
        : defaults.nonBehaviorGlobs,
      requireTestChange:
        typeof config.requireTestChange === "boolean"
          ? config.requireTestChange
          : defaults.requireTestChange,
      coverageReports: Array.isArray(config.coverageReports)
        ? config.coverageReports
        : defaults.coverageReports,
      minPatchCoverage: Number.isFinite(config.minPatchCoverage)
        ? config.minPatchCoverage
        : defaults.minPatchCoverage,
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

// Compiles the configured detectors. A pattern the project wrote wrong is
// reported, never thrown: an unparseable regex in a config file must not take
// down the PreToolUse hook on every single write. The rest keep working.
function compileSecretPatterns(config = null) {
  const source =
    config && Array.isArray(config.secretPatterns) ? config.secretPatterns : defaultSecretPatterns();
  const patterns = [];
  const invalid = [];

  for (const entry of source) {
    if (!entry || typeof entry !== "object" || typeof entry.pattern !== "string") {
      invalid.push({ name: (entry && entry.name) || "(unnamed)", reason: "missing a string `pattern`" });
      continue;
    }

    const name = typeof entry.name === "string" && entry.name ? entry.name : entry.pattern;

    try {
      patterns.push({
        name,
        regex: new RegExp(entry.pattern, typeof entry.flags === "string" ? entry.flags : ""),
        // Anything not explicitly "exact" is treated as a heuristic: a custom
        // pattern a project adds is far likelier to be a shape than a format,
        // and the safe default for an unknown detector is the one the allowlist
        // can silence.
        precision: entry.precision === "exact" ? "exact" : "heuristic",
      });
    } catch (error) {
      invalid.push({ name, reason: error.message });
    }
  }

  return { patterns, invalid };
}

function getSecretPatterns(config = null) {
  return compileSecretPatterns(config).patterns;
}

// Whether this path is a place where a placeholder credential is expected. Only
// ever consulted for heuristic patterns.
function isHeuristicAllowlisted(relativePath, config) {
  const allowlist = config && Array.isArray(config.secretScanAllowlist)
    ? config.secretScanAllowlist
    : defaultSecretScanAllowlist();

  return allowlist.some((pattern) => matchesPattern(relativePath, pattern));
}

// The single scanning primitive, shared by the after-the-fact scan (`harness
// check`) and the at-the-boundary one (`guard`). One implementation means the
// hook and the report can never disagree about what counts as a secret.
function findSecretsInContent(content, patterns, { skipHeuristics = false, first = false } = {}) {
  const active = skipHeuristics ? patterns.filter((p) => p.precision === "exact") : patterns;
  const found = [];

  if (active.length === 0 || !content) {
    return found;
  }

  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = active.find((pattern) => pattern.regex.test(lines[index]));

    if (match) {
      found.push({ name: match.name, precision: match.precision, line: index + 1 });

      if (first) {
        return found;
      }
    }
  }

  return found;
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
  const { patterns, invalid } = compileSecretPatterns(report.config);

  // A detector the project wrote wrong is not scanning anything, and silence is
  // the one thing a security scanner must never do quietly.
  for (const entry of invalid) {
    addIssue(
      report.errors,
      "invalid_secret_pattern",
      `secretPatterns entry "${entry.name}" is not a usable regex and scans nothing: ${entry.reason}`,
      ".coding-flow/harness.json",
    );
  }

  for (const filePath of files) {
    const relativePath = normalizePortable(path.relative(cwd, filePath));
    const content = readTextFileSafely(filePath);

    if (content === null) {
      continue;
    }

    const found = findSecretsInContent(content, patterns, {
      skipHeuristics: isHeuristicAllowlisted(relativePath, report.config),
    });

    for (const hit of found) {
      addIssue(
        report.errors,
        "secret_candidate",
        `Potential secret detected by pattern: ${hit.name}`,
        relativePath,
        hit.line,
      );
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

// Keyed by the canonical filename so callers read unchanged, but resolved by role:
// a single-file story answers all three from story.md.
function readStoryBundle(storyFullPath) {
  const files = {};

  for (const [part, name] of Object.entries(PART_FILES)) {
    files[name] = readStoryPart(storyFullPath, part);
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

// Risk read from the diff itself. Independent of any prose, so it holds on a
// change with no story at all — which is also what lets the proof layer work
// outside `epics/`.
function scoreDiffRisk(changedFiles, config) {
  const patterns = Array.isArray(config.highRiskPaths) ? config.highRiskPaths : defaultHighRiskPaths();
  const matchedPaths = changedFiles.filter((file) =>
    patterns.some((pattern) => matchesPattern(file, pattern)),
  );

  if (matchedPaths.length === 0) {
    return { level: "low", matchedPaths: [], reason: "no sensitive path in the diff." };
  }

  return {
    level: "high",
    matchedPaths,
    reason: `the diff touches ${matchedPaths.slice(0, 3).join(", ")}${matchedPaths.length > 3 ? ", …" : ""}.`,
  };
}

const RISK_RANK = { low: 0, medium: 1, high: 2 };

// The higher of the two wins, and both reasons are kept. A story that undersells
// what it touches cannot lower the score below what the files say; a story that
// declares a risk the paths do not show still counts, because intent the author
// stated is evidence too.
function combineRisk(storyRisk, diffRisk) {
  const storyWins = RISK_RANK[storyRisk.level] >= RISK_RANK[diffRisk.level];
  const winner = storyWins ? storyRisk : diffRisk;

  return {
    level: winner.level,
    source: storyWins ? (diffRisk.level === winner.level ? "story and diff" : "story") : "diff",
    matchedTerms: storyRisk.matchedTerms || [],
    matchedPaths: diffRisk.matchedPaths || [],
    reason:
      diffRisk.level === "high" && !storyWins
        ? `Sensitive paths changed: ${diffRisk.reason}`
        : winner.reason,
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

  // Both sources, highest wins: before implementing, the diff is usually empty
  // and the story decides; afterwards the files can only raise the score. So the
  // mode a story recommends cannot be talked down by how it was worded.
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

// Extract a markdown section by heading, at any level (## through ######), and
// stop at the next heading of the same or higher level. So `Result` (a ##)
// keeps its ### children, while `Rollback Notes` (a ### nested under Result)
// returns just its own body.
function extractSection(content, heading) {
  const lines = content.split(/\r?\n/);
  const target = heading.toLowerCase();

  let start = -1;
  let level = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{2,6})\s+(.*)$/);
    if (match && match[2].trim().toLowerCase() === target) {
      start = index;
      level = match[1].length;
      break;
    }
  }

  if (start === -1) {
    return "";
  }

  const section = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= level) {
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
      const notesPath = path.join(storyDir, "tasks.md");

      if (fs.existsSync(notesPath)) {
        rollbackNotes = extractSection(fs.readFileSync(notesPath, "utf8"), "Rollback Notes");
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
    provenance: captureIdentity(cwd),
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

// Extracts the command lines from the first fenced block under "## Commands".
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
    }
  }

  return commands;
}

// Source of the commands, by decreasing priority: explicit config, then the
// story's plan.md contract, then the usual package.json scripts.
function resolveValidationCommands({ storyDir = null } = {}) {
  const config = readConfig(cwd);

  if (config.validation) {
    // Correctness (`commands`) and deterministic quality (`quality`) both flow
    // through the same executed-and-captured proof; a red quality command blocks
    // exactly like a red test. Tests run first, then quality.
    const declared = [
      ...(Array.isArray(config.validation.commands) ? config.validation.commands : []),
      ...(Array.isArray(config.validation.quality) ? config.validation.quality : []),
    ];

    if (declared.length > 0) {
      return { source: "config", commands: declared };
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

function runValidationCommand(command, { timeoutMs = 600000 } = {}) {
  const maxOutputBytes = outputBufferBytes();
  const started = Date.now();
  const result = spawnSync(command, [], {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes,
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

  return {
    command,
    exitCode: toolError ? null : exitCode,
    ok: !toolError && exitCode === 0,
    timedOut,
    toolError,
    durationMs: Date.now() - started,
    stdoutTail: (result.stdout || "").slice(-cap),
    stderrTail: (result.stderr || "").slice(-cap),
  };
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

  if (evidence.commandsFound === 0) {
    log("Harness verify: no validation commands found.");
    log("Declare them in plan.md under '## Commands', or in config.validation.commands.");
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
      log(`  Measured from ${coverage.patch.report.path} (${coverage.patch.report.format}).`);

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

    log("  Add a test that covers this change, declare a '## Test Exemption' section in the story,");
    log('  or re-run with --test-exemption "<reason>" if there is no story.');
  } else if (evidence.ok) {
    log(`Harness verify passed (${evidence.results.length} command(s)).`);

    // Name the rung before the sentence. "Coverage: evidence — 1 test file(s)
    // changed" and "Coverage: verified — 92% of the added lines ran" now read as
    // the different claims they are; before this they read as one.
    const tier = coverage.tier || coverageTier(coverage);

    if (coverage.exemption) {
      log(`  Coverage: exempted — "${coverage.exemption.split(/\r?\n/)[0]}"`);
    } else if (coverage.required) {
      log(`  Coverage: ${tier} — ${coverage.reason}`);

      // The one rung worth explaining: it passed on a proxy, and the way to earn
      // the stronger word is a coverage report this run actually produced.
      if (tier === "evidence") {
        log("  A test file moved; no fresh coverage report was found, so nothing measured");
        log("  this change. Emit lcov.info or coverage-final.json to get 'verified'.");
      }
    }
  } else {
    log("Harness verify FAILED.");
  }

  // Which commands ran, and why those. The silent fallback from a config that was
  // never found to whatever package.json happened to hold is exactly how a verify
  // ends up proving less than it claims; naming the source makes the drift visible
  // on the line above the results instead of only inside the JSON.
  if (evidence.commandsFound > 0) {
    log(`Commands from: ${evidence.commandSource}`);
  }

  for (const item of evidence.results) {
    log(`- [${resultStatus(item)}] ${item.command} (${item.durationMs}ms)`);

    if (item.toolError) {
      log(`    ${item.toolError}`);
    }

    if (!item.ok && item.stderrTail.trim()) {
      const tail = item.stderrTail.trim().split(/\r?\n/).slice(-3).join("\n    ");
      log(`    ${tail}`);
    }
  }

  log(`Evidence: ${normalizePortable(path.relative(cwd, outputPath))}`);
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

// Everything this branch contributes, not just what is uncommitted: a story whose
// tests are already committed must not read as "no test changed". Falls back to
// the working tree when there is no base to compare against.
function changedFilesForCoverage() {
  const files = new Set();
  const base = defaultBranch(cwd);

  for (const ref of [base, `origin/${base}`]) {
    const mergeBase = runGitList(["merge-base", ref, "HEAD"])[0];

    if (mergeBase) {
      for (const file of runGitList(["diff", "--name-only", mergeBase])) {
        files.add(file);
      }
      break;
    }
  }

  for (const file of getChangedFiles()) {
    files.add(file);
  }

  // A brand-new test file is untracked, and it is the single most important case
  // this gate must see.
  for (const file of runGitList(["ls-files", "--others", "--exclude-standard"])) {
    files.add(file);
  }

  return [...files].map(normalizePortable).sort();
}

// The lines this change ADDED, per file. Only added lines: a deleted line has no
// coverage to have, and asking a test to execute code that no longer exists is
// nonsense. `--unified=0` makes every hunk header exact, so no context line is
// mistaken for a change.
//
// Hunk header: @@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@
function parseAddedLines(diffText) {
  const byFile = {};
  let current = null;
  let nextLine = 0;

  for (const line of diffText.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);

    if (fileMatch) {
      current = fileMatch[1] === "dev/null" ? null : normalizePortable(fileMatch[1]);
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);

    if (hunkMatch) {
      nextLine = Number.parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!current || !line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    if (!byFile[current]) {
      byFile[current] = [];
    }

    byFile[current].push(nextLine);
    nextLine += 1;
  }

  return byFile;
}

function runGitText(argsForGit) {
  try {
    const childProcess = require("child_process");
    return childProcess.execFileSync("git", argsForGit, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

// Added lines across the whole contribution: the branch's commits, the working
// tree, and untracked files (every line of which is new by definition).
function changedLinesForCoverage() {
  const byFile = {};

  const merge = (source) => {
    for (const [file, lines] of Object.entries(source)) {
      byFile[file] = [...new Set([...(byFile[file] || []), ...lines])].sort((a, b) => a - b);
    }
  };

  const base = defaultBranch(cwd);

  for (const ref of [base, `origin/${base}`]) {
    const mergeBase = runGitList(["merge-base", ref, "HEAD"])[0];

    if (mergeBase) {
      merge(parseAddedLines(runGitText(["diff", "--unified=0", mergeBase])));
      break;
    }
  }

  merge(parseAddedLines(runGitText(["diff", "--unified=0"])));
  merge(parseAddedLines(runGitText(["diff", "--unified=0", "--cached"])));

  for (const file of runGitList(["ls-files", "--others", "--exclude-standard"])) {
    const fullPath = path.join(cwd, file);

    try {
      const lineCount = fs.readFileSync(fullPath, "utf8").split(/\r?\n/).length;
      merge({ [normalizePortable(file)]: Array.from({ length: lineCount }, (_, index) => index + 1) });
    } catch {
      // Binary or unreadable: nothing to cover.
    }
  }

  return byFile;
}

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

// The line-level verdict, or null when it cannot be established — in which case
// the caller keeps the test-file heuristic. Never guesses: a missing report, an
// unparseable one, or one written before this run all mean "no line-level
// answer", not "uncovered".
function evaluatePatchCoverage({ config, behaviorFiles, startedAt }) {
  const report = loadCoverageReport(cwd, {
    candidates: Array.isArray(config.coverageReports) && config.coverageReports.length > 0
      ? config.coverageReports
      : DEFAULT_REPORT_PATHS,
  });

  if (!report) {
    return null;
  }

  // A report older than the run proves something about code from before it. The
  // most dangerous failure mode here is a months-old lcov quietly waving every
  // change through, so an out-of-date report is treated as no report at all.
  if (startedAt && report.generatedAt && report.generatedAt < startedAt) {
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

  const measured = measurePatchCoverage({ report, changedLinesByFile: scoped });

  // Nothing executable changed (comments, formatting) — no line-level claim to
  // make, so defer to the heuristic rather than report a vacuous 100%.
  if (measured.totalLines === 0) {
    return null;
  }

  const min = Number.isFinite(config.minPatchCoverage) ? config.minPatchCoverage : 80;

  return {
    ...measured,
    min,
    ok: measured.percent >= min,
    report: { path: report.path, format: report.format },
  };
}

function evaluateCoverageResult({ storyDir, config, exemption = null, startedAt = null }) {
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

  // Line-level proof when the suite produced a coverage report, the test-file
  // heuristic otherwise. The stronger measure always supersedes the weaker one:
  // "a test file moved" is a proxy for "the change is covered", and a proxy is
  // only worth using while the real thing is unavailable.
  const patch = evaluatePatchCoverage({ config, behaviorFiles, startedAt });

  if (patch) {
    if (patch.ok) {
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
      reason:
        `only ${patch.percent}% of the ${patch.totalLines} added line(s) are executed by the suite ` +
        `(min ${patch.min}%). The suite ran; it did not reach this change.`,
      riskSource: risk.source,
      riskPaths: risk.matchedPaths,
      changedFiles,
      testFiles,
      behaviorFiles,
      patch,
    };
  }

  if (testFiles.length > 0) {
    return {
      required: true,
      ok: true,
      mode: "test-file",
      reason: `${testFiles.length} test file(s) changed alongside ${behaviorFiles.length} behavior file(s)`,
      riskSource: risk.source,
      changedFiles,
      testFiles,
    };
  }

  // Two ways to declare the same thing: a section in the story (the normal path)
  // or `--test-exemption` on the command (the path for work with no story). Both
  // end up recorded verbatim in the evidence — that is the whole point.
  const declared = readTestExemption(storyDir) || (exemption && exemption.trim() ? exemption.trim() : null);

  if (declared) {
    return {
      required: true,
      ok: true,
      mode: "test-file",
      reason: "declared test exemption",
      exemption: declared,
      riskSource: risk.source,
      changedFiles,
      testFiles,
      behaviorFiles,
    };
  }

  return {
    required: true,
    ok: false,
    mode: "test-file",
    reason:
      `${behaviorFiles.length} behavior file(s) changed and no test file did. A green suite ` +
      "that was already green proves nothing about this change.",
    riskSource: risk.source,
    riskPaths: risk.matchedPaths,
    changedFiles,
    testFiles,
    behaviorFiles,
  };
}

// The verdict, plus the name of the rung it landed on. Stamped in one place so
// no return path can forget it, and so `mode` stays what it has always been —
// how the answer was obtained — while `tier` says how strong the answer is.
function evaluateCoverage(options) {
  const result = evaluateCoverageResult(options);

  return { ...result, tier: coverageTier(result) };
}

// Executes the declared validation commands for one story and returns the
// evidence. Pure: it runs the commands and captures their results verbatim but
// writes nothing — the caller decides whether to persist it (writeVerifyEvidence)
// and what a red result means for its own flow. Shared by `harness verify` (a
// single story) and `run` (a batch), so both produce identical evidence.
function verifyStoryOnce({ story = null, exemption = null } = {}) {
  const resolvedStory = story ? resolveProjectPath(story) : null;
  const storyDir = resolveStoryDir(story);
  const resolution = resolveValidationCommands({ storyDir });
  // Captured before the commands run: a coverage report older than this was not
  // produced by this run, and must not be read as if it were.
  const startedAt = Date.now();
  const results = resolution.commands.map((command) => runValidationCommand(command));
  const commandsOk = results.length > 0 && results.every((item) => item.ok);
  const { config } = readHarnessConfig();
  // Only evaluated on a green suite: a red one is already not a proof, and
  // telling someone their failing story also lacks tests is noise.
  const coverage = commandsOk
    ? evaluateCoverage({ storyDir, config, exemption, startedAt })
    : { required: false, ok: true, reason: "not evaluated (commands did not pass)", changedFiles: [], testFiles: [] };

  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
    provenance: captureIdentity(cwd),
    story: resolvedStory ? resolvedStory.relativePath : null,
    commandSource: resolution.source,
    commandsFound: resolution.commands.length,
    // Recorded so a later verify can recognise this proof as still applicable.
    commandsFingerprint: commandsFingerprint(resolution.commands),
    untrackedDigest: currentTreeToken(cwd) ? untrackedDigest() : null,
    environment: captureEnvironment(),
    commandsOk,
    coverage,
    ok: commandsOk && coverage.ok,
    results,
  };
}

// Identifies WHAT was proved, so a recorded proof is only reusable for the same
// set of commands. Changing config.validation must invalidate every prior green.
function commandsFingerprint(commands) {
  return crypto.createHash("sha256").update(commands.join("\n")).digest("hex").slice(0, 40);
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
function findReusableVerify({ storyRelativePath, commands }) {
  const token = currentTreeToken(cwd);

  if (!token || commands.length === 0) {
    return null;
  }

  const untracked = untrackedDigest();
  const fingerprint = commandsFingerprint(commands);
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
  fs.mkdirSync(harnessRunsDir(), { recursive: true });
  const base = new Date().toISOString().replace(/[:.]/g, "-");
  let outputPath = path.join(harnessRunsDir(), `${base}-verify.json`);
  let counter = 1;

  while (fs.existsSync(outputPath)) {
    outputPath = path.join(harnessRunsDir(), `${base}-${counter}-verify.json`);
    counter += 1;
  }

  writeJson(outputPath, evidence);
  return outputPath;
}

// `--story` scopes the proof, and a scope that silently misses is worse than no
// scope at all: verify falls back to the project-wide commands and then writes an
// evidence claiming it proved a story that does not exist — which `audit` ingests
// as-is. `run` already refuses this (run.js selectStories); now that
// `verify --story` is the promoted, typed-by-hand escape hatch, it must too.
//
// Only verify is this strict. `preflight` deliberately reports a missing story as
// "(missing)", and `check` legitimately scopes its secret scan to any directory.
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

function harnessVerify({ json = false, dryRun = false, story = null, noCache = false, exemption = null } = {}) {
  if (story !== null) {
    requireStoryScope(story);
  }

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
  if (!noCache) {
    const resolution = resolveValidationCommands({ storyDir: resolveStoryDir(story) });
    const reusable = findReusableVerify({
      storyRelativePath: resolvedStory ? resolvedStory.relativePath : null,
      commands: resolution.commands,
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

  const evidence = verifyStoryOnce({ story, exemption });
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

function harnessCommand({ commandArgs, getFlagValue, flags }) {
  const subcommand = commandArgs[0] || "check";
  const story = getFlagValue("--story", null);

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
  combineRisk,
  harnessCommand,
  // Reused by `run` (batch orchestration) so it shares the single-story verify
  // execution path instead of duplicating it.
  verifyStoryOnce,
  writeVerifyEvidence,
  resolveValidationCommands,
  resolveStoryDir,
  captureEnvironment,
};
