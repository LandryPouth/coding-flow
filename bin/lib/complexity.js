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
// The length at the base is measured in the base file (`git show`), the function
// found there by mapping its start through the diff's hunks. CRAP at the base is
// estimated — there is no base coverage — over the lines the diff did not add.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { loadCoverageReports, reportCandidates, toRepoRelative, packageRootOf } = require("./coverage");
const { currentDiffBase } = require("./diff-scope");

const CRAP_THRESHOLD = 30;
const DEFAULT_MAX_LINES = 80;
// Sources whose functions close with a brace: their end is found by matching it.
// Kotlin, Scala, Swift and Rust are left out: expression bodies (`fun a() = 1`)
// and lifetimes (`'a`) break the matching, so the next `FN` bounds them instead.
const BRACE_SOURCE = /\.(c|m)?(j|t)sx?$|\.(c|cc|cpp|cxx|h|hpp|cs|java|go|dart|php)$/;
const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^";
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "void", "yield", "await", "throw", "delete", "new"]);
// V8 lists a class's field initializers as a function starting at the class line:
// measured by its braces, the whole class would read as one function.
const SYNTHETIC_FUNCTION = /^<[a-z_]+>$/;

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
      current = files.get(value.trim()) || emptyFile();
      files.set(value.trim(), current);
    } else if (line === "end_of_record") {
      current = null;
    } else if (current && tag === "FN") {
      addFunction(current, parseFunctionRecord(value));
    } else if (current && tag === "BRDA") {
      current.branchLines.add(Number.parseInt(value, 10));
    } else if (current && tag === "DA") {
      const [lineNumber, hits] = value.split(",").map((part) => Number.parseInt(part, 10));
      current.lines.set(lineNumber, Math.max(current.lines.get(lineNumber) || 0, Number.isFinite(hits) ? hits : 0));
    }
  }

  return files;
}

function emptyFile() {
  return { functions: [], branchLines: new Set(), lines: new Map() };
}

// A function listed twice (two `SF` sections, two reports) is one function.
function addFunction(data, fn) {
  if (fn && !SYNTHETIC_FUNCTION.test(fn.name) && !data.functions.some((other) => other.line === fn.line && other.name === fn.name)) {
    data.functions.push(fn);
  }
}

function mergeFile(into, data) {
  data.functions.forEach((fn) => addFunction(into, fn));
  data.branchLines.forEach((line) => into.branchLines.add(line));

  for (const [line, hits] of data.lines) {
    into.lines.set(line, Math.max(into.lines.get(line) || 0, hits));
  }

  return into;
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
        files.set(relative, mergeFile(files.get(relative) || emptyFile(), data));
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
  let word = "";
  let i = from;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    const regexMayStart = previous === "" || REGEX_AFTER.includes(previous) || REGEX_AFTER_WORD.has(word);

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
    } else if (ch === "/" && regexMayStart) {
      i = skipRegex(text, i);
      previous = "/";
      word = "";
    } else {
      yield [ch, i];
      word = /[\w$]/.test(ch) ? (/[\w$]/.test(previous) && !/\s/.test(text[i - 1] || "") ? word + ch : ch) : /\s/.test(ch) ? word : "";
      previous = /\s/.test(ch) ? previous : ch;
      i += 1;
    }
  }
}

