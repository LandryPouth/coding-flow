"use strict";

// `ai-flow rules [--json] [<key>]` (story 26-06): every registered rule's value
// in force in this project and where it came from — `default`, `project`
// (the project file sets it), `auto: <reason>`, or `fixed` (in the code). Reads
// the two project files through the same readers the commands use, so the
// value printed is the value applied; prints no environment variable.

const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");

const { cwd } = require("./context");
const { log, fail } = require("./util");
const { readConfig } = require("./config");
const { readHarnessConfig } = require("./harness-config");
const { RULES, ruleFor, defaultOf } = require("./rules-registry");

const FILES = { config: "config.json", harness: "harness.json" };

function at(object, dotted) {
  return dotted.split(".").reduce((value, part) => (value && typeof value === "object" ? value[part] : undefined), object);
}

function has(object, dotted) {
  const parts = dotted.split(".");
  const parent = parts.length > 1 ? at(object, parts.slice(0, -1).join(".")) : object;
  return Boolean(parent && typeof parent === "object" && !Array.isArray(parent) && Object.prototype.hasOwnProperty.call(parent, parts[parts.length - 1]));
}

// The value the consumer applies for a key, `undefined` when it applies none
// (the default stands). Each entry calls, or mirrors line for line, the reader
// that consumes the key — never the raw merged file, which passes a malformed
// value through untouched (`"Strict"`, `"true"`, `"x"`). A key with no entry is
// read through readConfig / readHarnessConfig, which validate it themselves.
const FLOOR_RUNGS = ["verified", "evidence", "exempted", "not-required"];

function floorRung(read, key) {
  const value = at(read.harness, key);
  return FLOOR_RUNGS.includes(value) ? value : undefined;
}

function functionSize(read) {
  return require("./complexity").functionSizeSettings(read.harness);
}

function destructive(read, field) {
  return require("./guard").destructivePolicy(read.raw.harness)[field];
}

// config.js readConfig drops an empty `security` / `fix` list (the proof
// fingerprint must not change) and applies none: an explicit `[]` is the
// project's own choice, the same as the default.
function commandList(read, key) {
  const value = at(read.config, key);
  if (value !== undefined) return value;
  const raw = at(read.raw.config, key);
  return Array.isArray(raw) && raw.length === 0 ? [] : undefined;
}

const APPLIED = {
  "validation.security": (read) => commandList(read, "validation.security"),
  "validation.fix": (read) => commandList(read, "validation.fix"),
  // evidence.js, coverage-gate.js test `config.mode === "strict"`: a value
  // outside the modes `harness init --mode` accepts (`"Strict"`) is the default.
  mode: (read) => (["fast", "standard", "strict"].includes(read.harness.mode) ? read.harness.mode : undefined),
  // coverage.js resolveCoverageFloor: a rung, else the mode default.
  "coverageFloor.high": (read) => floorRung(read, "coverageFloor.high"),
  "coverageFloor.medium": (read) => floorRung(read, "coverageFloor.medium"),
  "coverageFloor.low": (read) => floorRung(read, "coverageFloor.low"),
  // coverage-gate.js: `config.failOnContrarySignals === true`.
  failOnContrarySignals: (read) => (typeof read.harness.failOnContrarySignals === "boolean" ? read.harness.failOnContrarySignals : undefined),
  // complexity.js settings().
  "functionSize.max": (read) => functionSize(read).max,
  "functionSize.enforce": (read) => functionSize(read).enforced,
  // red-at-base.js runRedAtBase(); `null` is the written "not set".
  "redAtBase.command": (read) => {
    const command = (read.harness.redAtBase || {}).command;
    if (command === null) return null;
    return typeof command === "string" && command.trim() ? command.trim() : undefined;
  },
  "redAtBase.timeoutMs": (read) => {
    const timeoutMs = (read.harness.redAtBase || {}).timeoutMs;
    return timeoutMs === null || Number.isFinite(timeoutMs) ? timeoutMs : undefined;
  },
  // Story 29-03's keys are read by the guard from the raw file.
  destructiveCommands: (read) => destructive(read, "destructiveCommands"),
  allowDestructive: (read) => destructive(read, "allowDestructive"),
  "worktrees.primaryLocked": (read) => destructive(read, "primaryLocked"),
};

// What a consumer applies when its file exists but cannot be read, where that
// is not its default. guard.js checkDestructive: "a policy file that cannot be
// read keeps the lock". Every other reader (readConfig, readHarnessConfig, the
// guard's destructivePolicy) falls back to its defaults.
const WHEN_UNREADABLE = { "worktrees.primaryLocked": true };

// What `init` writes to leave a key to its auto rule: the same as no key.
const AUTO_MARKERS = { "coverageFloor.high": "auto" };

function applied(rule, read) {
  return APPLIED[rule.key] ? APPLIED[rule.key](read) : at(read[rule.file], rule.key);
}

