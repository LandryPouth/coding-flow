"use strict";

// The harness policy file (.coding-flow/harness.json): where it lives, its
// defaults, reading it and creating it. A leaf: copyTemplates (templates.js),
// the policy fingerprint and the guard read it without loading the verify
// machinery.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { DEFAULT_REPORT_PATHS } = require("./coverage");
const { readJson, writeJson } = require("./util");

// `root` defaults to this module's own process-bound `cwd` (the overwhelming
// majority of call sites — `verify`, `check`, `preflight` all run in-process
// against the real checkout). story-04-02 is the first caller that must score
// risk for a story living in a DIFFERENT worktree than the process itself
// (`ai-flow next` reports on every story project-wide, not just the one at
// `cwd`) — an explicit root lets it read that worktree's own tracked
// `.coding-flow/harness.json` without a real `chdir`.
function harnessConfigPath(root = cwd) {
  return path.join(root, ".coding-flow", "harness.json");
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
    // Risk levels at which a validation command that only replayed a build-tool
    // cache (turbo, nx) does not count as executed proof. See verifyStoryOnce.
    freshTestsFor: [],
    secretPatterns: defaultSecretPatterns(),
    secretScanAllowlist: defaultSecretScanAllowlist(),
    highRiskPaths: defaultHighRiskPaths(),
    testGlobs: defaultTestGlobs(),
    nonBehaviorGlobs: defaultNonBehaviorGlobs(),
    // Paths that are output, not authorship (a regenerated client, an OpenAPI
    // dump): left out of coverage, risk, weakening and deleted-test signals.
    // Never consulted by the guard (`blockedPaths`) or by secret scanning.
    ignoredPaths: [],
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

function readHarnessConfig(root = cwd) {
  const defaults = defaultHarnessConfig();
  const config = readJson(harnessConfigPath(root), null);

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
      ignoredPaths: Array.isArray(config.ignoredPaths) ? config.ignoredPaths : defaults.ignoredPaths,
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
      freshTestsFor: Array.isArray(config.freshTestsFor)
        ? config.freshTestsFor.filter((level) => typeof level === "string")
        : defaults.freshTestsFor,
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

module.exports = {
  harnessConfigPath,
  harnessRunsDir,
  defaultSecretPatterns,
  defaultSecretScanAllowlist,
  defaultTestGlobs,
  defaultHighRiskPaths,
  defaultHarnessConfig,
  readHarnessConfig,
  ensureHarnessConfig,
};
