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
const { readConfig } = require("./config");
const { loadFunctionReport, measureFile } = require("./complexity");
const { detectSecurityRecipes, securityCoverage } = require("./security-recipes");
const {
  compileSecretPatterns,
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
const HISTORY_TEMP_PREFIX = "ai-flow-recover-";
// A scan's temp directory is removed on return, on throw and on exit. A hard
// kill (SIGKILL) can still leave one behind, so the next scan clears leftovers
// old enough that no live scan can own them.
const STALE_HISTORY_TEMP_MS = 24 * 60 * 60 * 1000;

const RECOVERY_DIR = path.join("docs", "recovery");
const RECOVERY_LOCAL_DIR = path.join(".coding-flow", "recovery");
const FINDINGS_FILE = "findings.md";
const FINDINGS_LOCAL_FILE = "findings.local.md";
const FINDINGS_HEADING = /^###\s+(R-[0-9]+)\s*(?:[—–-]\s*)?(.*)$/;
// A level-3 heading that looks like a finding but has no `R-NN` id: reported as
// unreadable, so a typo never makes a finding vanish from `status`.
const FINDINGS_HEADING_LOOSE = /^###\s+R(?:-|\d)/i;
// `path:line`, `path:line-line` or `path:line:column`; only the first line is checked.
const LOCATION_LINE = /^(.*?):(\d+)(?:[-:]\d+)?$/;
const OPEN_STATES = new Set(["suspected", "confirmed", "reproduced"]);
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const FINDING_FIELDS = new Set([
  "state",
  "dimension",
  "severity",
  "location",
  "trace",
  "next",
  "fixed by",
  "revisit",
]);

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
        // A short read is not EOF: only 0 is. Continuing on any positive count
        // keeps a truncated read from silently dropping the rest of the file.
      } while (bytesRead > 0);
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

// `git` quotes a path whose bytes are not plain printable ASCII (the default
// core.quotePath), so `café.js` arrives as `"caf\303\251.js"`. Octal escapes are
// UTF-8 bytes, not Latin-1 code points: decode the bytes, don't map per char,
// or the path stops matching the file on disk.
function unquoteGitPath(value) {
  if (!(value.startsWith('"') && value.endsWith('"'))) {
    return value;
  }

  const inner = value.slice(1, -1);
  const bytes = [];
  const escapes = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34 };

  for (let index = 0; index < inner.length; ) {
    if (inner[index] !== "\\") {
      let end = index + 1;

      while (end < inner.length && inner[end] !== "\\") {
        end += 1;
      }

      bytes.push(...Buffer.from(inner.slice(index, end), "utf8"));
      index = end;
      continue;
    }

    const next = inner[index + 1];

    if (next === undefined) {
      bytes.push(92);
      break;
    }

    if (/[0-7]/.test(next)) {
      const octal = /^[0-7]{1,3}/.exec(inner.slice(index + 1))[0];

      bytes.push(parseInt(octal, 8));
      index += 1 + octal.length;
      continue;
    }

    bytes.push(escapes[next] !== undefined ? escapes[next] : next.charCodeAt(0));
    index += 2;
  }

  return Buffer.from(bytes).toString("utf8");
}

