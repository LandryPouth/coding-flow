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
const { readConfigReport } = require("./config");
const { readHarnessConfig, harnessMode } = require("./harness-config");
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

// The value in force for a key, as its consumer resolves it: each entry calls
// the consumer's own resolver, never a copy of its logic (plan.md D9 lists
// them). A key with no entry is read from readConfig / readHarnessConfig, which
// validate it themselves; `undefined` there means the reader dropped it and
// the default applies.
const lazy = (file) => () => require(file);
const coverage = lazy("./coverage");
const coverageGate = lazy("./coverage-gate");
const complexity = lazy("./complexity");
const redAtBase = lazy("./red-at-base");
const policyDrift = lazy("./policy-drift");

const RESOLVERS = {
  mode: (read) => harnessMode(read.harness),
  "coverageFloor.high": (read) => coverage().resolveCoverageFloor(read.harness).high,
  "coverageFloor.medium": (read) => coverage().resolveCoverageFloor(read.harness).medium,
  "coverageFloor.low": (read) => coverage().resolveCoverageFloor(read.harness).low,
  failOnContrarySignals: (read) => coverageGate().failsOnContrarySignals(read.harness),
  "functionSize.max": (read) => complexity().functionSizeSettings(read.harness).max,
  "functionSize.enforce": (read) => complexity().functionSizeSettings(read.harness).enforced,
  "redAtBase.command": (read) => redAtBase().redAtBaseSettings(read.harness).command,
  "redAtBase.timeoutMs": (read) => redAtBase().redAtBaseSettings(read.harness).timeoutMs,
  destructiveCommands: (read) => read.guard.destructiveCommands,
  allowDestructive: (read) => read.guard.allowDestructive,
  "worktrees.primaryLocked": (read) => read.guard.primaryLocked,
};

// Where the guard took the primary lock from when it is not this checkout's
// own file (guard.js primaryLock).
const LOCK_SOURCES = {
  primary: "project (the primary checkout's harness.json)",
  "primary-unreadable": "fixed: the primary checkout's harness.json unreadable",
};

// Keys the gates also read at the diff base (HEAD in working-tree scope), where
// the stricter wins: the value in force and a note, or null when the tree's
// own value is what applies.
function atTheBase(rule, read, value) {
  const gate = coverageGate();
  if (rule.key === "mode" || rule.key === "failOnContrarySignals") {
    const tree = gate.contraryPolicy(read.harness);
    const inForce = gate.contraryPolicyInForce(tree, read.base.config);
    if (rule.key === "mode" && inForce.strict && !tree.strict) {
      return { value, note: "base's strict still applies to contrary signals" };
    }
    if (rule.key === "failOnContrarySignals" && inForce.failOnContrarySignals && !tree.failOnContrarySignals) {
      return { value: true, note: "base's true still applies" };
    }
    return null;
  }
  if (gate.BASE_RISK_KEYS.includes(rule.key) && read.base.config) {
    const atBase = gate.baseRiskConfig(read.base.config)[rule.key];
    return isDeepStrictEqual(atBase, value) ? null : { value, note: `the base's ${atBase.length} ${rule.noun || "entries"} also score risk` };
  }
  if (rule.key === "policyGlobs") {
    const atBase = policyDrift().policyGlobsAtBase(read.base.harness);
    return isDeepStrictEqual(atBase, value) ? null : { value, note: `policy changes are found with the base's ${atBase.length} ${rule.noun}` };
  }
  return null;
}

function resolved(rule, read) {
  return RESOLVERS[rule.key] ? RESOLVERS[rule.key](read) : at(read[rule.file], rule.key);
}

