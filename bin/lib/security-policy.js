"use strict";

// What the harness refuses to let through: secret detection (patterns,
// per-path allowlist, content scan), sensitive paths, and the .env gitignore
// check. The guard requires it directly, so a tool call never loads the
// verify machinery.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { defaultSecretPatterns, defaultSecretScanAllowlist } = require("./harness-config");
const {
  normalizePortable,
  addIssue,
  matchesPattern,
  isAllowedEnvExample,
  readTextFileSafely,
} = require("./util");

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

module.exports = {
  compileSecretPatterns,
  getSecretPatterns,
  isHeuristicAllowlisted,
  findSecretsInContent,
  checkSensitivePaths,
  checkSecrets,
  checkEnvGitignore,
};
