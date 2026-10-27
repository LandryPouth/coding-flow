"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { cwd } = require("./context");
const {
  fail,
  log,
  matchesPattern,
  readTextFileSafely,
  isAllowedEnvExample,
  normalizePortable,
} = require("./util");
const { scanProject } = require("./bootstrap");
const { readHarnessConfig, EVIDENCE_BLOCKED_PATHS } = require("./harness-config");
const {
  getSecretPatterns,
  findSecretsInContent,
  isHeuristicAllowlisted,
} = require("./security-policy");

const DEFAULT_HISTORY_LIMIT = 2000;
const HOTSPOT_LIMIT = 15;
const LARGE_FILE_LINES = 500;

const CODE_EXTENSIONS = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
  "py", "rb", "go", "rs", "java", "kt", "kts", "cs", "php",
  "swift", "m", "mm", "scala", "c", "h", "cc", "cpp", "cxx", "hpp",
  "sh", "bash", "zsh", "sql", "vue", "svelte", "astro", "ex", "exs",
  "erl", "hrl", "clj", "cljs", "lua", "dart", "zig", "nim",
]);

function git(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function isCodeFile(relativePath) {
  const extension = path.extname(relativePath).slice(1).toLowerCase();
  return CODE_EXTENSIONS.has(extension);
}

function isTestFile(relativePath, testGlobs) {
  return testGlobs.some((pattern) => matchesPattern(relativePath, pattern));
}

function listTrackedFiles(root) {
  const output = git(root, ["ls-files", "-z"]);

  if (output === null) {
    return { available: false, files: [] };
  }

  return {
    available: true,
    files: output.split("\0").filter(Boolean).map(normalizePortable).sort(),
  };
}

function countLines(filePath) {
  try {
    const content = readTextFileSafely(filePath);

    if (content === null) {
      return null;
    }

    if (content.length === 0) {
      return 0;
    }

    const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
    return trimmed.split("\n").length;
  } catch {
    return null;
  }
}

// `git log --numstat` renders a rename as `old => new` or `dir/{old => new}.js`.
// The churn belongs to the file that exists now, so collapse both forms to the
// new path instead of recording a name nothing on disk matches.
function normalizeNumstatPath(rawPath) {
  let value = rawPath.trim();

  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }

  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(value);

  if (braced) {
    return `${braced[1]}${braced[3]}${braced[4]}`;
  }

  const arrow = value.indexOf(" => ");

  if (arrow !== -1) {
    return value.slice(arrow + 4).replace(/^"|"$/g, "");
  }

  return value;
}

function isShallowClone(root) {
  const marker = git(root, ["rev-parse", "--is-shallow-repository"]);

  // An old git without this flag answers null: behave as a full clone.
  return marker !== null && marker.trim() === "true";
}

function collectChurn(root) {
  if (git(root, ["rev-parse", "--verify", "HEAD"]) === null) {
    return { available: false, byPath: new Map() };
  }

  // A shallow clone carries one snapshot; its numstat lists every file at its
  // full size, so "churn" would rank every file by lines². Churn is a
  // property of history this clone does not have: report it as unavailable.
  if (isShallowClone(root)) {
    return { available: false, byPath: new Map() };
  }

  const output = git(root, ["log", "--numstat", "--format=", "--all"]);

  if (output === null) {
    return { available: false, byPath: new Map() };
  }

  const byPath = new Map();

  for (const line of output.split(/\r?\n/)) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);

    if (!match) {
      continue;
    }

    const added = match[1] === "-" ? 0 : Number(match[1]);
    const deleted = match[2] === "-" ? 0 : Number(match[2]);
    const filePath = normalizeNumstatPath(match[3]);
    byPath.set(filePath, (byPath.get(filePath) || 0) + added + deleted);
  }

  return { available: true, byPath };
}

function testContents(root, testFiles) {
  const contents = [];

  for (const relativePath of testFiles) {
    try {
      const content = readTextFileSafely(path.join(root, relativePath));

      if (content !== null) {
        contents.push({ path: relativePath, content });
      }
    } catch {
      continue;
    }
  }

  return contents;
}

