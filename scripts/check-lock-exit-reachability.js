#!/usr/bin/env node
"use strict";

// story-04-03: a deterministic, dependency-free check for the exact bug class
// story-03-02's sixth /flow-review pass found by hand — a callback passed to
// this project's `withFileLock(...)` helper (placement-store.js) that calls a
// same-file helper function whose body reaches this project's `git()` helper
// (worktree.js) WITHOUT `{ allowFail: true }`. Unguarded, `git()` calls
// `fail()` -> `process.exit()` directly, which terminates the process before
// `withFileLock`'s own `finally` (which releases the lock) gets a chance to
// run — leaking the lock, so every later `land` (including a concurrent
// auto-land from another chain) waits out the full timeout for nothing.
//
// Deliberately scoped to a NAMED helper function called from the lock
// callback, not to code written directly, inline, inside the callback's own
// text: a reviewer reading the withFileLock call site already sees every
// inline call in front of them (this project has two inline exceptions, `git
// rev-parse HEAD` and `git reset --hard`, both deliberately left on the
// default `fail()` path with a comment above them explaining why — see
// worktree.js's `worktreeLand`). The bug this check exists to catch was
// invisible exactly because it was one function call away, inside a helper
// (`landCleanup`) the reviewer had to separately open and read. A bounded
// text-shape heuristic, not a full control-flow analysis: false negatives on
// a disguised or heavily refactored call shape are acceptable; a false
// positive on an already-guarded call is not (RULES.md — a wrongly-escalated
// quiet change wastes the review budget the gate exists to protect).
//
// A reviewed, deliberate exception can be marked with a same-line or
// preceding-line `// lock-exit-ok: <reason>` comment, mirroring the existing
// `allowFail: true` escape hatch for cases this heuristic cannot see (e.g. an
// inline call, or a guard expressed too far from the call to fall in the
// scan window below).
//
// Usage: node scripts/check-lock-exit-reachability.js [file ...]
// With no arguments, scans every git-tracked .js file.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

// Primitives whose own definition is not itself "a helper that reaches git()
// unguarded" — recursing into them would only ever find their own internal
// implementation, never a caller's mistake.
const IGNORED_HELPER_NAMES = new Set(["git", "log", "fail", "require"]);

function trackedJsFiles() {
  try {
    return execFileSync("git", ["ls-files", "--", "*.js"], { cwd: repoRoot, encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.includes("node_modules/"));
  } catch {
    return [];
  }
}

// Index of `openChar` at `openIndex` -> index of its matching `closeChar`,
// by depth-counting. No string/comment awareness: bounded on purpose (see
// header) — real call sites in this project do not nest unbalanced braces
// inside a string literal at the position this walks.
// Blanks out `//` and `/* */` comment content (space-for-character, so every
// index and line number in the result still lines up with the original text)
// and treats string/template literal content as opaque so a comment marker or
// stray brace quoted inside one cannot be mistaken for real syntax. This repo
// comments its "why" heavily, often mentioning `git()`/`withFileLock`/helper
// names by name in prose — without this pass, those mentions read as real
// calls and the scan below is mostly false positives.
// Whether a bare `/` at this point most likely opens a regex literal rather
// than division, using the standard lookbehind heuristic (a `/` is division
// only when the previous token could itself be a value: an identifier,
// number, `)`, or `]`; anything else — an operator, punctuation, a keyword
// like `return`, or the start of input — means an operand is expected next,
// so `/` opens a regex). `out` is the already-blanked output so far, which
// preserves every non-comment/non-string token verbatim.
function isRegexContext(out) {
  let i = out.length - 1;
  while (i >= 0 && /\s/.test(out[i])) i -= 1;
  if (i < 0) return true;
  const ch = out[i];
  if (/[A-Za-z0-9_$)\]]/.test(ch)) {
    let j = i;
    while (j >= 0 && /[A-Za-z_$]/.test(out[j])) j -= 1;
    const word = out.slice(j + 1, i + 1);
    return /^(return|typeof|instanceof|in|of|new|delete|void|do|else|yield|case)$/.test(word);
  }
  return true;
}

