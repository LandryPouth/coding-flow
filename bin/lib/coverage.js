"use strict";

// Line-level coverage of a change. The coverage gate in `harness.js` starts from
// a cheap question — "did a test file move?" — and this module answers the real
// one: are the lines this change ADDED actually executed by the suite that just
// ran?
//
// That is the difference between "a test exists somewhere in this repo" and "the
// code you just wrote is covered", and it is the last link in the chain the tool
// claims: a green run whose new lines nothing executes is not proof of anything.
//
// Two formats, no dependency: LCOV (`lcov.info` — emitted by c8, nyc, jest,
// vitest, pytest-cov, simplecov, grcov…) and Istanbul JSON (`coverage-final.json`
// — what jest writes by default). Between them they cover most of what a project
// is likely to already produce. Anything else, and the gate falls back to the
// test-file heuristic rather than guessing.

const fs = require("fs");
const path = require("path");

const { normalizePortable, readJson } = require("./util");

// Where coverage tools put their output, in the order we trust them. Not
// configurable by accident: `coverageReports` in harness.json overrides it.
const DEFAULT_REPORT_PATHS = [
  "coverage/lcov.info",
  "coverage/lcov/lcov.info",
  "lcov.info",
  "coverage/coverage-final.json",
  "coverage/coverage.json",
  ".coverage/lcov.info",
];

// --- LCOV -----------------------------------------------------------------
//
// The only records we need: SF (source file) opens a section, DA (line,hits)
// gives per-line execution, end_of_record closes it. Everything else — function
// and branch records, checksums — is ignored on purpose.
function parseLcov(content) {
  const files = new Map();
  let current = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("SF:")) {
      current = line.slice(3).trim();

      if (!files.has(current)) {
        files.set(current, new Map());
      }
      continue;
    }

    if (line === "end_of_record") {
      current = null;
      continue;
    }

    if (!current || !line.startsWith("DA:")) {
      continue;
    }

    const [lineNumber, hits] = line
      .slice(3)
      .split(",")
      .map((value) => Number.parseInt(value, 10));

    if (!Number.isFinite(lineNumber)) {
      continue;
    }

    // A line can appear more than once (multiple statements on it). Executed
    // once is executed.
    const previous = files.get(current).get(lineNumber) || 0;
    files.get(current).set(lineNumber, Math.max(previous, Number.isFinite(hits) ? hits : 0));
  }

  return files;
}

// --- Istanbul JSON --------------------------------------------------------
//
// { "<abs path>": { statementMap: { "0": { start: { line } } }, s: { "0": hits } } }
// A statement spanning several lines counts for its first line, which is what
// every consumer of this format does.
function parseIstanbulJson(data) {
  const files = new Map();

  if (!data || typeof data !== "object") {
    return files;
  }

  for (const [filePath, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object" || !entry.statementMap || !entry.s) {
      continue;
    }

    const lines = new Map();

    for (const [id, statement] of Object.entries(entry.statementMap)) {
      const line = statement && statement.start ? statement.start.line : null;

      if (!Number.isFinite(line)) {
        continue;
      }

      const hits = Number.isFinite(entry.s[id]) ? entry.s[id] : 0;
      lines.set(line, Math.max(lines.get(line) || 0, hits));
    }

    if (lines.size > 0) {
      files.set(filePath, lines);
    }
  }

  return files;
}

// Absolute or tool-relative paths, normalised to repo-relative so they can be
// compared with what git reports. A path we cannot bring inside the repo is
// dropped: matching it by basename would silently credit one file's coverage to
// another with the same name.
function toRepoRelative(filePath, root, base = root) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(base, filePath);
  const relative = path.relative(root, absolute);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return normalizePortable(relative);
}

// --- locating reports ---------------------------------------------------------

// What a monorepo's packages usually write, tried in addition to the root-level
// defaults when the project is a workspace and `coverageReports` is not set.
const WORKSPACE_REPORT_PATHS = ["*/*/coverage/lcov.info", "*/*/coverage/coverage-final.json"];

