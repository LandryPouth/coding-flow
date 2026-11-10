"use strict";

// Story 14-07: per-function CRAP and length from an lcov report, in any language
// whose coverage tool emits one. Used twice: `recover scan` ranks hotspots by
// churn × CRAP, and `verify` reports a touched function that got riskier or
// longer (`complexity-grew`).
//
// Everything here is a heuristic, and says so in every output: a function ends at
// its closing brace in C-like sources, else where the next `FN` starts; decision
// points are the distinct `BRDA` lines inside it, plus one; coverage is the hit
// share of its `DA` lines. V8 block coverage only approximates decisions.
//
// The values at the base are not measured at the base: they are the values now,
// minus what the diff added inside the function (its lines, its branch lines),
// plus the lines it removed there — the same estimate story 13-06's ratchet made.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { loadCoverageReports, reportCandidates, toRepoRelative, packageRootOf } = require("./coverage");
const { currentDiffBase } = require("./diff-scope");

const CRAP_THRESHOLD = 30;
const DEFAULT_MAX_LINES = 80;
// Sources whose functions close with a brace: their end is found by matching it.
const BRACE_SOURCE = /\.(c|m)?(j|t)sx?$|\.(c|cc|cpp|cxx|h|hpp|cs|java|kt|kts|go|rs|swift|scala|dart|php)$/;
const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^";

function crapScore(decisions, coverage) {
  return Math.round((decisions * decisions * (1 - coverage) ** 3 + decisions) * 10) / 10;
}

// --- lcov: SF -> { functions, branchLines, lines } --------------------------------

// `FN:<start>,<name>` (lcov 1) and `FN:<start>,<end>,<name>` (lcov 2, coverage.py).
function parseFunctionRecord(record) {
  const withEnd = /^(\d+),(\d+),(.*)$/.exec(record);
  const plain = /^(\d+),(.*)$/.exec(record);

  if (withEnd) {
    return { line: Number(withEnd[1]), end: Number(withEnd[2]), name: withEnd[3] };
  }

  return plain ? { line: Number(plain[1]), end: null, name: plain[2] } : null;
}

function parseLcovFunctions(content) {
  const files = new Map();
  let current = null;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const [tag, value = ""] = [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)];

    if (line.startsWith("SF:")) {
      current = files.get(value.trim()) || { functions: [], branchLines: new Set(), lines: new Map() };
      files.set(value.trim(), current);
    } else if (line === "end_of_record") {
      current = null;
    } else if (current && tag === "FN") {
      const fn = parseFunctionRecord(value);
      if (fn) current.functions.push(fn);
    } else if (current && tag === "BRDA") {
      current.branchLines.add(Number.parseInt(value, 10));
    } else if (current && tag === "DA") {
      const [lineNumber, hits] = value.split(",").map((part) => Number.parseInt(part, 10));
      current.lines.set(lineNumber, Math.max(current.lines.get(lineNumber) || 0, Number.isFinite(hits) ? hits : 0));
    }
  }

  return files;
}

// The fresh lcov reports among the project's coverage candidates, re-read for the
// records `parseLcov` drops on purpose. Null when none lists a function.
function loadFunctionReport(root, { config, since = null } = {}) {
  const found = loadCoverageReports(root, { candidates: reportCandidates(root, config.coverageReports), since });
  const files = new Map();
  const reports = [];

  for (const report of found ? found.reports.filter((item) => item.format === "lcov") : []) {
    const full = path.join(root, report.path);
    const base = packageRootOf(root, full);

    for (const [file, data] of parseLcovFunctions(fs.readFileSync(full, "utf8"))) {
      const relative = toRepoRelative(file, root, base);

      if (relative && data.functions.length > 0) {
        files.set(relative, data);
      }
    }

    reports.push(report.path);
  }

  return files.size > 0 ? { reports, files, generatedAt: found.generatedAt } : null;
}

// --- brace matching: the code characters of a C-like source ---------------------

function skipQuoted(text, from) {
  let i = from + 1;

  while (i < text.length && text[i] !== text[from] && text[i] !== "\n") {
    i += text[i] === "\\" ? 2 : 1;
  }

  return i + 1;
}

function skipInterpolation(text, from) {
  let depth = 1;
  let i = from;

  while (i < text.length && depth > 0) {
    if (text[i] === '"' || text[i] === "'") {
      i = skipQuoted(text, i);
      continue;
    }

    if (text[i] === "`") {
      i = skipTemplate(text, i);
      continue;
    }

    depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
    i += 1;
  }

  return i;
}

function skipTemplate(text, from) {
  let i = from + 1;

  while (i < text.length && text[i] !== "`") {
    if (text[i] === "$" && text[i + 1] === "{") {
      i = skipInterpolation(text, i + 2);
    } else {
      i += text[i] === "\\" ? 2 : 1;
    }
  }

  return i + 1;
}

