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
function toRepoRelative(filePath, root) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  const relative = path.relative(root, absolute);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return normalizePortable(relative);
}

// Reads the first report that exists and parses. Returns null when there is
// nothing usable — the caller then keeps the weaker, always-available check
// instead of inventing a verdict.
function loadCoverageReport(root, { candidates = DEFAULT_REPORT_PATHS } = {}) {
  for (const candidate of candidates) {
    const fullPath = path.join(root, candidate);

    if (!fs.existsSync(fullPath)) {
      continue;
    }

    let parsed = null;
    let format = null;

    try {
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

    const files = new Map();

    for (const [filePath, lines] of parsed) {
      const relative = toRepoRelative(filePath, root);

      if (relative) {
        files.set(relative, lines);
      }
    }

    if (files.size === 0) {
      continue;
    }

    let generatedAt = null;
    try {
      generatedAt = fs.statSync(fullPath).mtimeMs;
    } catch {
      generatedAt = null;
    }

    return { path: normalizePortable(candidate), format, files, generatedAt };
  }

  return null;
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

  for (const [file, lines] of Object.entries(changedLinesByFile)) {
    if (lines.length === 0) {
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
  measurePatchCoverage,
  COVERAGE_TIERS,
  coverageTier,
};