function effective(rule, read) {
  const base = { key: rule.key, scope: rule.scope, file: rule.file ? `.coding-flow/${FILES[rule.file]}` : null, cap: rule.cap || null, doc: rule.doc };
  const fallback = () => (rule.auto ? rule.auto(read.harness) : { value: defaultOf(rule.key), reason: null });

  if (!rule.file) {
    return { ...base, value: defaultOf(rule.key), source: "fixed" };
  }

  // The file exists but does not parse: no project value is applied, and some
  // consumers do more than fall back (the guard keeps the primary lock).
  if (read.unreadable.includes(rule.file)) {
    const kept = Object.prototype.hasOwnProperty.call(WHEN_UNREADABLE, rule.key) ? WHEN_UNREADABLE[rule.key] : applied(rule, read);
    return { ...base, value: kept !== undefined ? kept : fallback().value, source: `fixed: ${FILES[rule.file]} unreadable` };
  }

  const inFile =
    has(read.raw[rule.file], rule.key) && at(read.raw[rule.file], rule.key) !== AUTO_MARKERS[rule.key];
  const value = applied(rule, read);

  if (inFile && value !== undefined && isDeepStrictEqual(value, at(read.raw[rule.file], rule.key))) {
    return { ...base, value, source: "project" };
  }

  const standing = fallback();
  const source = standing.reason ? `auto: ${standing.reason}` : "default";

  // The reader refused the project's value and applies the default.
  if (inFile && (value === undefined || isDeepStrictEqual(value, standing.value))) {
    return { ...base, value: standing.value, source: `${source} (project value ignored)` };
  }

  // config.js readConfig records a target it does not know as "unrecognized".
  if (inFile && rule.key === "target" && value === "unrecognized") {
    return { ...base, value, source: 'project (not a known target: recorded as "unrecognized")' };
  }

  if (inFile) {
    // The reader kept part of the value (a list with malformed entries dropped).
    return { ...base, value, source: "project (cleaned by the reader)" };
  }

  return { ...base, value: standing.value, source };
}

// A file's parsed content, `{}` when absent, or `null` when it exists and cannot
// be read or parsed — the state the guard calls unreadable (guard.js loadPolicy).
function rawFile(root, name) {
  const file = path.join(root, ".coding-flow", FILES[name]);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function readProject(root) {
  const raw = { config: rawFile(root, "config"), harness: rawFile(root, "harness") };
  const unreadable = Object.keys(raw).filter((name) => raw[name] === null);
  for (const name of unreadable) raw[name] = {};
  return { raw, unreadable, config: readConfig(root), harness: readHarnessConfig(root).config };
}

function effectiveRules(root = cwd) {
  const read = readProject(root);
  return RULES.map((rule) => effective(rule, read));
}

function unreadableFiles(root = cwd) {
  return readProject(root).unreadable.map((name) => `.coding-flow/${FILES[name]}`);
}

function shown(rule) {
  const { value } = rule;
  const registered = ruleFor(rule.key);
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `${value.length} ${registered.noun || "entries"}`;
  const text = value === null ? "null" : String(value);
  return registered.unit && registered.unit !== "%" ? `${text} ${registered.unit}` : `${text}${registered.unit === "%" ? "%" : ""}`;
}

function rulesCommand({ commandArgs, flags }) {
  const wanted = commandArgs.find((arg) => !arg.startsWith("-")) || null;

  if (wanted && !ruleFor(wanted)) {
    fail(`unknown rule "${wanted}". Run "ai-flow rules" for the list.`);
  }

  const rules = effectiveRules().filter((rule) => !wanted || rule.key === wanted);

  const unreadable = unreadableFiles();

  if (flags.has("--json")) {
    log(JSON.stringify({ unreadable, rules }, null, 2));
    return;
  }

  for (const file of unreadable) {
    log(`${file} cannot be read (invalid JSON or no permission): its rules below are what the readers apply without it.`);
  }

  if (wanted) {
    const [rule] = rules;
    log(`${rule.key}: ${shown(rule)}`);
    log(`  source: ${rule.source}${rule.file ? ` (${rule.file})` : ""}`);
    if (rule.cap) log(`  limit: ${rule.cap}`);
    log(`  ${rule.doc}`);
    log("  More: docs/rules-and-limits.md");
    return;
  }

  const width = Math.max(...rules.map((rule) => rule.key.length)) + 2;
  const valueWidth = Math.max(...rules.map((rule) => shown(rule).length)) + 2;

  for (const rule of rules) {
    log(`${rule.key.padEnd(width)}${shown(rule).padEnd(valueWidth)}${rule.source}`);
  }

  log("");
  log("Sources: default · project (.coding-flow/config.json or harness.json) · auto (computed, reason given) · fixed (in the code).");
  log("One rule in detail: ai-flow rules <key>. All rules, planned ones included: docs/rules-and-limits.md.");
}

module.exports = { rulesCommand, effectiveRules, unreadableFiles };