function skipRegex(text, from) {
  let i = from + 1;
  let inClass = false;

  while (i < text.length && text[i] !== "\n" && (inClass || text[i] !== "/")) {
    inClass = text[i] === "[" ? true : text[i] === "]" ? false : inClass;
    i += text[i] === "\\" ? 2 : 1;
  }

  return i + 1;
}

// Yields `[char, index]` for the code only: comments, strings, templates and
// regular expression literals are skipped whole.
function* codeChars(text, from) {
  let previous = "";
  let i = from;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "/" && next === "/") {
      i = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
    } else if (ch === "/" && next === "*") {
      i = text.indexOf("*/", i + 2) < 0 ? text.length : text.indexOf("*/", i + 2) + 2;
    } else if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i);
      previous = ch;
    } else if (ch === "`") {
      i = skipTemplate(text, i);
      previous = ch;
    } else if (ch === "/" && (previous === "" || REGEX_AFTER.includes(previous))) {
      i = skipRegex(text, i);
      previous = "/";
    } else {
      yield [ch, i];
      previous = /\s/.test(ch) ? previous : ch;
      i += 1;
    }
  }
}

// Where a function's body starts, from its first character: the index of the
// `{` that opens it, or null when it has none (an expression-bodied arrow, a
// declaration). Braces inside the parameter list do not open the body.
function bodyStart(text, from) {
  let parens = 0;
  let last = "";
  let word = "";
  let afterArrow = false;

  for (const [ch, index] of codeChars(text, from)) {
    word = /[\w$]/.test(ch) ? word + ch : "";

    if (/\s/.test(ch)) {
      continue;
    }

    if (afterArrow && ch === "{") {
      return index;
    }

    if (afterArrow && parens === 0) {
      return null;
    }

    // An inline callback starts mid-line: what came before it is not its parameters.
    parens = word === "function" ? 0 : parens;

    if (ch === "{" && parens === 0) {
      return index;
    }

    if (ch === ";" && parens === 0) {
      return null;
    }

    afterArrow = ch === ">" && last === "=";
    parens += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    last = ch;
  }

  return null;
}

// The index of the `}` closing the body that opens at `open`.
function bodyEnd(text, open) {
  let braces = 0;

  for (const [ch, index] of codeChars(text, open)) {
    braces += ch === "{" ? 1 : ch === "}" ? -1 : 0;

    if (braces === 0) {
      return index;
    }
  }

  return open;
}

function lineStarts(text) {
  const starts = [0];

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }

  return starts;
}

function lineOf(starts, index) {
  let low = 0;
  let high = starts.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);

    if (starts[mid] <= index) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low + 1;
}

// --- one function: where it ends, how long, how risky ---------------------------

const indentOf = (line) => line.length - line.trimStart().length;

// The last line of a function. lcov 2 says; a C-like source closes it with a
// brace (nested callbacks included, as the 13-06 ratchet measured); otherwise the
// next function's start bounds it, cut earlier at the first line indented no
// deeper than the definition (Python's `class` between two methods), trailing
// blank lines left out.
function functionEnd(source, fn, nextStart) {
  if (fn.end) {
    return fn.end;
  }

  const open = source.braces ? bodyStart(source.text, source.starts[fn.line - 1] || 0) : null;

  if (open !== null) {
    return lineOf(source.starts, bodyEnd(source.text, open));
  }

  const depth = indentOf(source.lines[fn.line - 1] || "");
  let end = Math.min(nextStart - 1, source.lineCount);

  for (let line = fn.line + 1; line <= end; line++) {
    const text = source.lines[line - 1];

    if (text.trim() && indentOf(text) <= depth) {
      end = line - 1;
    }
  }

  while (end > fn.line && !source.lines[end - 1].trim()) {
    end -= 1;
  }

  return end;
}

function readSource(root, file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const lines = text.split("\n");
  const lineCount = lines.length - (text.endsWith("\n") ? 1 : 0);

  return { text, lines, lineCount, starts: lineStarts(text), braces: BRACE_SOURCE.test(file) };
}

// Decision points and coverage over [start, end], leaving out `skip` lines (what
// the diff added, when estimating the base).
function riskOver(data, start, end, skip = new Set()) {
  let branches = 0;
  let total = 0;
  let hit = 0;

  for (const line of data.branchLines) {
    branches += line >= start && line <= end && !skip.has(line) ? 1 : 0;
  }

  for (const [line, hits] of data.lines) {
    if (line >= start && line <= end && !skip.has(line)) {
      total += 1;
      hit += hits > 0 ? 1 : 0;
    }
  }

  const coverage = total === 0 ? 0 : hit / total;

  return { decisions: branches + 1, coverage, crap: crapScore(branches + 1, coverage) };
}

// Every function of one file, measured now: `[{ name, line, end, length, decisions, coverage, crap }]`.
function measureFile(root, file, data) {
  const source = readSource(root, file);
  const functions = [...data.functions].sort((a, b) => a.line - b.line);

  return functions.map((fn, index) => {
    const next = functions.slice(index + 1).find((other) => other.line > fn.line);
    const end = Math.max(fn.line, functionEnd(source, fn, next ? next.line : source.lineCount + 1));

    return { name: fn.name, line: fn.line, end, length: end - fn.line + 1, ...riskOver(data, fn.line, end) };
  });
}