function effective(rule, read) {
  const base = { key: rule.key, scope: rule.scope, file: rule.file ? `.coding-flow/${FILES[rule.file]}` : null, cap: rule.cap || null, doc: rule.doc };

  if (!rule.file) {
    return { ...base, value: defaultOf(rule.key), source: "fixed" };
  }

  const standing = rule.auto ? rule.auto(read.harness) : { value: defaultOf(rule.key), reason: null };
  const found = resolved(rule, read);
  const value = found === undefined ? standing.value : found;

  let result;
  if (read.unreadable.includes(rule.file)) {
    // The consumer reported the file unreadable: it applies what it applies
    // without it (the guard keeps the primary lock), and no project value.
    result = { value, source: `fixed: ${FILES[rule.file]} unreadable` };
  } else if (rule.key === "worktrees.primaryLocked" && LOCK_SOURCES[read.guard.lockedBy]) {
    result = { value, source: LOCK_SOURCES[read.guard.lockedBy] };
  } else {
    result = sourced(rule, read, value, standing);
  }
  const based = atTheBase(rule, read, result.value);
  return based ? { ...base, value: based.value, source: `${result.source} (${based.note})` } : { ...base, ...result };
}

// The source of the tree's value, before the diff base is considered.
function sourced(rule, read, value, standing) {
  const raw = at(read.raw[rule.file], rule.key);
  // What `init` once wrote for an auto rule (`coverageFloor.high: "auto"`) is
  // the same as no key.
  const inFile = has(read.raw[rule.file], rule.key) && !(rule.auto && isDeepStrictEqual(raw, defaultOf(rule.key)));
  const source = standing.reason ? `auto: ${standing.reason}` : "default";

  if (!inFile) return { value, source };
  // Every consumer compares the mode with "strict" only.
  if (rule.key === "mode" && value === "fast") return { value, source: "project (treated as standard)" };
  if (isDeepStrictEqual(value, raw)) return { value, source: "project" };
  // The reader refused the project's value and applies the default.
  if (isDeepStrictEqual(value, standing.value)) return { value, source: `${source} (project value ignored)` };
  // config.js readConfig records a target it does not know as "unrecognized".
  if (rule.key === "target" && value === "unrecognized") {
    return { value, source: 'project (not a known target: recorded as "unrecognized")' };
  }
  // The reader kept part of the value (malformed entries dropped, trimmed).
  return { value, source: "project (cleaned by the reader)" };
}

// The file's own content when it is a JSON object, else `{}`: only used to
// tell whether the project sets a key, never for the value in force.
function rawFile(root, name) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, ".coding-flow", FILES[name]), "utf8").replace(/^\uFEFF/, ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Unreadable is what the consumers report: readConfig's file reader for
// config.json, the guard's loadPolicy for harness.json (a parsed `null` or
// array is readable; the readers apply their defaults to it).
function readProject(root) {
  const guard = require("./guard").effectiveDestructivePolicy(root);
  const config = readConfigReport(root);
  return {
    raw: { config: rawFile(root, "config"), harness: rawFile(root, "harness") },
    unreadable: [...(config.unreadable ? ["config"] : []), ...(guard.unreadable ? ["harness"] : [])],
    guard,
    config: config.config,
    harness: readHarnessConfig(root).config,
    // What the gates read at the diff base (coverage-gate.js readBaseConfig,
    // policy-drift.js readBaseHarness).
    base: { config: coverageGate().readBaseConfig(), harness: policyDrift().readBaseHarness() },
  };
}

function effectiveRules(root = cwd, read = readProject(root)) {
  return RULES.map((rule) => effective(rule, read));
}

// The files `rules` must name above its table.
function unreadableNotes(root = cwd, read = readProject(root)) {
  const files = read.unreadable.map((name) => `.coding-flow/${FILES[name]}`);
  const lines = files.map((file) => `${file} cannot be read (invalid JSON or no permission): its rules below are what the readers apply without it.`);
  if (read.guard.lockedBy === "primary-unreadable") {
    lines.push(`${path.join(read.guard.primaryRoot, ".coding-flow", FILES.harness)} cannot be read: the guard keeps the primary checkout locked.`);
  }
  return { files, lines };
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

  const read = readProject(cwd);
  const rules = effectiveRules(cwd, read).filter((rule) => !wanted || rule.key === wanted);
  const notes = unreadableNotes(cwd, read);

  if (flags.has("--json")) {
    log(JSON.stringify({ unreadable: notes.files, rules }, null, 2));
    return;
  }

  for (const line of notes.lines) log(line);

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

module.exports = { rulesCommand, effectiveRules, unreadableNotes };