// Where a function's body starts, from its first character: the index of the
// `{` that opens it, or null when it has none (an expression-bodied arrow, a
// declaration). Braces inside the parameter list, a generic (`<T extends {…}>`)
// or a TypeScript return type (`): { a: number } {`) do not open the body.
function bodyStart(text, from) {
  let parens = 0;
  let angles = 0;
  let typeBraces = 0;
  let last = "";
  let word = "";
  let afterArrow = false;

  for (const [ch, index] of codeChars(text, from)) {
    word = /[\w$]/.test(ch) ? word + ch : "";

    if (/\s/.test(ch)) {
      continue;
    }

    if (typeBraces > 0) {
      typeBraces += ch === "{" ? 1 : ch === "}" ? -1 : 0;
      last = ch;
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

    if (ch === "{" && parens === 0 && angles === 0 && ":|&,".includes(last)) {
      typeBraces = 1;
      continue;
    }

    if (ch === "{" && parens === 0 && angles === 0) {
      return index;
    }

    if (ch === ";" && parens === 0) {
      return null;
    }

    afterArrow = ch === ">" && last === "=";
    angles += parens === 0 && ch === "<" ? 1 : parens === 0 && ch === ">" && last !== "=" && angles > 0 ? -1 : 0;
    parens += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    last = ch;
  }

  return null;
}

// The index of the `}` closing the body that opens at `open`; null when it never
// closes (the scan went wrong), so the caller falls back to the next `FN`.
function bodyEnd(text, open) {
  let braces = 0;

  for (const [ch, index] of codeChars(text, open)) {
    braces += ch === "{" ? 1 : ch === "}" ? -1 : 0;

    if (braces === 0) {
      return index;
    }
  }

  return null;
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
  const close = open === null ? null : bodyEnd(source.text, open);

  if (close !== null) {
    return lineOf(source.starts, close);
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

function readSource(root, file, text = fs.readFileSync(path.join(root, file), "utf8")) {
  const lines = text.split("\n");
  const lineCount = lines.length - (text.endsWith("\n") ? 1 : 0);

  return { text, lines, lineCount, starts: lineStarts(text), braces: BRACE_SOURCE.test(file) };
}

// Decision points and coverage over [start, end], leaving out `skip` lines (what
// the diff added, when estimating the base).
// V8 writes a BRDA at every function's entry: a function start is not a decision.
function riskOver(data, start, end, skip = new Set()) {
  let branches = 0;
  let total = 0;
  let hit = 0;
  const entries = new Set(data.functions.map((fn) => fn.line));

  for (const line of data.branchLines) {
    branches += line >= start && line <= end && !skip.has(line) && !entries.has(line) ? 1 : 0;
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

  const nextStarts = [];

  for (let index = functions.length - 1, next = source.lineCount + 1; index >= 0; index--) {
    nextStarts[index] = next;
    next = functions[index].line < next ? functions[index].line : next;
  }

  return functions.map((fn, index) => {
    const end = Math.max(fn.line, functionEnd(source, fn, nextStarts[index]));

    return {
      name: fn.name, line: fn.line, end, declaredEnd: fn.end, next: nextStarts[index], length: end - fn.line + 1, ...riskOver(data, fn.line, end),
    };
  });
}

// --- verify: what the diff did to the functions it touched ----------------------

function gitIn(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 });
}

// `git diff -U0 <base>`, renames followed: new path -> `{ oldPath, hunks }`, hunks
// `{ oldStart, oldCount, newStart, newCount }`. Paths are relative to `root`.
function parseDiff(output) {
  const byFile = new Map();
  let oldPath = null;
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    const from = /^--- (?:a\/([^\t]+)|\/dev\/null)/.exec(line);
    const to = /^\+\+\+ b\/([^\t]+)/.exec(line);
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);

    if (from) {
      oldPath = from[1] || null;
    } else if (line === "+++ /dev/null") {
      current = null;
    } else if (to) {
      current = { oldPath, hunks: [] };
      byFile.set(to[1], current);
    } else if (hunk && current) {
      current.hunks.push({
        oldStart: Number(hunk[1]),
        oldCount: hunk[2] === undefined ? 1 : Number(hunk[2]),
        newStart: Number(hunk[3]),
        newCount: hunk[4] === undefined ? 1 : Number(hunk[4]),
      });
    }
  }

  return byFile;
}

// The diff against `base`, plus every untracked regular file added in full. A file
// that cannot be read is left out, as it was never measurable; a git failure
// throws, so the caller reports the check as not run instead of passing it.
function diffFiles(root, base) {
  const byFile = parseDiff(gitIn(root, ["-c", "core.quotepath=false", "diff", "-U0", "--no-color", "--find-renames", "--relative", base]));

  for (const file of gitIn(root, ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean)) {
    try {
      if (fs.lstatSync(path.join(root, file)).isFile()) {
        const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n").length;
        byFile.set(file, { oldPath: null, hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: lines }] });
      }
    } catch {
      // Unreadable: nothing to measure in it.
    }
  }

  return byFile;
}

// A line of the new file, mapped to the base: `{ line, added }`. An added line maps
// to the old line its hunk replaced (a changed signature), or to null when the
// hunk only inserted (a new function).
function toBaseLine(hunks, newLine) {
  let offset = 0;

  for (const { oldStart, oldCount, newStart, newCount } of hunks) {
    const firstNew = newCount > 0 ? newStart : newStart + 1;

    if (newLine < firstNew) {
      break;
    }

    if (newCount > 0 && newLine < newStart + newCount) {
      return { line: oldCount > 0 ? oldStart + Math.min(newLine - newStart, oldCount - 1) : null, added: true };
    }

    offset = (oldCount > 0 ? oldStart + oldCount : oldStart + 1) - (newCount > 0 ? newStart + newCount : newStart + 1);
  }

  return { line: newLine + offset, added: false };
}

function addedLines(hunks, start, end) {
  const added = new Set();

  for (const { newStart, newCount } of hunks) {
    for (let line = Math.max(newStart, start); line <= Math.min(newStart + newCount - 1, end); line++) {
      added.add(line);
    }
  }

  return added;
}

