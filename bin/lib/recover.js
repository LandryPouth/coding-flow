"use strict";

const fs = require("fs");
const os = require("os");
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
// A history patch line can be arbitrarily long (a committed minified bundle).
// Cap what is held in memory, but keep a tail wider than any credential format
// so a pattern spanning the seam is still matched when the line is scanned in
// pieces.
const HISTORY_LINE_BYTES = 1024 * 1024;
const HISTORY_LINE_OVERLAP_BYTES = 64 * 1024;

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

// Count lines by streaming the file in chunks: the 1 MB text cap that guards
// the secret scan must not hide a big tracked code file from the size reports.
// Nothing is carried between chunks — a newline is a byte, so only the trailing
// byte matters for the "no final newline" line — which keeps memory constant
// however long a single line is.
function countLines(filePath) {
  try {
    const stat = fs.statSync(filePath);

    if (stat.size === 0) {
      return 0;
    }

    const descriptor = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(64 * 1024);
    let lines = 0;
    let lastByte = null;

    try {
      let bytesRead;

      do {
        bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);

        if (bytesRead === 0) {
          break;
        }

        lastByte = buffer[bytesRead - 1];

        for (let index = 0; index < bytesRead; index += 1) {
          if (buffer[index] === 0x0a) {
            lines += 1;
          }
        }
      } while (bytesRead === buffer.length);
    } finally {
      fs.closeSync(descriptor);
    }

    if (lastByte !== null && lastByte !== 0x0a) {
      lines += 1;
    }

    return lines;
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

function scanAddedPatterns(exactPatterns, text, matched) {
  for (const pattern of exactPatterns) {
    // `test` is stateful when the regex carries `g`; every piece is a fresh
    // window, so a leftover lastIndex would skip its start.
    pattern.regex.lastIndex = 0;

    if (pattern.regex.test(text)) {
      matched.add(pattern.name);
    }
  }
}

function recordLineMatches(entries, commit, currentPath, matched) {
  if (commit && currentPath) {
    for (const name of matched) {
      const key = `${name}\0${currentPath}`;
      const entry = entries.get(key) || {
        name,
        path: currentPath,
        commit,
        count: 0,
      };

      // `git log` walks newest-first, so overwriting down the walk lands on
      // the chronologically first commit that introduced the line.
      entry.commit = commit;
      entry.count += 1;
      entries.set(key, entry);
    }
  }

  matched.clear();
}

// Consumes a diff line, or a piece of one when the line outgrew the stream
// window. `continuation` means the text is part of the line already classified;
// `complete` means this piece ends the line (a newline followed it).
function createHistoryParser(exactPatterns) {
  let commit = null;
  let currentPath = null;
  let inHunk = false;
  const commits = new Set();
  const entries = new Map();

  let lineAdded = false;
  const lineMatches = new Set();

  return {
    line(rawLine, { continuation = false, complete = true } = {}) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (continuation) {
        if (lineAdded) {
          scanAddedPatterns(exactPatterns, line, lineMatches);
        }
      } else {
        lineMatches.clear();
        lineAdded = false;

        if (/^[0-9a-f]{40}$/.test(line)) {
          commit = line;
          commits.add(line);
          currentPath = null;
          inHunk = false;
        } else if (line.startsWith("diff --git ")) {
          currentPath = null;
          inHunk = false;
        } else if (line.startsWith("+++ ")) {
          currentPath = normalizeDiffPath(line.slice(4));
        } else if (line.startsWith("@@")) {
          inHunk = true;
        } else if (inHunk && currentPath && commit && line.startsWith("+") && !line.startsWith("+++")) {
          lineAdded = true;
          scanAddedPatterns(exactPatterns, line.slice(1), lineMatches);
        }
      }

      if (complete && lineAdded) {
        recordLineMatches(entries, commit, currentPath, lineMatches);
        lineAdded = false;
      }
    },
    result() {
      return { commits, entries };
    },
  };
}

// Feed one file to `onLine` without loading it whole. Chunks are copied off the
// reused read buffer before they are carried, and a line longer than the window
// is emitted in pieces with an overlapping tail, so memory stays bounded (at
// HISTORY_LINE_BYTES plus overlap) without hiding a secret past the seam.
function streamLines(filePath, onLine) {
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(256 * 1024);
  let pending = Buffer.alloc(0);
  let continuing = false;

  try {
    let bytesRead;

    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);

      if (bytesRead === 0) {
        break;
      }

      // Copy: `buffer` is overwritten by the next read, and `pending` must
      // never alias it.
      pending = pending.length === 0
        ? Buffer.from(buffer.subarray(0, bytesRead))
        : Buffer.concat([pending, buffer.subarray(0, bytesRead)]);

      let newline = pending.indexOf(0x0a);

      while (newline !== -1) {
        onLine(pending.subarray(0, newline).toString("utf8"), { continuation: continuing, complete: true });
        pending = pending.subarray(newline + 1);
        continuing = false;
        newline = pending.indexOf(0x0a);
      }

      if (pending.length >= HISTORY_LINE_BYTES) {
        onLine(pending.toString("utf8"), { continuation: continuing, complete: false });
        continuing = true;
        pending = pending.subarray(pending.length - HISTORY_LINE_OVERLAP_BYTES);
      }
    } while (bytesRead === buffer.length);
  } finally {
    fs.closeSync(descriptor);
  }

  if (pending.length > 0) {
    onLine(pending.toString("utf8"), { continuation: continuing, complete: true });
  }
}

function scanHistorySecrets(root, exactPatterns, limit) {
  const startedAt = Date.now();

  if (git(root, ["rev-parse", "--verify", "HEAD"]) === null) {
    return unavailableHistory(startedAt, limit);
  }

  const parser = createHistoryParser(exactPatterns);
  // A private directory (mkdtemp is 0700 on POSIX) removes both the predictable
  // name in a shared temp dir and the risk of adopting a leftover file.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-recover-"));
  const output = path.join(directory, "history.log");
  const cleanup = () => {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // A temp directory that cannot be removed is not worth failing the scan.
    }
  };

  // `finally` covers return and throw; an abrupt exit is covered here so a
  // crashed scan does not leave the patch text behind.
  process.once("exit", cleanup);

  try {
    // `--output` keeps the patch text off the pipe: git writes it to a
    // temporary file the parser then reads chunk by chunk, so memory stays
    // bounded however large the window is. A git too old to know `--output`
    // fails the invocation and history is reported unavailable, not partial.
    if (git(root, [
      "log", "-p", "--all", "-U0", "--no-color", `-n${limit}`, "--format=%H", `--output=${output}`,
    ]) === null) {
      return unavailableHistory(startedAt, limit);
    }

    streamLines(output, (line, options) => parser.line(line, options));

    const { commits, entries } = parser.result();

    return {
      available: true,
      commitsScanned: commits.size,
      limit,
      durationMs: Date.now() - startedAt,
      findings: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name)),
    };
  } finally {
    process.removeListener("exit", cleanup);
    cleanup();
  }
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