// `git log --numstat` renders a rename as `old => new`, `dir/{old => new}.js`,
// or (when a name must be quoted) `"old" => "new"`. The churn belongs to the
// file that exists now, so collapse every form to the new path instead of
// recording a name nothing on disk matches.
function normalizeNumstatPath(rawPath) {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(rawPath);

  if (braced) {
    return unquoteGitPath(`${braced[1]}${braced[3]}${braced[4]}`);
  }

  const arrow = rawPath.indexOf(" => ");

  if (arrow !== -1) {
    return unquoteGitPath(rawPath.slice(arrow + 4));
  }

  return unquoteGitPath(rawPath);
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

// Read each tracked code file once and keep its line count: hotspots and the
// large-file report both need it, and a second pass would double the I/O on the
// large repositories this scan is aimed at.
function measureCodeLines(root, trackedFiles) {
  const byPath = new Map();

  for (const relativePath of trackedFiles) {
    if (!isCodeFile(relativePath)) {
      continue;
    }

    const lines = countLines(path.join(root, relativePath));

    if (lines !== null) {
      byPath.set(relativePath, lines);
    }
  }

  return byPath;
}

// The lcov the scan ranks by, when one exists and is not older than any source it
// lists: a report written before the last edit would rank yesterday's code.
function freshFunctionReport(root, config) {
  const report = loadFunctionReport(root, { config });

  if (!report) {
    return { report: null, reason: "no coverage report" };
  }

  const stale = [...report.files.keys()].some((file) => {
    try {
      return fs.statSync(path.join(root, file)).mtimeMs > report.generatedAt;
    } catch {
      return false;
    }
  });

  return stale ? { report: null, reason: "coverage report older than the code" } : { report, reason: null };
}

// A file's worst functions by CRAP, measured from the report; null when the
// report does not list the file.
function worstFunctions(root, relativePath, report) {
  if (!report || !report.files.has(relativePath)) {
    return null;
  }

  try {
    return measureFile(root, relativePath, report.files.get(relativePath))
      .sort((a, b) => b.crap - a.crap || b.length - a.length)
      .slice(0, 3)
      .map(({ name, line, length, crap }) => ({ name, line, length, crap }));
  } catch {
    return null;
  }
}

// Churn × size, or churn × CRAP (the file's worst function) when a fresh lcov
// lists the file. Without churn the second factor ranks alone.
function buildHotspots(lineCounts, churn, testFiles, tests, { root = cwd, report = null } = {}) {
  const rows = [];

  for (const [relativePath, lines] of lineCounts) {
    const changed = churn.available ? churn.byPath.get(relativePath) || 0 : null;
    const functions = worstFunctions(root, relativePath, report);
    const crap = functions && functions.length > 0 ? functions[0].crap : null;
    const weight = report ? crap : lines;

    rows.push({
      path: relativePath,
      lines,
      churn: changed,
      ...(report ? { crap, functions: functions || [] } : {}),
      score: weight === null ? null : churn.available ? weight * changed : report ? weight : null,
      hasTest: hasNearbyOrImportingTest(relativePath, testFiles, tests),
    });
  }

  rows.sort((a, b) => {
    if ((a.score === null) !== (b.score === null)) {
      return a.score === null ? 1 : -1;
    }

    if (a.score !== null && a.score !== b.score) {
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

function scanTreeSecrets(root, trackedFiles, config, patterns) {
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
  let value = header;

  if (value === "/dev/null") {
    return null;
  }

  const tab = value.indexOf("\t");

  if (tab !== -1) {
    value = value.slice(0, tab);
  }

  value = unquoteGitPath(value);

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
        } else if (!inHunk && line.startsWith("+++ ")) {
          // A file header only appears before the first hunk. Inside one, `+++`
          // is an added line whose content begins `++ ` — content, not a path.
          currentPath = normalizeDiffPath(line.slice(4));
        } else if (line.startsWith("@@")) {
          inHunk = true;
        } else if (inHunk && currentPath && commit && line.startsWith("+")) {
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
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }

  if (pending.length > 0) {
    onLine(pending.toString("utf8"), { continuation: continuing, complete: true });
  }
}

// Best-effort cleanup of a patch directory a hard-killed scan left behind. Only
// this process's prefix and only directories old enough that no running scan
// can still be writing to them; anything that vanished or refuses removal is
// not a scan failure.
function removeStaleHistoryDirectories() {
  let entries;

  try {
    entries = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }

  const cutoff = Date.now() - STALE_HISTORY_TEMP_MS;

  for (const name of entries) {
    if (!name.startsWith(HISTORY_TEMP_PREFIX)) {
      continue;
    }

    const directory = path.join(os.tmpdir(), name);

    try {
      if (fs.statSync(directory).mtimeMs > cutoff) {
        continue;
      }

      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // Left for a later scan, or already gone.
    }
  }
}

function scanHistorySecrets(root, exactPatterns, limit) {
  const startedAt = Date.now();

  if (git(root, ["rev-parse", "--verify", "HEAD"]) === null) {
    return unavailableHistory(startedAt, limit);
  }

  removeStaleHistoryDirectories();

  const parser = createHistoryParser(exactPatterns);
  // A private directory (mkdtemp is 0700 on POSIX) removes both the predictable
  // name in a shared temp dir and the risk of adopting a leftover file.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), HISTORY_TEMP_PREFIX));
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

function buildLargeFiles(lineCounts) {
  const rows = [];

  for (const [relativePath, lines] of lineCounts) {
    if (lines > LARGE_FILE_LINES) {
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
  const { patterns, invalid } = compileSecretPatterns(config);
  const exactPatterns = patterns.filter((pattern) => pattern.precision === "exact");
  const lineCounts = measureCodeLines(root, tracked.files);
  const { report, reason } = freshFunctionReport(root, config);

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
    hotspotRanking: report
      ? { by: "churn × CRAP", heuristic: true, reports: report.reports }
      : { by: "churn × size", heuristic: false, reason },
    hotspots: buildHotspots(lineCounts, churn, testFiles, tests, { root, report }),
    testMap: buildTestMap(stack.codeDirectories, tracked.files, testFiles),
    secrets: {
      tree: {
        available: tracked.available,
        ...scanTreeSecrets(root, tracked.files, config, patterns),
      },
      history: scanHistorySecrets(root, exactPatterns, historyLimit),
      invalid,
    },
    sensitiveFiles: scanSensitiveFiles(tracked.files, config),
    largeFiles: buildLargeFiles(lineCounts),
    // Declarations only: whether a declared scanner actually ran is the
    // `outcome` of its entry in the latest verify evidence, not something a
    // read-only scan can know.
    securityTools: securityTools(root),
  };
}

function securityTools(root) {
  const { declared, undeclared } = securityCoverage(detectSecurityRecipes(root), readConfig(root).validation.security);

  return { declared, undeclared: undeclared.map(({ tool, command }) => ({ tool, command })) };
}

function printRecoveryScan(scan) {
  log(`Recovery scan — ${scan.root}`);
  log(
    `Stack: ${scan.stack.detectedFrameworks.length ? scan.stack.detectedFrameworks.join(", ") : "unknown"}` +
      ` — ${scan.stack.codeDirectories.length} code director${scan.stack.codeDirectories.length === 1 ? "y" : "ies"}` +
      ` — ${scan.durationMs}ms`,
  );
  log("");

  if (!scan.git.available) {
    log("Git: unavailable — tracked files could not be listed. Hotspots, the test map,");
    log("tree secrets, tracked sensitive files and large files were not examined.");
    log("");
  }

  const ranking = scan.hotspotRanking || { by: "churn × size", reason: "no coverage report" };
  log(ranking.reports
    ? `Hotspots — ranked by ${ranking.by} (heuristic, from ${ranking.reports.join(", ")})`
    : `Hotspots — ranked by ${ranking.by} (${ranking.reason})`);
  if (!scan.git.available) {
    log("- unavailable — no tracked files");
  } else if (scan.hotspots.length === 0) {
    log("- none");
  }
  for (const hotspot of scan.hotspots) {
    const churn = hotspot.churn === null ? "churn unavailable" : `churn ${hotspot.churn}`;
    const worst = hotspot.functions && hotspot.functions[0]
      ? `, CRAP ${hotspot.crap} (${hotspot.functions[0].name}:${hotspot.functions[0].line}, ${hotspot.functions[0].length} lines)`
      : "";
    log(`- ${hotspot.path}: ${hotspot.lines} lines, ${churn}${worst}, ${hotspot.hasTest ? "has a test" : "no test"}`);
  }
  log("");

  log("Code directories without tests");
  if (!scan.git.available) {
    log("- unavailable — no tracked files");
  } else if (scan.testMap.withoutTests.length === 0) {
    log("- none");
  }
  for (const directory of scan.testMap.withoutTests) {
    log(`- ${directory}/`);
  }
  log("");

  log("Secrets in the tree");
  if (scan.secrets.invalid.length > 0) {
    log("- invalid secret pattern(s) — these detectors scanned nothing:");
    for (const entry of scan.secrets.invalid) {
      log(`  - ${entry.name}: ${entry.reason}`);
    }
  }
  if (!scan.secrets.tree.available) {
    log("- unavailable — no tracked files");
  } else if (scan.secrets.tree.findings.length === 0) {
    log("- none");
  }
  for (const finding of scan.secrets.tree.findings) {
    log(`- ${finding.name} at ${finding.path}:${finding.line}`);
  }
  if (scan.secrets.tree.available) {
    log(`- skipped: ${scan.secrets.tree.skipped} binary or > 1 MB file(s)`);
  }
  log("");

  const history = scan.secrets.history;
  log(
    `Secrets in history (${history.available ? `${history.commitsScanned} commit(s), ${history.durationMs}ms` : "unavailable"})`,
  );
  if (!history.available) {
    log("- not examined");
  } else if (history.findings.length === 0) {
    log("- none");
  }
  for (const finding of history.findings) {
    log(`- ${finding.name} in ${finding.path} (first ${finding.commit.slice(0, 8)}), ${finding.count} occurrence(s)`);
  }
  log("");

  printTrackedInventory(scan);
}

function printTrackedInventory(scan) {
  log("Tracked sensitive files");
  if (!scan.git.available) {
    log("- unavailable — no tracked files");
  } else if (scan.sensitiveFiles.length === 0) {
    log("- none");
  }
  for (const finding of scan.sensitiveFiles) {
    log(`- ${finding.path} (${finding.kind})`);
  }
  log("");

  log("Security tools (validation.security)");
  if (scan.securityTools.declared.length === 0) {
    log("- none declared — no scanner runs in verify");
  }
  for (const command of scan.securityTools.declared) {
    log(`- declared: ${command}`);
  }
  for (const recipe of scan.securityTools.undeclared) {
    log(`- applies, not declared: ${recipe.tool} (\`${recipe.command}\`)`);
  }
  log("");

  log(`Large files (over ${LARGE_FILE_LINES} lines)`);
  if (!scan.git.available) {
    log("- unavailable — no tracked files");
  } else if (scan.largeFiles.length === 0) {
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

// One findings file (the tracked dossier or the git-ignored local override) into
// blocks. Field lines are fixed for `status` to read, so a block without a
// `State:` is unreadable rather than a finding with a guessed state — and it is
// reported, never dropped. Unknown field lines are ignored on purpose: a human
// may annotate a block without breaking the parse.
function parseFindings(content) {
  const blocks = [];
  const unreadable = [];
  const lines = content.split(/\r?\n/);
  let current = null;

  const close = () => {
    if (!current) {
      return;
    }

    if (!current.state) {
      unreadable.push({ id: current.id, title: current.title, reason: "missing State" });
    } else {
      blocks.push(current);
    }

    current = null;
  };

  for (const line of lines) {
    const heading = FINDINGS_HEADING.exec(line.trim());

    if (heading) {
      close();
      current = { id: heading[1], title: heading[2].trim(), state: null, locations: [] };
      continue;
    }

    if (FINDINGS_HEADING_LOOSE.test(line.trim())) {
      close();
      unreadable.push({ id: null, title: line.trim().replace(/^###\s+/, ""), reason: "heading without an R-NN id" });
      continue;
    }

    if (!current) {
      continue;
    }

    const field = /^-\s*([A-Za-z][A-Za-z ]*?):\s*(.*)$/.exec(line.trim());

    if (!field) {
      continue;
    }

    const name = field[1].trim().toLowerCase();
    const value = field[2].trim();

    if (!FINDING_FIELDS.has(name)) {
      continue;
    }

    if (name === "location") {
      current.locations.push(...value.split(",").map((part) => part.trim()).filter(Boolean));
    } else {
      current[name] = value;
    }
  }

  close();

  // Two blocks with one id in the same file: neither is read, as with a run named
  // by two findings. Keeping either would let a refuted copy hide an open one.
  const seen = new Map();
  for (const block of blocks) {
    seen.set(block.id, (seen.get(block.id) || 0) + 1);
  }
  for (const block of blocks) {
    if (seen.get(block.id) > 1) {
      unreadable.push({ id: block.id, title: block.title, reason: "duplicate id" });
    }
  }

  return { blocks: blocks.filter((block) => seen.get(block.id) === 1), unreadable };
}

function readFindingsFile(file) {
  if (!fs.existsSync(file)) {
    return { present: false, blocks: [], unreadable: [] };
  }

  const content = readTextFileSafely(file);

  if (content === null) {
    return { present: true, blocks: [], unreadable: [{ id: null, title: null, reason: "unreadable file" }] };
  }

  return { present: true, ...parseFindings(content) };
}

// Both files, the local one winning for a given id: a public repository keeps an
// open security finding's trace out of the tracked file, and the tool must read
// the fuller local block once it is there.
function readFindings(root) {
  const tracked = readFindingsFile(path.join(root, RECOVERY_DIR, FINDINGS_FILE));
  const local = readFindingsFile(path.join(root, RECOVERY_LOCAL_DIR, FINDINGS_LOCAL_FILE));
  const byId = new Map();

  for (const block of tracked.blocks) {
    byId.set(block.id, { ...block, source: "tracked" });
  }
  for (const block of local.blocks) {
    byId.set(block.id, { ...block, source: "local" });
  }

  return {
    present: tracked.present || local.present,
    files: { tracked: tracked.present, local: local.present },
    findings: [...byId.values()],
    unreadable: [
      ...tracked.unreadable.map((entry) => ({ ...entry, source: "tracked" })),
      ...local.unreadable.map((entry) => ({ ...entry, source: "local" })),
    ],
  };
}

function severityRank(severity) {
  const first = String(severity || "").trim().toLowerCase().split(/\s+/)[0];
  return SEVERITY_RANK[first] || 0;
}

function isOpen(finding) {
  return OPEN_STATES.has(String(finding.state || "").toLowerCase());
}

// A `Location:` whose file is missing, or whose line is past the end of the file
// as it is now, is a trace that no longer resolves — reported, because a finding
// citing code that moved is exactly the rot `status` exists to catch. A location
// outside the repository is unresolved too: `status` never reads past its root.
function isUnresolvedLocation(root, location) {
  const match = LOCATION_LINE.exec(location);
  const relativePath = (match ? match[1] : location).replace(/\\/g, "/");
  const absolute = path.join(root, relativePath);
  const inside = path.relative(root, absolute);

  const outside = inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside);

  if (outside || !fs.existsSync(absolute)) {
    return true;
  }

  if (!match) {
    return false;
  }

  const content = readTextFileSafely(absolute);

  if (content === null) {
    return false;
  }

  const line = Number(match[2]);
  const total = content.length === 0 ? 0 : content.replace(/\n$/, "").split("\n").length;
  return line > total;
}

// The named verify run's evidence, `ok` and (once story 14-03 lands) red-at-base
// included. Only the tool may call a fix proven: the agent writes `State: fixed`,
// a green, red-at-base verify linked by `Fixed by:` is what makes it true. The
// name must be a bare verify file name: `../` would reach a file outside
// `.coding-flow/runs/`, which the guard does not protect, and forge the proof.
function isFixedProven(root, finding) {
  const name = finding["fixed by"];

  if (!name || path.basename(name) !== name || !name.endsWith("-verify.json")) {
    return false;
  }

  const file = path.join(root, ".coding-flow", "runs", name);

  if (!fs.existsSync(file)) {
    return false;
  }

  const data = readTextFileSafely(file);

  if (data === null) {
    return false;
  }

  let evidence;
  try {
    evidence = JSON.parse(data);
  } catch {
    return false;
  }

  if (evidence.ok !== true) {
    return false;
  }

  return !evidence.redAtBase || evidence.redAtBase.ok === true;
}

// A real `YYYY-MM-DD` day. `Revisit: Q3` or `2026-02-30` is no date at all, and an
// acceptance without a date is forgotten, not accepted.
function isRevisitDate(revisit) {
  const value = String(revisit || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// The read model `status`, `next` and `doctor` share. Pure read: no file is
// written and no repository is touched.
function collectRecovery(root = cwd, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const read = readFindings(root);

  if (!read.present) {
    return { present: false };
  }

  const counts = {};
  const open = [];
  const fixedProven = [];
  const fixedClaimed = [];
  const unresolvedLocations = [];
  const acceptedNoRevisit = [];
  const overdue = [];

  // One finding per fix branch: a run named by several fixed findings proves none
  // of them, or one green run could be pasted under every block.
  const runUses = new Map();
  for (const finding of read.findings) {
    if (String(finding.state || "").toLowerCase() === "fixed" && finding["fixed by"]) {
      runUses.set(finding["fixed by"], (runUses.get(finding["fixed by"]) || 0) + 1);
    }
  }

  for (const finding of read.findings) {
    const state = String(finding.state || "").toLowerCase();
    counts[state] = (counts[state] || 0) + 1;

    if (state === "fixed") {
      const shared = runUses.get(finding["fixed by"]) > 1;
      (!shared && isFixedProven(root, finding) ? fixedProven : fixedClaimed).push(finding.id);
    }

    if (isOpen(finding)) {
      open.push({
        id: finding.id,
        title: finding.title,
        state,
        dimension: finding.dimension ? finding.dimension.toLowerCase() : null,
        severity: severityRank(finding.severity),
        location: finding.locations[0] || null,
      });
    }

    for (const location of finding.locations) {
      if (isUnresolvedLocation(root, location)) {
        unresolvedLocations.push({ id: finding.id, location });
      }
    }

    if (state === "accepted") {
      if (!isRevisitDate(finding.revisit)) {
        acceptedNoRevisit.push(finding.id);
      } else if (finding.revisit < today) {
        overdue.push({ id: finding.id, revisit: finding.revisit });
      }
    }
  }

  open.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));

  return {
    present: true,
    files: read.files,
    counts,
    open,
    fixedProven,
    fixedClaimed,
    unresolvedLocations,
    acceptedNoRevisit,
    revisitOverdue: overdue,
    unreadable: read.unreadable,
  };
}

// Only the tracked dossier counts for the public-repository check: the local
// override exists precisely so an open trace stays out of the tracked file.
function trackedOpenSecurityFindings(root = cwd) {
  const tracked = readFindingsFile(path.join(root, RECOVERY_DIR, FINDINGS_FILE));

  return tracked.blocks.filter(
    (finding) =>
      isOpen(finding) &&
      String(finding.dimension || "").toLowerCase() === "security" &&
      Boolean(finding.trace),
  );
}

module.exports = {
  recoverScan,
  collectRecoveryScan,
  collectRecovery,
  readFindings,
  trackedOpenSecurityFindings,
  DEFAULT_HISTORY_LIMIT,
};