function hasNearbyOrImportingTest(relativePath, testFiles, tests) {
  const directory = path.posix.dirname(relativePath);

  if (testFiles.some((candidate) => path.posix.dirname(candidate) === directory)) {
    return true;
  }

  const basename = path.posix.basename(relativePath, path.posix.extname(relativePath));

  if (basename.length < 3) {
    return false;
  }

  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reference = new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`);

  return tests.some((test) => reference.test(test.content));
}

function buildHotspots(root, trackedFiles, churn, testFiles, tests) {
  const rows = [];

  for (const relativePath of trackedFiles) {
    if (!isCodeFile(relativePath)) {
      continue;
    }

    const lines = countLines(path.join(root, relativePath));

    if (lines === null) {
      continue;
    }

    const changed = churn.available ? churn.byPath.get(relativePath) || 0 : null;

    rows.push({
      path: relativePath,
      lines,
      churn: changed,
      score: churn.available ? lines * changed : null,
      hasTest: hasNearbyOrImportingTest(relativePath, testFiles, tests),
    });
  }

  rows.sort((a, b) => {
    if (a.score !== null && b.score !== null && a.score !== b.score) {
      return b.score - a.score;
    }

    return b.lines - a.lines || a.path.localeCompare(b.path);
  });

  return rows.slice(0, HOTSPOT_LIMIT);
}

function buildTestMap(codeDirectories, trackedFiles, testFiles) {
  const directories = codeDirectories.map((directory) => {
    const prefix = `${directory}/`;
    const codeFiles = trackedFiles.filter(
      (relativePath) => relativePath.startsWith(prefix) && isCodeFile(relativePath),
    ).length;
    const tests = testFiles.filter((relativePath) => relativePath.startsWith(prefix)).length;

    return { directory, codeFiles, testFiles: tests };
  });

  return {
    directories,
    withoutTests: directories
      .filter((entry) => entry.codeFiles > 0 && entry.testFiles === 0)
      .map((entry) => entry.directory),
  };
}

function scanTreeSecrets(root, trackedFiles, config) {
  const patterns = getSecretPatterns(config);
  const findings = [];
  let skipped = 0;

  for (const relativePath of trackedFiles) {
    const absolute = path.join(root, relativePath);

    // A tracked file deleted from the working tree is not a skipped binary or
    // oversize file; it is simply gone, so it is not counted here.
    if (!fs.existsSync(absolute)) {
      continue;
    }

    let content;

    try {
      content = readTextFileSafely(absolute);
    } catch {
      skipped += 1;
      continue;
    }

    if (content === null) {
      skipped += 1;
      continue;
    }

    const hits = findSecretsInContent(content, patterns, {
      skipHeuristics: isHeuristicAllowlisted(relativePath, config),
    });

    for (const hit of hits) {
      findings.push({
        name: hit.name,
        precision: hit.precision,
        path: relativePath,
        line: hit.line,
      });
    }
  }

  return { findings, skipped };
}

function normalizeDiffPath(header) {
  let value = header.trim();

  if (value === "/dev/null") {
    return null;
  }

  const tab = value.indexOf("\t");

  if (tab !== -1) {
    value = value.slice(0, tab);
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  return value.startsWith("b/") ? value.slice(2) : value;
}

function unavailableHistory(startedAt, limit) {
  return {
    available: false,
    commitsScanned: 0,
    limit,
    durationMs: Date.now() - startedAt,
    findings: [],
  };
}

function parseHistoryDiff(output, exactPatterns) {
  let commit = null;
  let currentPath = null;
  let inHunk = false;
  const commits = new Set();
  const entries = new Map();

  for (const line of output.split(/\r?\n/)) {
    if (/^[0-9a-f]{40}$/.test(line)) {
      commit = line;
      commits.add(line);
      currentPath = null;
      inHunk = false;
      continue;
    }

    if (line.startsWith("diff --git ")) {
      currentPath = null;
      inHunk = false;
      continue;
    }

    if (line.startsWith("+++ ")) {
      currentPath = normalizeDiffPath(line.slice(4));
      continue;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentPath || !commit || !line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    const added = line.slice(1);

    for (const pattern of exactPatterns) {
      if (!pattern.regex.test(added)) {
        continue;
      }

      const key = `${pattern.name}\0${currentPath}`;
      const entry = entries.get(key) || {
        name: pattern.name,
        path: currentPath,
        commit,
        count: 0,
      };

      entry.commit = commit;
      entry.count += 1;
      entries.set(key, entry);
    }
  }

  return { commits, entries };
}

function scanHistorySecrets(root, exactPatterns, limit) {
  const startedAt = Date.now();

  if (git(root, ["rev-parse", "--verify", "HEAD"]) === null) {
    return unavailableHistory(startedAt, limit);
  }

  const output = git(root, [
    "log", "-p", "--all", "-U0", "--no-color", `-n${limit}`, "--format=%H",
  ]);

  if (output === null) {
    return unavailableHistory(startedAt, limit);
  }

  const { commits, entries } = parseHistoryDiff(output, exactPatterns);

  return {
    available: true,
    commitsScanned: commits.size,
    limit,
    durationMs: Date.now() - startedAt,
    findings: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name)),
  };
}

function scanSensitiveFiles(trackedFiles, config) {
  const evidence = new Set(EVIDENCE_BLOCKED_PATHS);
  const blockedPatterns = config.blockedPaths.filter((pattern) => !evidence.has(pattern));
  const findings = [];

  for (const relativePath of trackedFiles) {
    if (isAllowedEnvExample(relativePath)) {
      continue;
    }

    const blocked = blockedPatterns.find((pattern) => matchesPattern(relativePath, pattern));

    if (blocked) {
      findings.push({ path: relativePath, kind: "blocked", pattern: blocked });
      continue;
    }

    const sensitive = config.sensitiveGlobs.find((pattern) => matchesPattern(relativePath, pattern));

    if (sensitive) {
      findings.push({ path: relativePath, kind: "sensitive", pattern: sensitive });
    }
  }

  return findings;
}

function buildLargeFiles(root, trackedFiles) {
  const rows = [];

  for (const relativePath of trackedFiles) {
    if (!isCodeFile(relativePath)) {
      continue;
    }

    const lines = countLines(path.join(root, relativePath));

    if (lines !== null && lines > LARGE_FILE_LINES) {
      rows.push({ path: relativePath, lines });
    }
  }

  return rows.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
}

function collectRecoveryScan({ historyLimit = DEFAULT_HISTORY_LIMIT } = {}) {
  const startedAt = Date.now();
  // `scanProject` reads the process cwd, so the scan is rooted there too; there
  // is no separate root to thread through.
  const root = cwd;
  const stack = scanProject();
  const tracked = listTrackedFiles(root);
  const { config } = readHarnessConfig(root);
  const churn = collectChurn(root);
  const testGlobs = config.testGlobs;
  const testFiles = tracked.files.filter((relativePath) => isTestFile(relativePath, testGlobs));
  const tests = testContents(root, testFiles);
  const patterns = getSecretPatterns(config);
  const exactPatterns = patterns.filter((pattern) => pattern.precision === "exact");

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root,
    durationMs: Date.now() - startedAt,
    git: {
      available: tracked.available,
      churnAvailable: churn.available,
    },
    stack,
    hotspots: buildHotspots(root, tracked.files, churn, testFiles, tests),
    testMap: buildTestMap(stack.codeDirectories, tracked.files, testFiles),
    secrets: {
      tree: scanTreeSecrets(root, tracked.files, config),
      history: scanHistorySecrets(root, exactPatterns, historyLimit),
    },
    sensitiveFiles: scanSensitiveFiles(tracked.files, config),
    largeFiles: buildLargeFiles(root, tracked.files),
  };
}

function printRecoveryScan(scan) {
  log(`Recovery scan — ${scan.root}`);
  log(
    `Stack: ${scan.stack.detectedFrameworks.length ? scan.stack.detectedFrameworks.join(", ") : "unknown"}` +
      ` — ${scan.stack.codeDirectories.length} code director${scan.stack.codeDirectories.length === 1 ? "y" : "ies"}` +
      ` — ${scan.durationMs}ms`,
  );
  log("");

  log("Hotspots (size × churn)");
  if (scan.hotspots.length === 0) {
    log("- none");
  }
  for (const hotspot of scan.hotspots) {
    const churn = hotspot.churn === null ? "churn unavailable" : `churn ${hotspot.churn}`;
    log(`- ${hotspot.path}: ${hotspot.lines} lines, ${churn}, ${hotspot.hasTest ? "has a test" : "no test"}`);
  }
  log("");

  log("Code directories without tests");
  if (scan.testMap.withoutTests.length === 0) {
    log("- none");
  }
  for (const directory of scan.testMap.withoutTests) {
    log(`- ${directory}/`);
  }
  log("");

  log("Secrets in the tree");
  if (scan.secrets.tree.findings.length === 0) {
    log("- none");
  }
  for (const finding of scan.secrets.tree.findings) {
    log(`- ${finding.name} at ${finding.path}:${finding.line}`);
  }
  log(`- skipped: ${scan.secrets.tree.skipped} binary or > 1 MB file(s)`);
  log("");

  const history = scan.secrets.history;
  log(
    `Secrets in history (${history.available ? `${history.commitsScanned} commit(s), ${history.durationMs}ms` : "unavailable"})`,
  );
  if (history.findings.length === 0) {
    log("- none");
  }
  for (const finding of history.findings) {
    log(`- ${finding.name} in ${finding.path} (first ${finding.commit.slice(0, 8)}), ${finding.count} occurrence(s)`);
  }
  log("");

  log("Tracked sensitive files");
  if (scan.sensitiveFiles.length === 0) {
    log("- none");
  }
  for (const finding of scan.sensitiveFiles) {
    log(`- ${finding.path} (${finding.kind})`);
  }
  log("");

  log(`Large files (over ${LARGE_FILE_LINES} lines)`);
  if (scan.largeFiles.length === 0) {
    log("- none");
  }
  for (const file of scan.largeFiles) {
    log(`- ${file.path}: ${file.lines} lines`);
  }
}

function recoverScan({ json = false, historyLimit = null } = {}) {
  let limit = DEFAULT_HISTORY_LIMIT;

  if (historyLimit !== null) {
    limit = Number(historyLimit);

    if (!Number.isInteger(limit) || limit < 1) {
      fail(`--history-limit must be a positive integer, got "${historyLimit}".`);
    }
  }

  const scan = collectRecoveryScan({ historyLimit: limit });

  if (json) {
    log(JSON.stringify(scan, null, 2));
    return;
  }

  printRecoveryScan(scan);
}

module.exports = {
  recoverScan,
  collectRecoveryScan,
  DEFAULT_HISTORY_LIMIT,
};