// --- verify: what the diff did to the functions it touched ----------------------

// `git diff -U0 <base>`: file -> hunks `{ oldCount, newStart, newCount }`. A new,
// untracked file is added in full.
function diffHunks(root, base) {
  const byFile = new Map();
  let current = null;
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 });

  for (const line of git(["-c", "core.quotepath=false", "diff", "-U0", "--no-color", "--no-renames", base]).split(/\r?\n/)) {
    const file = /^\+\+\+ b\/([^\t]+)/.exec(line);
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);

    if (line === "+++ /dev/null") {
      current = null;
    } else if (file) {
      current = file[1];
      byFile.set(current, []);
    } else if (hunk && current) {
      byFile.get(current).push({
        oldCount: hunk[1] === undefined ? 1 : Number(hunk[1]),
        newStart: Number(hunk[2]),
        newCount: hunk[3] === undefined ? 1 : Number(hunk[3]),
      });
    }
  }

  for (const file of git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean)) {
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n").length;
    byFile.set(file, [{ oldCount: 0, newStart: 1, newCount: lines }]);
  }

  return byFile;
}

// Lines the diff added inside [start, end], and how many it removed there.
function churnIn(hunks, start, end) {
  const added = new Set();
  let removed = 0;

  for (const { oldCount, newStart, newCount } of hunks) {
    for (let line = Math.max(newStart, start); line <= Math.min(newStart + newCount - 1, end); line++) {
      added.add(line);
    }

    const inside = newCount > 0 ? newStart >= start && newStart <= end : newStart >= start && newStart < end;
    removed += inside ? oldCount : 0;
  }

  return { added, removed };
}

// One touched function, before and after; null when it did not cross a line.
function grewPastLine(file, fn, data, hunks, max) {
  const { added, removed } = churnIn(hunks, fn.line, fn.end);

  if (added.size === 0) {
    return null;
  }

  const before = { length: fn.length - added.size + removed, crap: riskOver(data, fn.line, fn.end, added).crap };
  const longer = fn.length > max && (before.length <= max || fn.length > before.length);
  const riskier = fn.crap > CRAP_THRESHOLD && before.crap <= CRAP_THRESHOLD;

  if (!longer && !riskier) {
    return null;
  }

  return {
    file,
    line: fn.line,
    name: fn.name,
    length: { before: before.length, after: fn.length },
    crap: { before: before.crap, after: fn.crap },
    reasons: [...(longer ? ["length"] : []), ...(riskier ? ["crap"] : [])],
  };
}

// The `complexity-grew` signal: functions overlapping the diff's added lines whose
// CRAP crosses 30, or whose length crosses `functionSize.max` or grows while above
// it. Null when this run wrote no lcov listing functions: no report, no signal.
// A warning unless `functionSize.enforce: true`.
function evaluateComplexity({ root, config, since }) {
  const report = loadFunctionReport(root, { config, since });

  if (!report) {
    return null;
  }

  const size = config.functionSize || {};
  const max = Number.isInteger(size.max) && size.max > 0 ? size.max : DEFAULT_MAX_LINES;
  const enforced = size.enforce === true;
  const mergeBase = currentDiffBase(root).mergeBase;
  const items = [];
  let hunksByFile = new Map();

  try {
    hunksByFile = diffHunks(root, mergeBase || "HEAD");
  } catch {
    // No commit to diff against: nothing was touched, so nothing grew.
  }

  for (const [file, hunks] of hunksByFile) {
    if (!report.files.has(file) || !fs.existsSync(path.join(root, file))) {
      continue;
    }

    for (const fn of measureFile(root, file, report.files.get(file))) {
      const item = grewPastLine(file, fn, report.files.get(file), hunks, max);
      if (item) items.push(item);
    }
  }

  return {
    signal: "complexity-grew",
    heuristic: true,
    enforced,
    max,
    crapThreshold: CRAP_THRESHOLD,
    reports: report.reports,
    items,
    ok: !(enforced && items.length > 0),
  };
}

// `src/a.js:12 build 85→90 lines, CRAP 12→45` — the reasons it was listed.
function describeGrowth(item) {
  const parts = [
    ...(item.reasons.includes("length") ? [`${item.length.before}→${item.length.after} lines`] : []),
    ...(item.reasons.includes("crap") ? [`CRAP ${item.crap.before}→${item.crap.after}`] : []),
  ];

  return `${item.file}:${item.line} ${item.name} ${parts.join(", ")}`;
}

module.exports = {
  CRAP_THRESHOLD,
  DEFAULT_MAX_LINES,
  crapScore,
  parseLcovFunctions,
  loadFunctionReport,
  measureFile,
  evaluateComplexity,
  describeGrowth,
};
