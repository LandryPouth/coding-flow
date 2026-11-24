"use strict";

// `ai-flow rules [--json] [<key>]` (story 26-06): every registered rule's value
// in force in this project and where it came from — `default`, `project`
// (the project file sets it), `auto: <reason>`, or `fixed` (in the code). Reads
// the two project files through the same readers the commands use, so the
// value printed is the value applied; prints no environment variable.

const path = require("path");
const { isDeepStrictEqual } = require("util");

const { cwd } = require("./context");
const { log, fail, readJson } = require("./util");
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

// The value a reader applies for a key, `undefined` when it applies none (the
// default stands).
function applied(rule, read) {
  if (rule.key === "validation.timeoutMs") {
    const value = at(read.config, rule.key);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  if (rule.key.startsWith("coverageFloor.")) {
    const value = at(read.harness, rule.key);
    return ["verified", "evidence", "exempted", "not-required"].includes(value) ? value : undefined;
  }

  // Story 29-03's keys are read by the guard from the raw file, not by
  // readHarnessConfig: apply its own reading.
  if (["destructiveCommands", "allowDestructive", "worktrees.primaryLocked"].includes(rule.key)) {
    const policy = require("./guard").destructivePolicy(read.raw.harness);
    const value = rule.key === "worktrees.primaryLocked" ? policy.primaryLocked : policy[rule.key];
    return value;
  }

  return at(read[rule.file], rule.key);
}

function effective(rule, read) {
  const base = { key: rule.key, scope: rule.scope, file: rule.file ? `.coding-flow/${FILES[rule.file]}` : null, cap: rule.cap || null, doc: rule.doc };
  const fallback = () => (rule.auto ? rule.auto(read.harness) : { value: defaultOf(rule.key), reason: null });

  if (!rule.file) {
    return { ...base, value: defaultOf(rule.key), source: "fixed" };
  }

  const inFile = has(read.raw[rule.file], rule.key);
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

  if (inFile) {
    // The reader kept part of the value (a list with malformed entries dropped).
    return { ...base, value, source: "project (cleaned by the reader)" };
  }

  return { ...base, value: standing.value, source };
}

function effectiveRules(root = cwd) {
  const read = {
    raw: {
      config: readJson(path.join(root, ".coding-flow", FILES.config), null) || {},
      harness: readJson(path.join(root, ".coding-flow", FILES.harness), null) || {},
    },
    config: readConfig(root),
    harness: readHarnessConfig(root).config,
  };

  return RULES.map((rule) => effective(rule, read));
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

  if (flags.has("--json")) {
    log(JSON.stringify({ rules }, null, 2));
    return;
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

module.exports = { rulesCommand, effectiveRules };