// The function's span in the base file, measured there; null when it is new.
function baseSpan(baseSource, fn, hunks) {
  const start = toBaseLine(hunks, fn.line).line;

  if (!baseSource || start === null) {
    return null;
  }

  const mappedNext = fn.next > baseSource.lineCount ? null : toBaseLine(hunks, fn.next).line;
  const next = Math.max(mappedNext || baseSource.lineCount + 1, start + 1);
  const end = fn.declaredEnd
    ? toBaseLine(hunks, fn.declaredEnd).line || start
    : functionEnd(baseSource, { line: start }, next);

  return { start, end: Math.max(start, end) };
}

// A line that reads like a decision: the base has no coverage, so the removed
// lines' own text is the only witness of the branches they held.
const DECISION_TEXT = /\b(if|for|while|case|catch)\b|\?|&&|\|\|/;

// Decision-like lines the diff removed inside the base span.
function removedDecisions(baseSource, span, hunks) {
  let count = 0;

  for (const { oldStart, oldCount } of hunks) {
    for (let line = Math.max(oldStart, span.start); line <= Math.min(oldStart + oldCount - 1, span.end); line++) {
      count += DECISION_TEXT.test(baseSource.lines[line - 1] || "") ? 1 : 0;
    }
  }

  return count;
}

// One touched function, before and after; null when it did not cross a line.
function grewPastLine(change, fn, data, max) {
  const added = addedLines(change.hunks, fn.line, fn.end);

  if (added.size === 0) {
    return null;
  }

  const span = baseSpan(change.baseSource, fn, change.hunks);
  // A rewritten `if` is one decision before and after: an added branch line is
  // only new beyond the decision-like lines the diff removed in the function.
  const addedBranches = [...added].filter((line) => data.branchLines.has(line));
  const rewritten = new Set(addedBranches.slice(0, span ? removedDecisions(change.baseSource, span, change.hunks) : 0));
  const before = {
    length: span ? span.end - span.start + 1 : 0,
    crap: riskOver(data, fn.line, fn.end, new Set([...added].filter((line) => !rewritten.has(line)))).crap,
  };
  const longer = fn.length > max && (before.length <= max || fn.length > before.length);
  const riskier = fn.crap > CRAP_THRESHOLD && before.crap <= CRAP_THRESHOLD;

  if (!longer && !riskier) {
    return null;
  }

  return {
    file: change.file,
    line: fn.line,
    name: fn.name,
    length: { before: before.length, after: fn.length },
    crap: { before: before.crap, after: fn.crap },
    reasons: [...(longer ? ["length"] : []), ...(riskier ? ["crap"] : [])],
  };
}

function readBase(root, base, oldPath) {
  if (!oldPath) {
    return null;
  }

  try {
    return readSource(root, oldPath, gitIn(root, ["show", `${base}:./${oldPath}`]));
  } catch {
    return null;
  }
}

function settings(config) {
  const size = config.functionSize || {};

  return {
    max: Number.isInteger(size.max) && size.max > 0 ? size.max : DEFAULT_MAX_LINES,
    enforced: size.enforce === true,
  };
}

// The `complexity-grew` signal: functions overlapping the diff's added lines whose
// CRAP crosses 30, or whose length crosses `functionSize.max` or grows while above
// it. With no lcov from this run listing a function there is no signal — unless
// `functionSize.enforce: true`, where a check that could not run is never a pass.
function evaluateComplexity({ root, config, since }) {
  const { max, enforced } = settings(config);
  const report = loadFunctionReport(root, { config, since });
  const result = { signal: "complexity-grew", heuristic: true, enforced, max, crapThreshold: CRAP_THRESHOLD };

  if (!report) {
    return enforced ? { ...result, reports: [], items: [], unavailable: "this run wrote no lcov that lists a function", ok: false } : null;
  }

  const mergeBase = currentDiffBase(root).mergeBase;
  const base = mergeBase || "HEAD";
  let files;

  try {
    files = diffFiles(root, base);
  } catch {
    return { ...result, reports: report.reports, items: [], unavailable: `git could not diff against ${base}`, ok: !enforced };
  }

  const items = [];

  for (const [file, { oldPath, hunks }] of files) {
    if (!report.files.has(file) || !fs.existsSync(path.join(root, file))) {
      continue;
    }

    const change = { file, hunks, baseSource: readBase(root, base, oldPath) };

    for (const fn of measureFile(root, file, report.files.get(file))) {
      const item = grewPastLine(change, fn, report.files.get(file), max);
      if (item) items.push(item);
    }
  }

  return {
    ...result,
    reports: report.reports,
    ...(mergeBase ? {} : { scope: "no merge base: only uncommitted changes were checked" }),
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
