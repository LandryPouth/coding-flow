"use strict";

// What the change under verification is: the diff base (resolved once per
// request by diff-base.js, cached here), the changed files and the added or
// changed lines, deleted files, and the coverage scoping that filters them.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { readConfig } = require("./config");
const { currentBranch } = require("./policy");
const { resolveDiffBase } = require("./diff-base");
const { fail, normalizePortable, matchesPattern } = require("./util");
const { readHarnessConfig } = require("./harness-config");

// Added lines only (`git diff -U0`), scoped to the same base-branch-or-fallback
// comparison `changedFilesForCoverage` already uses. Deliberately NOT restricted
// to `files` via a pathspec: a pathspec that only names the new side of a rename
// hides the old side from git's own rename detection, so a renamed-but-unchanged
// file would show as 100%-added content instead of a content-free rename — a
// real false positive found in review. Running the unrestricted diff once and
// filtering to `files` in-process keeps this to one spawn for the whole set
// while still detecting renames correctly. Every file mentioned by a `diff --git`
// header is pre-registered with zero added lines (a content-identical rename
// emits a header with no `+++`/`+` lines at all); real hunks then layer their
// `+` lines on top. Untracked new files (no history to diff against, so they
// never appear in the diff at all) fall back to reading the working file
// directly, since every line of a brand-new file is, in effect, "added". Never
// throws: any git failure (no repo, no git binary) degrades to "nothing to
// scan" rather than breaking the risk score that calls it.
function addedLinesByFile(root, files) {
  const byFile = new Map();
  if (files.length === 0) return byFile;
  const wanted = new Set(files);

  const mergeBase = currentDiffBase(root).mergeBase;

  try {
    const diffArgs = ["-c", "core.quotePath=false", "diff", "-U0", ...(mergeBase ? [mergeBase] : [])];
    const output = require("child_process").execFileSync("git", diffArgs, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    let current = null;
    for (const line of output.split(/\r?\n/)) {
      const header = /^diff --git a\/.+ b\/(.+)$/.exec(line);
      if (header) {
        current = null;
        if (wanted.has(header[1]) && !byFile.has(header[1])) byFile.set(header[1], []);
        continue;
      }
      if (line.startsWith("+++ ")) {
        const target = line.slice(4).replace(/^[ab]\//, "").trim();
        current = target === "/dev/null" ? null : target;
        if (current && wanted.has(current) && !byFile.has(current)) byFile.set(current, []);
        continue;
      }
      if (current && wanted.has(current) && line.startsWith("+") && !line.startsWith("+++")) {
        byFile.get(current).push(line.slice(1));
      }
    }
  } catch {
    // No base to diff against, or git failed — fall through to the untracked-file
    // fallback below for every file (nothing was captured above).
  }

  for (const file of files) {
    if (byFile.has(file)) continue;
    try {
      const content = fs.readFileSync(path.join(root, file), "utf8");
      byFile.set(file, content.split(/\r?\n/));
    } catch {
      // Deleted, or genuinely unreadable — nothing to scan for this file.
    }
  }

  return byFile;
}

// The base every diff-derived signal (coverage, risk, weakening, deleted tests)
// is measured from. Resolved once per run and per HEAD, not once per function:
// five readers disagreeing about the base would make the evidence incoherent.
let diffBaseRequest = { flagBase: null, story: null };
let diffBaseCache = new Map();

function setDiffBaseRequest({ flagBase = null, story = null } = {}) {
  diffBaseRequest = { flagBase, story };
  diffBaseCache = new Map();
}

// The `--base` flag of the current request. A getter, not the binding: the
// request is reassigned, and an importer would keep reading the first one.
function diffBaseFlag() {
  return diffBaseRequest.flagBase;
}

function publicDiffBase({ ref, mergeBase, source, scope, forkPointMissing, configUnresolved, forkPointIgnored, configIgnored }) {
  return {
    ref,
    mergeBase,
    source,
    scope,
    ...(forkPointMissing ? { forkPointMissing } : {}),
    ...(configUnresolved ? { configUnresolved } : {}),
    ...(forkPointIgnored ? { forkPointIgnored } : {}),
    ...(configIgnored ? { configIgnored } : {}),
  };
}

function currentDiffBase(root = cwd) {
  const head = runGitList(["rev-parse", "HEAD"], root)[0] || "";
  const branch = currentBranch(root) || "";
  const configured = readConfig(root).baseBranch || "";
  const key = [root, head, branch, configured, diffBaseRequest.flagBase, diffBaseRequest.story].join("\0");

  if (!diffBaseCache.has(key)) {
    let value;

    try {
      value = resolveDiffBase(root, diffBaseRequest);
    } catch (error) {
      fail(error.message);
    }

    diffBaseCache.set(key, value);
  }

  return diffBaseCache.get(key);
}

// `core.quotePath=false`: git otherwise prints a non-ASCII path as
// `"test/\303\251.test.js"`, a name no glob, no `existedAt` and no `+++ b/` header
// match recognizes — an edited test with such a name read as untouched.
function runGitList(argsForGit, root = cwd) {
  try {
    const childProcess = require("child_process");
    return childProcess
      .execFileSync("git", ["-c", "core.quotePath=false", ...argsForGit], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getChangedFiles(root = cwd) {
  return [...new Set([
    ...runGitList(["diff", "--name-only"], root),
    ...runGitList(["diff", "--cached", "--name-only"], root),
  ])].sort();
}

// The tool's own run files are never a change a person or agent made; the
// project's `ignoredPaths` are the generated ones. This is the single choke
// point for the diff-derived signals (coverage, risk, weakening, deleted tests).
// Secret scanning and the guard read other lists and keep seeing everything.
function isScopedOut(file, config) {
  const portable = normalizePortable(file);

  return (
    portable.startsWith(".coding-flow/") ||
    (config.ignoredPaths || []).some((pattern) => typeof pattern === "string" && matchesPattern(portable, pattern))
  );
}

function filterScopedFiles(files, config) {
  return files.filter((file) => !isScopedOut(file, config));
}

// Everything this branch contributes, not just what is uncommitted: a story whose
// tests are already committed must not read as "no test changed". Falls back to
// the working tree when there is no base to compare against. `scope` is the
// harness config whose `ignoredPaths` apply (the working one by default).
function changedFilesForCoverage(root = cwd, scope = null) {
  const files = new Set();
  const { mergeBase } = currentDiffBase(root);

  if (mergeBase) {
    for (const file of runGitList(["diff", "--name-only", mergeBase], root)) {
      files.add(file);
    }
  }

  for (const file of getChangedFiles(root)) {
    files.add(file);
  }

  // A brand-new test file is untracked, and it is the single most important case
  // this gate must see.
  for (const file of runGitList(["ls-files", "--others", "--exclude-standard"], root)) {
    files.add(file);
  }

  return filterScopedFiles([...files].map(normalizePortable), scope || readHarnessConfig(root).config).sort();
}

// The paths the diff RISK reads: `changedFilesForCoverage` plus the old side of
// every rename, pure or not. A path is behavior on its own: moving
// `middleware.ts` away disables it, a migration moved out of `migrations/` no
// longer runs, and git may pair a deleted high-risk file with an unrelated
// identical one as a pure move. So a file moved out of a high-risk directory is
// scored as if it had not moved, which is also what `diff.renames=false`
// already gave (the old side listed as a deletion). Coverage keeps measuring
// the file at its new path only, through `changedFilesForCoverage`.
function riskPathsInDiff(root = cwd, scope = null) {
  const config = scope || readHarnessConfig(root).config;
  const files = new Set(changedFilesForCoverage(root, config));
  const { mergeBase } = currentDiffBase(root);
  let raw = "";

  // The working tree against the base (HEAD with none): committed, staged and
  // unstaged changes in one comparison. `-z` keeps every path byte for byte.
  try {
    raw = require("child_process").execFileSync(
      "git",
      ["diff", "--find-renames", "--raw", "-z", mergeBase || "HEAD"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    raw = "";
  }

  const fields = raw.split("\0");
  for (let i = 0; i < fields.length; i += 1) {
    const header = fields[i].match(/^:\d+ \d+ [0-9a-f.]+ [0-9a-f.]+ ([A-Z])\d*$/);
    if (!header) continue;

    if (header[1] === "R") files.add(normalizePortable(fields[i + 1]));
    i += header[1] === "R" || header[1] === "C" ? 2 : 1;
  }

  return filterScopedFiles([...files], config).sort();
}

// The lines this change ADDED, per file. Only added lines: a deleted line has no
// coverage to have, and asking a test to execute code that no longer exists is
// nonsense. `--unified=0` makes every hunk header exact, so no context line is
// mistaken for a change.
//
// Hunk header: @@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@
function parseAddedLines(diffText) {
  const byFile = {};
  let current = null;
  let nextLine = 0;

  for (const line of diffText.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/([^\t]+)/);

    if (fileMatch) {
      current = fileMatch[1] === "dev/null" ? null : normalizePortable(fileMatch[1]);
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);

    if (hunkMatch) {
      nextLine = Number.parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!current || !line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    if (!byFile[current]) {
      byFile[current] = [];
    }

    byFile[current].push(nextLine);
    nextLine += 1;
  }

  return byFile;
}

function runGitText(argsForGit) {
  try {
    const childProcess = require("child_process");
    return childProcess.execFileSync("git", ["-c", "core.quotePath=false", ...argsForGit], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

// Added lines across the whole contribution: the branch's commits, the working
// tree, and untracked files (every line of which is new by definition).
function changedLinesForCoverage() {
  const byFile = {};

  const merge = (source) => {
    for (const [file, lines] of Object.entries(source)) {
      byFile[file] = [...new Set([...(byFile[file] || []), ...lines])].sort((a, b) => a - b);
    }
  };

  const { mergeBase } = currentDiffBase(cwd);

  if (mergeBase) {
    merge(parseAddedLines(runGitText(["diff", "--unified=0", mergeBase])));
  }

  merge(parseAddedLines(runGitText(["diff", "--unified=0"])));
  merge(parseAddedLines(runGitText(["diff", "--unified=0", "--cached"])));

  for (const file of runGitList(["ls-files", "--others", "--exclude-standard"])) {
    const fullPath = path.join(cwd, file);

    try {
      const lineCount = fs.readFileSync(fullPath, "utf8").split(/\r?\n/).length;
      merge({ [normalizePortable(file)]: Array.from({ length: lineCount }, (_, index) => index + 1) });
    } catch {
      // Binary or unreadable: nothing to cover.
    }
  }

  const config = readHarnessConfig(cwd).config;

  return Object.fromEntries(Object.entries(byFile).filter(([file]) => !isScopedOut(file, config)));
}

// Added and removed line *text* per file. `parseAddedLines` returns line numbers
// for coverage; here the content is what matters, and both directions do.
function parseChangedText(diffText) {
  const byFile = {};
  let current = null;

  for (const line of diffText.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/([^\t]+)/);

    if (fileMatch) {
      current = fileMatch[1] === "dev/null" ? null : normalizePortable(fileMatch[1]);

      if (current && !byFile[current]) {
        byFile[current] = { added: [], removed: [] };
      }

      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      byFile[current].added.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      byFile[current].removed.push(line.slice(1));
    }
  }

  return byFile;
}

function renamedFilesInDiff() {
  const pairs = [];
  const seen = new Set();
  const { mergeBase } = currentDiffBase(cwd);
  const sources = [
    ["diff", "--find-renames", "--name-status"],
    ["diff", "--find-renames", "--cached", "--name-status"],
  ];

  if (mergeBase) {
    sources.push(["diff", "--find-renames", "--name-status", mergeBase]);
  }

  for (const argsForGit of sources) {
    for (const line of runGitText(argsForGit).split(/\r?\n/)) {
      const match = line.match(/^R\d+\t(.+)\t(.+)$/);

      if (!match) {
        continue;
      }

      const from = normalizePortable(match[1].trim());
      const to = normalizePortable(match[2].trim());
      const key = `${from}\0${to}`;

      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({ from, to });
      }
    }
  }

  const config = readHarnessConfig(cwd).config;

  return pairs.filter((pair) => !isScopedOut(pair.from, config));
}

// Files the diff under proof deleted (`D`) or added (`A`), from the three
// diffs the gate reads: unstaged, staged, and against the merge base.
function filesWithStatusInDiff(status) {
  const found = new Set();
  const { mergeBase } = currentDiffBase(cwd);
  // `--find-renames` is explicit: a moved test file is not a deleted one, and a
  // user's `diff.renames=false` must not turn every move into a deletion.
  const sources = [["diff", "--find-renames", "--name-status"], ["diff", "--find-renames", "--cached", "--name-status"]];

  if (mergeBase) {
    sources.push(["diff", "--find-renames", "--name-status", mergeBase]);
  }

  for (const argsForGit of sources) {
    for (const line of runGitText(argsForGit).split(/\r?\n/)) {
      const match = line.match(/^([A-Z])\s+(.+)$/);

      if (match && match[1] === status) {
        found.add(normalizePortable(match[2].trim()));
      }
    }
  }

  const config = readHarnessConfig(cwd).config;

  return filterScopedFiles([...found], config);
}

const deletedFilesInDiff = () => filesWithStatusInDiff("D");
// Added in the diff, or untracked: a brand-new file is new whether or not it
// has been staged yet.
const addedFilesInDiff = () => {
  const config = readHarnessConfig(cwd).config;
  const untracked = filterScopedFiles(runGitList(["ls-files", "--others", "--exclude-standard"]), config);
  return [...new Set([...filesWithStatusInDiff("A"), ...untracked])];
};

module.exports = {
  setDiffBaseRequest,
  diffBaseFlag,
  publicDiffBase,
  currentDiffBase,
  runGitList,
  getChangedFiles,
  isScopedOut,
  filterScopedFiles,
  changedFilesForCoverage,
  riskPathsInDiff,
  runGitText,
  changedLinesForCoverage,
  renamedFilesInDiff,
  parseChangedText,
  deletedFilesInDiff,
  addedFilesInDiff,
  addedLinesByFile,
};