// From an opening `/` at `text[start]` (already known not to be `//` or `/*`),
// scans for its closing, unescaped `/` — respecting `\` escapes and `[...]`
// character classes, where an unescaped `/` does not terminate the literal —
// then consumes trailing flag letters. Returns the index just past the flags,
// or -1 if no closing delimiter is found before a raw newline (a real regex
// literal never spans a line unescaped, so that means this was never a regex
// to begin with — most likely division that this heuristic mis-flagged).
function regexLiteralEnd(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") return -1;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i += 1;
      while (i < text.length && /[a-zA-Z]/.test(text[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return -1;
}

function blankCommentsAndStrings(text) {
  let out = "";
  let i = 0;
  let mode = null; // null | "line" | "block" | quote char
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (mode === "line") {
      out += ch === "\n" ? "\n" : " ";
      if (ch === "\n") mode = null;
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") {
        out += "  ";
        i += 2;
        mode = null;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (mode === '"' || mode === "'" || mode === "`") {
      if (ch === "\\") {
        out += "  ";
        i += 2;
        continue;
      }
      if (ch === mode) {
        out += ch;
        mode = null;
        i += 1;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      out += "  ";
      mode = "line";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      mode = "block";
      i += 2;
      continue;
    }
    // Not a comment start (checked above, which — matching real JS syntax —
    // is unconditional: `//`/`/*` can never open a regex literal instead). A
    // bare `/` in a position where a value is expected is almost certainly a
    // regex literal; its content is opaque the same way a string's is, so a
    // stray `//`-looking pair inside it (e.g. `/\/\//` matching two slashes)
    // is never misread as a comment start on the next pass.
    if (ch === "/" && isRegexContext(out)) {
      const end = regexLiteralEnd(text, i);
      if (end !== -1) {
        for (let k = i; k < end; k += 1) out += text[k] === "\n" ? "\n" : " ";
        i = end;
        continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      mode = ch;
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function matchBalanced(text, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === openChar) depth += 1;
    else if (text[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// This project's own `withFileLock(<path>, () => { ... }, <opts>)` shape: the
// first argument is always a path expression with no braces of its own, so
// the first `{` inside the call is always the callback's own opening brace.
// Matched against `blanked` (comments/strings neutralized) so a stray brace
// mentioned in prose cannot desync the balance count; the returned range is
// an index pair valid against BOTH `blanked` and the original text, since
// blanking never changes length or line breaks.
function callbackBodyRanges(blanked) {
  const ranges = [];
  const callRe = /\bwithFileLock\s*\(/g;
  let match;
  while ((match = callRe.exec(blanked))) {
    const openParen = match.index + match[0].length - 1;
    const closeParen = matchBalanced(blanked, openParen, "(", ")");
    if (closeParen === -1) continue;
    const braceStart = blanked.indexOf("{", openParen);
    if (braceStart === -1 || braceStart > closeParen) continue;
    const braceEnd = matchBalanced(blanked, braceStart, "{", "}");
    if (braceEnd === -1) continue;
    ranges.push([braceStart, braceEnd + 1]);
  }
  return ranges;
}

// Every top-level `function NAME(...) { ... }` declared in `blanked`, by name,
// as an index range (see `callbackBodyRanges` for why blanked-vs-original is safe).
function functionBodyRanges(blanked) {
  const ranges = new Map();
  const declRe = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let match;
  while ((match = declRe.exec(blanked))) {
    const name = match[1];
    const openParen = match.index + match[0].length - 1;
    const closeParen = matchBalanced(blanked, openParen, "(", ")");
    if (closeParen === -1) continue;
    const braceStart = blanked.indexOf("{", closeParen);
    if (braceStart === -1) continue;
    const braceEnd = matchBalanced(blanked, braceStart, "{", "}");
    if (braceEnd === -1) continue;
    ranges.set(name, [braceStart, braceEnd + 1]);
  }
  return ranges;
}

// Which of `knownNames` are actually called (as `NAME(`) inside blanked `bodyText`.
function calledHelperNames(blankedBodyText, knownNames) {
  const called = new Set();
  const callRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let match;
  while ((match = callRe.exec(blankedBodyText))) {
    if (knownNames.has(match[1]) && !IGNORED_HELPER_NAMES.has(match[1])) {
      called.add(match[1]);
    }
  }
  return called;
}

// Every `git(...)` call in the helper's body that has no `allowFail: true`
// within a short window after it (the matched line plus the next two — this
// project's real call shapes keep the options object on the same line as the
// call, or wrap once), and no `// lock-exit-ok:` suppression on the same or
// the immediately preceding line. `git`/`allowFail` detection runs against
// `blankedLines` (comments/strings neutralized, so a comment mentioning
// `git()` cannot match); the suppression marker is a comment BY DEFINITION,
// so that one check runs against `originalLines` instead, at the same index.
function unguardedGitCalls(blankedLines, originalLines) {
  const flagged = [];
  const gitCallRe = /\bgit\s*\(/;

  for (let i = 0; i < blankedLines.length; i += 1) {
    if (!gitCallRe.test(blankedLines[i])) continue;
    const window = blankedLines.slice(i, i + 3).join(" ");
    if (/allowFail\s*:\s*true/.test(window)) continue;
    const suppressed =
      /lock-exit-ok\s*:/.test(originalLines[i]) ||
      (i > 0 && /lock-exit-ok\s*:/.test(originalLines[i - 1]));
    if (suppressed) continue;
    flagged.push(originalLines[i].trim());
  }
  return flagged;
}

function checkText(file, text) {
  if (!text.includes("withFileLock")) return [];

  const blanked = blankCommentsAndStrings(text);
  const functionRanges = functionBodyRanges(blanked);
  const knownNames = new Set(functionRanges.keys());
  const findings = [];

  for (const [cbStart, cbEnd] of callbackBodyRanges(blanked)) {
    const blankedCallback = blanked.slice(cbStart, cbEnd);
    for (const helperName of calledHelperNames(blankedCallback, knownNames)) {
      const [hStart, hEnd] = functionRanges.get(helperName);
      const blankedHelperLines = blanked.slice(hStart, hEnd).split(/\r?\n/);
      const originalHelperLines = text.slice(hStart, hEnd).split(/\r?\n/);
      for (const line of unguardedGitCalls(blankedHelperLines, originalHelperLines)) {
        findings.push({ file, helper: helperName, text: line });
      }
    }
  }

  return findings;
}

function checkFile(file) {
  let text;
  try {
    text = fs.readFileSync(path.resolve(repoRoot, file), "utf8");
  } catch {
    return [];
  }
  return checkText(file, text);
}

function main(argv) {
  const files = argv.length > 0 ? argv : trackedJsFiles();
  const findings = files.flatMap((file) => checkFile(file));

  if (findings.length === 0) {
    console.log(`check-lock-exit-reachability: OK (${files.length} file(s) scanned).`);
    return 0;
  }

  console.error("check-lock-exit-reachability: FAILED");
  for (const finding of findings) {
    console.error(
      `  ${finding.file}: "${finding.helper}" is called from a withFileLock callback and reaches an ` +
        "unguarded git() call — a failure there calls process.exit() before the lock's own cleanup runs:",
    );
    console.error(`    ${finding.text}`);
  }
  console.error(
    "  Fix: pass { allowFail: true } to the git() call above and throw an Error on failure instead " +
      "(the pattern already used throughout this project's landCleanup), or mark a reviewed, " +
      "deliberate exception with `// lock-exit-ok: <reason>`.",
  );
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { checkText, checkFile, trackedJsFiles };
