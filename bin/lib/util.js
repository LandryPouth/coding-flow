"use strict";

// Generic helpers with no business logic: terminal I/O, hashing, JSON, paths,
// glob, file walking. Reused by every command.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");

// `crypto` (OpenSSL bindings) and `child_process` are the two expensive requires
// in this file — together ~20 ms, measured — and the two that `guard` never
// reaches: it uses the pure string helpers only. Loading them where they are
// used keeps that cost off the one command Claude Code runs before every tool
// call. Node caches the module, so the repeat calls in a hashing loop are free.

// `ai-flow status | head` closes the pipe under us, and an unhandled EPIPE on
// stdout crashes Node with a stack trace over whatever the user was reading.
// Paging output is normal use, so a closed pipe is a normal end, not an error.
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") {
    process.exit(0);
  }

  throw error;
});

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function toPortable(filePath) {
  return filePath.split(path.sep).join("/");
}

// Whether a command resolves on PATH right now, checked by actually invoking
// it rather than `which`/`command -v` (no separate shell dependency, and it
// works the same on Windows) — the same technique `ship.js` already uses for
// `gh`. Used to tell a user whether the short `ai-flow <command>` form will
// work on this machine, or whether they need `npx @landry_pouth/coding-flow`.
function isCommandAvailable(name, versionFlag = "--version") {
  try {
    require("child_process").execFileSync(name, [versionFlag], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

// One message, reused by `doctor` and by `init`/`upgrade`'s end-of-run summary,
// so a user sees the identical answer to "will the short form work here"
// whichever command told them.
function binaryPathNote(onPath) {
  return onPath
    ? "PATH: `ai-flow` resolves directly on this machine — the short form works."
    : "PATH: `ai-flow` is not on this machine's PATH — use `npx @landry_pouth/coding-flow <command>` " +
        "(works with no install), or run `npm install -g @landry_pouth/coding-flow` once for the short form.";
}

function normalizePortable(filePath) {
  return toPortable(filePath).replace(/^\.\//, "");
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function hashBuffer(buffer) {
  return require("crypto").createHash("sha256").update(buffer).digest("hex");
}

function hashFile(filePath) {
  return hashBuffer(fs.readFileSync(filePath));
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) {
    return null;
  }

  const data = {};

  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    data[key] = value;
  }

  return data;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${filePath}.tmp`, filePath);
}

function removeFileIfExists(filePath, { dryRun = false } = {}) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  if (!dryRun) {
    fs.unlinkSync(filePath);
  }

  return true;
}

function isPathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function removeEmptyDirsUpward(startDir, stopDir, { dryRun = false } = {}) {
  const removed = [];
  let current = startDir;
  const resolvedStop = path.resolve(stopDir);

  while (isPathInside(path.resolve(current), resolvedStop) && path.resolve(current) !== resolvedStop) {
    if (!fs.existsSync(current)) {
      current = path.dirname(current);
      continue;
    }

    const entries = fs.readdirSync(current);

    if (entries.length > 0) {
      break;
    }

    removed.push(normalizePortable(path.relative(cwd, current)));

    if (!dryRun) {
      fs.rmdirSync(current);
    }

    current = path.dirname(current);
  }

  return removed;
}

function globToRegExp(pattern) {
  let output = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      output += ".*";
      index += 1;
    } else if (char === "*") {
      output += "[^/]*";
    } else if (char === "?") {
      output += "[^/]";
    } else if ("\\^$+?.()|{}[]".includes(char)) {
      output += `\\${char}`;
    } else {
      output += char;
    }
  }

  output += "$";
  return new RegExp(output);
}

function matchesPattern(filePath, pattern) {
  const value = normalizePortable(filePath);
  const normalizedPattern = normalizePortable(pattern);

  if (normalizedPattern.startsWith("**/") && matchesPattern(value, normalizedPattern.slice(3))) {
    return true;
  }

  if (!normalizedPattern.includes("*") && !normalizedPattern.includes("?")) {
    return value === normalizedPattern || value.startsWith(`${normalizedPattern}/`);
  }

  return globToRegExp(normalizedPattern).test(value);
}

function isAllowedEnvExample(relativePath) {
  const name = path.basename(relativePath).toLowerCase();
  return [".env.example", ".env.sample", ".env.template"].includes(name);
}

function isLikelyTextFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return !sample.includes(0);
}

function readTextFileSafely(filePath) {
  const stat = fs.statSync(filePath);

  if (stat.size > 1024 * 1024 || !isLikelyTextFile(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, "utf8");
}

function addIssue(target, code, message, file = null, line = null) {
  target.push({
    code,
    message,
    ...(file ? { file } : {}),
    ...(line ? { line } : {}),
  });
}

function walkProjectFiles(dir, { quick = false, depth = 0 } = {}) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  if (quick && depth > 5) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = normalizePortable(path.relative(cwd, fullPath));

    if (entry.isDirectory()) {
      if ([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"].includes(entry.name)) {
        continue;
      }

      if (relativePath === ".coding-flow/runs" || relativePath.startsWith(".coding-flow/runs/")) {
        continue;
      }

      files.push(...walkProjectFiles(fullPath, { quick, depth: depth + 1 }));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function findDirectories(dir, predicate, maxDepth = 3, depth = 0) {
  if (!fs.existsSync(dir) || depth > maxDepth) {
    return [];
  }

  const matches = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (predicate(fullPath, entry.name)) {
        matches.push(fullPath);
      }

      matches.push(...findDirectories(fullPath, predicate, maxDepth, depth + 1));
    }
  }

  return matches;
}

module.exports = {
  log,
  fail,
  toPortable,
  isCommandAvailable,
  binaryPathNote,
  normalizePortable,
  walkFiles,
  hashBuffer,
  hashFile,
  parseFrontmatter,
  readJson,
  writeJson,
  removeFileIfExists,
  isPathInside,
  removeEmptyDirsUpward,
  globToRegExp,
  matchesPattern,
  isAllowedEnvExample,
  isLikelyTextFile,
  readTextFileSafely,
  addIssue,
  walkProjectFiles,
  findDirectories,
};
