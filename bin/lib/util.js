"use strict";

// Generic helpers with no business logic: terminal I/O, hashing, JSON, paths,
// glob, file walking. Reused by every command.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");

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
  return crypto.createHash("sha256").update(buffer).digest("hex");
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
