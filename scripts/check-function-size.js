#!/usr/bin/env node
"use strict";

// story-13-06: a ratchet, not a mandate. A function the diff touches may not end
// the diff longer than LIMIT lines unless it already was, and an already-long
// function may not get longer. Long functions the diff does not touch are never
// reported: the debt stops growing without a big-bang refactor.
//
// Function starts come from the fresh `coverage/lcov.info` (`FN:<line>,<name>`),
// their end from brace matching in the JavaScript source. The length at the base
// is not read from the base: it is the length now, minus the lines the diff added
// inside the function, plus the lines it removed there.
//
// Usage: node scripts/check-function-size.js [--lcov <path>] [--base <ref>]
// Exit 1 with `file:line name base→head` per offender; 1 too when there is no lcov
// (never a silent pass). Story 14-07 generalises this to other languages.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const LIMIT = 80;
const SOURCE = /\.(c|m)?js$/;
const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^";

function option(name, fallback) {
  const index = process.argv.indexOf(name);

  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 });
}

function resolveBase() {
  const explicit = option("--base", null);

  if (explicit) {
    return explicit;
  }

  const mergeBase = require("../bin/lib/diff-scope").currentDiffBase(process.cwd()).mergeBase;

  if (!mergeBase) {
    console.error("check-function-size: no merge base found — only uncommitted changes are checked.");
  }

  return mergeBase || "HEAD";
}

// --- the diff: file -> hunks `{ oldCount, newStart, newCount }` ---------------

function parseHunks(diff) {
  const byFile = new Map();
  let current = null;

  for (const line of diff.split(/\r?\n/)) {
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

  return byFile;
}

// A new, untracked file is added in full.
function addUntracked(byFile) {
  for (const file of git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean)) {
    if (SOURCE.test(file) && fs.existsSync(file)) {
      byFile.set(file, [{ oldCount: 0, newStart: 1, newCount: fs.readFileSync(file, "utf8").split("\n").length }]);
    }
  }
}

function diffHunks(base) {
  const byFile = parseHunks(git(["-c", "core.quotepath=false", "diff", "-U0", "--no-color", base]));

  addUntracked(byFile);

  return byFile;
}

// --- lcov: file -> [{ line, name }] ---------------------------------------------

function parseFunctions(lcov) {
  const byFile = new Map();
  let current = null;

  for (const raw of lcov.split(/\r?\n/)) {
    const line = raw.trim();
    const fn = /^FN:(\d+),(.*)$/.exec(line);

    if (line.startsWith("SF:")) {
      current = path.relative(process.cwd(), path.resolve(line.slice(3).trim()));
      byFile.set(current, byFile.get(current) || []);
    } else if (fn && current) {
      byFile.get(current).push({ line: Number(fn[1]), name: fn[2] });
    }
  }

  return byFile;
}

// --- brace matching: the code characters of a JavaScript source -----------------

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

function lineStarts(text) {
  const starts = [0];

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }

  return starts;
}

// --- the verdict ---------------------------------------------------------------

// Lines the diff added inside [start, end], and lines it removed there.
function churn(hunks, start, end) {
  let added = 0;
  let removed = 0;

  for (const { oldCount, newStart, newCount } of hunks) {
    const last = newStart + newCount - 1;

    added += Math.max(0, Math.min(last, end) - Math.max(newStart, start) + 1);

    const inside = newCount > 0 ? newStart >= start && newStart <= end : newStart >= start && newStart < end;

    removed += inside ? oldCount : 0;
  }

  return { added, removed };
}

function measure(text, fn, hunks) {
  const starts = lineStarts(text);
  const from = starts[fn.line - 1] || 0;
  const open = bodyStart(text, from);
  const end = open === null ? fn.line : lineOf(starts, bodyEnd(text, open));
  const head = end - fn.line + 1;
  const { added, removed } = churn(hunks, fn.line, end);

  return { head, base: head - added + removed };
}

function offenders(file, fns, hunks) {
  const text = fs.readFileSync(file, "utf8");
  const found = [];

  for (const fn of fns) {
    const { head, base } = measure(text, fn, hunks);

    // A function the diff did not add to has base >= head, so it is never reported.
    if (head > LIMIT && head > base) {
      found.push(`${file}:${fn.line} ${fn.name} ${base}→${head}`);
    }
  }

  return found;
}

function main() {
  const lcovPath = option("--lcov", "coverage/lcov.info");

  if (!fs.existsSync(lcovPath)) {
    console.error(`check-function-size: no ${lcovPath} — run the lcov validation first.`);
    process.exit(1);
  }

  const functions = parseFunctions(fs.readFileSync(lcovPath, "utf8"));

  if ([...functions.values()].every((fns) => fns.length === 0)) {
    console.error(`check-function-size: ${lcovPath} lists no function — run the lcov validation first.`);
    process.exit(1);
  }

  const hunks = diffHunks(resolveBase());
  const lcovTime = fs.statSync(lcovPath).mtimeMs;
  const problems = [];

  for (const [file, fileHunks] of hunks) {
    if (!SOURCE.test(file) || !functions.has(file) || !fs.existsSync(file)) {
      continue;
    }

    if (fs.statSync(file).mtimeMs > lcovTime) {
      problems.push(`${file}: edited after ${lcovPath} was written — run the lcov validation first.`);
      continue;
    }

    problems.push(...offenders(file, functions.get(file), fileHunks));
  }

  if (problems.length > 0) {
    console.error(`check-function-size: a touched function may not end longer than ${LIMIT} lines (base→head):`);
    console.error(problems.map((line) => `  ${line}`).join("\n"));
    process.exit(1);
  }

  console.log(`check-function-size: ok (no touched function grew past ${LIMIT} lines)`);
}

main();