const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

// How many directories a `**` may descend: bounded so a stray pattern cannot walk a huge tree.
const MAX_GLOBSTAR_DEPTH = 6;

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !SKIPPED_DIRS.has(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function segmentRegExp(segment) {
  const source = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${source}$`);
}

// Expands one configured entry to the report files it names. `*` and `?` match
// within a segment, `**` any number of directories; a plain path is itself.
// Hand-rolled over readdir because the tool takes no dependency.
function expandReportPattern(root, pattern) {
  const segments = normalizePortable(pattern).split("/").filter(Boolean);
  const found = [];

  const walk = (dir, index, depth = 0) => {
    if (index === segments.length) {
      return;
    }

    const segment = segments[index];
    const last = index === segments.length - 1;

    if (segment === "**") {
      walk(dir, index + 1, depth);
      if (depth < MAX_GLOBSTAR_DEPTH) {
        for (const child of listDirs(dir)) {
          walk(path.join(dir, child), index, depth + 1);
        }
      }
      return;
    }

    if (last) {
      if (!/[*?]/.test(segment)) {
        const full = path.join(dir, segment);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          found.push(full);
        }
        return;
      }

      const matcher = segmentRegExp(segment);
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile() && matcher.test(entry.name)) {
            found.push(path.join(dir, entry.name));
          }
        }
      } catch {
        // unreadable directory: no reports there
      }
      return;
    }

    if (!/[*?]/.test(segment)) {
      walk(path.join(dir, segment), index + 1);
      return;
    }

    const matcher = segmentRegExp(segment);
    for (const child of listDirs(dir)) {
      if (matcher.test(child)) {
        walk(path.join(dir, child), index + 1);
      }
    }
  };

  walk(root, 0);
  return found;
}

// A workspace root: `workspaces` in package.json, or a pnpm-workspace.yaml.
function isWorkspaceRoot(root) {
  if (fs.existsSync(path.join(root, "pnpm-workspace.yaml"))) {
    return true;
  }

  const manifest = readJson(path.join(root, "package.json"), null);
  return Boolean(manifest && manifest.workspaces);
}

// The directory a report's relative `SF:` paths are relative to: the nearest
// ancestor of the report holding a package.json (jest and vitest write paths
// relative to the package they ran in), else the parent of its `coverage/`.
function packageRootOf(root, reportPath) {
  const reportDir = path.dirname(reportPath);
  const segments = path.relative(root, reportDir).split(path.sep).filter(Boolean);
  const at = Math.max(segments.lastIndexOf("coverage"), segments.lastIndexOf(".coverage"));

  // The package is the directory that holds `coverage/`. A manifest-less
  // directory must not be credited to the repo root just because the root has a
  // package.json: that maps its SF paths onto the wrong files.
  const holder = at >= 0 ? path.join(root, ...segments.slice(0, at)) : reportDir;

  for (let dir = holder; dir.startsWith(root + path.sep) || dir === root; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json")) && (dir === holder || dir !== root)) {
      return dir;
    }

    if (dir === root) {
      break;
    }
  }

  return holder;
}

// Nearest package.json directory above a changed file, repo-relative ("" = root).
function packageOfFile(root, file) {
  let dir = path.dirname(path.join(root, file));

  while (dir.startsWith(root + path.sep)) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return normalizePortable(path.relative(root, dir));
    }
    dir = path.dirname(dir);
  }

  return "";
}

// Reads every fresh, parseable report the candidates name — not just the first:
// a monorepo writes one per package, and each has to be read against its own
// package root. Files reported twice merge by max hits. Returns null when there
// is nothing usable; the caller then keeps the weaker, always-available check
// instead of inventing a verdict. A report written before `since` is ignored on
// its own, so one stale package does not discard the others.
function loadCoverageReports(root, { candidates, since = null } = {}) {
  const patterns = candidates || DEFAULT_REPORT_PATHS;
  const paths = [];
  let realRoot = root;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    // keep root as given
  }

  const confined = (full) => {
    try {
      const real = fs.realpathSync(full);
      return real === realRoot || real.startsWith(realRoot + path.sep);
    } catch {
      return false;
    }
  };

  for (const pattern of patterns) {
    if (normalizePortable(pattern).split("/").includes("..")) {
      continue;
    }

    for (const full of expandReportPattern(root, pattern)) {
      if (!paths.includes(full) && confined(full)) {
        paths.push(full);
      }
    }
  }

  const reports = [];
  const readDirs = new Set();
  const merged = new Map();
  const packageRoots = [];
  let generatedAt = null;

  for (const fullPath of paths) {
    let parsed = null;
    let format = null;
    let mtime = null;

    // Jest writes lcov.info AND coverage-final.json side by side: one report per
    // directory, the first format in candidate order, as before.
    if (readDirs.has(path.dirname(fullPath))) {
      continue;
    }

    try {
      mtime = fs.statSync(fullPath).mtimeMs;

      if (since && mtime < since) {
        continue;
      }

      if (fullPath.endsWith(".json")) {
        parsed = parseIstanbulJson(readJson(fullPath, null));
        format = "istanbul-json";
      } else {
        parsed = parseLcov(fs.readFileSync(fullPath, "utf8"));
        format = "lcov";
      }
    } catch {
      continue;
    }

    if (!parsed || parsed.size === 0) {
      continue;
    }

    readDirs.add(path.dirname(fullPath));
    const base = packageRootOf(root, fullPath);
    const files = new Map();

    for (const [filePath, lines] of parsed) {
      const relative = toRepoRelative(filePath, root, base);

      if (relative) {
        files.set(relative, lines);
      }
    }

    if (files.size === 0) {
      continue;
    }

    for (const [file, lines] of files) {
      const into = merged.get(file) || new Map();
      for (const [line, hits] of lines) {
        into.set(line, Math.max(into.get(line) || 0, hits));
      }
      merged.set(file, into);
    }

    const packageRoot = normalizePortable(path.relative(root, base));
    if (!packageRoots.includes(packageRoot)) {
      packageRoots.push(packageRoot);
    }

    generatedAt = generatedAt === null ? mtime : Math.min(generatedAt, mtime);
    reports.push({
      path: normalizePortable(path.relative(root, fullPath)),
      format,
      package: packageRoot,
      files: files.size,
    });
  }

  if (reports.length === 0) {
    return null;
  }

  return {
    path: reports[0].path,
    format: reports[0].format,
    files: merged,
    generatedAt,
    reports,
    packageRoots,
  };
}

// The configured entries, plus the workspace defaults when the key was never
// set. `init` writes the default list into harness.json, so "never customised"
// means absent OR identical to the defaults.
function reportCandidates(root, configured) {
  const customised =
    Array.isArray(configured) &&
    configured.length > 0 &&
    JSON.stringify(configured) !== JSON.stringify(DEFAULT_REPORT_PATHS);

  if (customised) {
    return configured;
  }

  return isWorkspaceRoot(root) ? [...DEFAULT_REPORT_PATHS, ...WORKSPACE_REPORT_PATHS] : DEFAULT_REPORT_PATHS;
}

// Kept for callers that want one answer: the merged view of every report.
function loadCoverageReport(root, { candidates = DEFAULT_REPORT_PATHS, since = null } = {}) {
  return loadCoverageReports(root, { candidates, since });
}

// The extensions this report actually knows about. Used to decide whether a
// changed file's ABSENCE from the report means "untested" or "not this tool's
// business": a Python report says nothing about a .go file, but a JS report that
// omits a brand-new .ts file is telling us that nothing imported it — which is
// exactly the case worth catching.
function coveredExtensions(report) {
  const extensions = new Set();

  for (const file of report.files.keys()) {
    const ext = path.extname(file);

    if (ext) {
      extensions.add(ext);
    }
  }

  return extensions;
}

// Patch coverage: of the lines this change added, how many does the report show
// as executed. Files the report cannot speak about are excluded entirely rather
// than counted as zero.
function measurePatchCoverage({ report, changedLinesByFile }) {
  const extensions = coveredExtensions(report);
  const uncovered = [];
  let totalLines = 0;
  let coveredLines = 0;
  const skippedFiles = [];
  const unmeasured = [];
  const packageRoots = report.packageRoots;

  for (const [file, lines] of Object.entries(changedLinesByFile)) {
    if (lines.length === 0) {
      continue;
    }

    // Outside every loaded report's package: nobody measured it, so it is
    // neither covered nor uncovered. Never extrapolate one package to another.
    // "Inside" is containment: a root-level report speaks for every package under it.
    const insideARoot = (packageRoots || []).some(
      (pkg) => pkg === "" || file === pkg || file.startsWith(`${pkg}/`),
    );

    if (packageRoots && !report.files.has(file) && !insideARoot) {
      unmeasured.push(file);
      continue;
    }

    const fileCoverage = report.files.get(file);

    if (!fileCoverage) {
      // Absent from the report. Only meaningful for a language the report covers.
      if (!extensions.has(path.extname(file))) {
        skippedFiles.push(file);
        continue;
      }

      totalLines += lines.length;
      uncovered.push({ file, lines: lines.slice(0, 20), absentFromReport: true });
      continue;
    }

    const missed = [];

    for (const line of lines) {
      const hits = fileCoverage.get(line);

      // A changed line with no entry in the report is not executable (a blank
      // line, a comment, a closing brace) and must not count against the change.
      if (hits === undefined) {
        continue;
      }

      totalLines += 1;

      if (hits > 0) {
        coveredLines += 1;
      } else {
        missed.push(line);
      }
    }

    if (missed.length > 0) {
      uncovered.push({ file, lines: missed.slice(0, 20) });
    }
  }

  return {
    totalLines,
    coveredLines,
    percent: totalLines === 0 ? null : Math.round((coveredLines / totalLines) * 1000) / 10,
    uncovered,
    skippedFiles,
    unmeasured,
  };
}

// --- naming the strength of the proof ---------------------------------------

// The gate has always had three rungs, but only the JSON carried them, so the
// human output printed "1 test file(s) changed" and "92% of the added lines are
// executed" in the same voice. They are not the same claim: one is a
// measurement, the other is a proxy for one. A tool whose entire argument is
// that asserted proof and executed proof differ cannot afford to blur that
// distinction in its own report.
//
//   verified      the added lines were measured and enough of them ran
//   evidence      a test file moved alongside the change; nobody measured it
//   exempted      a human wrote down why this change ships without a test
//   not-required  nothing behavioural changed, or the risk never reached the bar
//   missing       proof was owed and none was supplied — the run is blocked
//
// Derived from the result rather than stored on it, so evidence written by an
// older version is named correctly when `ship` or `audit` reads it back.
const COVERAGE_TIERS = ["verified", "evidence", "exempted", "not-required", "missing"];

function coverageTier(coverage) {
  if (!coverage || coverage.required === false) {
    return "not-required";
  }

  if (!coverage.ok) {
    return "missing";
  }

  // An exemption outranks the mode that produced it: a declared reason is what
  // carried the change, whether or not lines were measured on the way there.
  if (coverage.exemption) {
    return "exempted";
  }

  if (coverage.mode === "diff-lines") {
    return "verified";
  }

  // mode "none" means the diff held no behaviour file to prove anything about.
  return coverage.mode === "test-file" ? "evidence" : "not-required";
}

module.exports = {
  DEFAULT_REPORT_PATHS,
  parseLcov,
  parseIstanbulJson,
  loadCoverageReport,
  loadCoverageReports,
  reportCandidates,
  packageOfFile,
  measurePatchCoverage,
  COVERAGE_TIERS,
  coverageTier,
};
