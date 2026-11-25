"use strict";

// Story 26-06: one registry of the rules a user can see, and the values they
// start from. `config.js`, `harness-config.js`, `validation-run.js`,
// `worktree.js`, `doctor.js`, `guard.js` and `status.js` read their defaults
// here; `ai-flow rules` prints them with the value in force and where it came
// from; a test keeps `docs/rules-and-limits.md` equal to them.
//
// A leaf: nothing here requires another module of the tool at load time (the
// config readers require this file). The harness.json defaults are the one
// exception to "defined here": they stay in `harness-config.js`, which the
// guard loads before every tool call within a module budget, and `defaultFrom`
// reads them from there on demand — still one definition per default.
//
// Fields: `key` (dotted path in its file), `file` (`config` = config.json,
// `harness` = harness.json, null = not a file key), `scope` (`project` — the
// project file sets it; `auto` — computed, with a reason, unless the project
// sets it; `fixed` — in the code, not configurable; `user` is reserved for the
// user global config, which does not exist yet), `default` or `defaultFrom`,
// `unit`, `noun` (how a list default is counted in the doc), `cap`, `doc`, and
// `story` when a story added the rule. Planned keys are not registered until
// their story ships (the doc keeps them in Part 2). No key that looks like a
// secret is ever registered.

const harnessList = (name) => () => require("./harness-config")[name]();
const guardDefault = (field) => () => require("./guard").destructivePolicy({})[field];
const harnessDefault = (dotted) => () =>
  dotted.split(".").reduce((value, part) => value[part], require("./harness-config").defaultHarnessConfig());

const RULES = [
  // .coding-flow/config.json
  { key: "storage", file: "config", scope: "project", default: "local", cap: "`local` or `github` (reserved)", doc: "Where epics and stories live." },
  { key: "branchPerEpic", file: "config", scope: "project", default: true, cap: "advisory: status warns on the default branch", doc: "One epic, one branch, never main." },
  { key: "autoMergeEpic", file: "config", scope: "project", default: false, doc: "ship merges the epic's PR once every story is proven." },
  { key: "skills", file: "config", scope: "project", default: "project", cap: "`plugin` or `project`", doc: "Where the skills come from." },
  { key: "install", file: "config", scope: "project", default: "full", cap: "`full` or `minimal`", doc: "How much of the tool this project installed." },
  { key: "target", file: "config", scope: "project", default: "claude", doc: "The agent platform the project was installed for." },
  { key: "alsoTargets", file: "config", scope: "project", default: [], noun: "platforms", doc: "Platforms added after the first." },
  { key: "validation.commands", file: "config", scope: "project", default: [], noun: "commands", doc: "Correctness checks verify runs." },
  { key: "validation.quality", file: "config", scope: "project", default: [], noun: "commands", doc: "Quality checks verify runs; red blocks." },
  { key: "validation.freshCommands", file: "config", scope: "project", default: [], noun: "commands", doc: "Commands whose cached replay is not proof." },
  { key: "validation.security", file: "config", scope: "project", default: [], noun: "commands", doc: "Scanners; one that cannot run is not examined." },
  { key: "validation.fix", file: "config", scope: "project", default: [], noun: "commands", story: "19-05", doc: "Fixers verify runs before any check." },
  { key: "validation.timeoutMs", file: "config", scope: "project", default: 600000, unit: "ms", cap: "a non-positive value is dropped", doc: "Time limit per validation command." },
  { key: "docs.check.include", file: "config", scope: "project", default: ["docs/**/*.md", "README.md", "RULES.md"], noun: "globs", story: "26-03", cap: "a list of non-empty strings, else the default", doc: "The docs `ai-flow docs check` reads." },
  { key: "docs.check.exclude", file: "config", scope: "project", default: [], noun: "globs", story: "26-03", doc: "Docs left out of `docs check`." },
  { key: "docs.check.ignorePaths", file: "config", scope: "project", default: [], noun: "globs", story: "26-03", doc: "Missing paths `docs check` never reports." },

  // .coding-flow/harness.json
  { key: "mode", file: "harness", scope: "project", defaultFrom: harnessDefault("mode"), cap: "only `strict` tightens", doc: "How hard the gates and the guard bite." },
  { key: "requireTestChange", file: "harness", scope: "project", defaultFrom: harnessDefault("requireTestChange"), doc: "The coverage gate is on." },
  { key: "minPatchCoverage", file: "harness", scope: "project", defaultFrom: harnessDefault("minPatchCoverage"), unit: "%", doc: "Share of added lines the suite must execute." },
  { key: "coverageReports", file: "harness", scope: "project", defaultFrom: () => require("./harness-config").DEFAULT_REPORT_PATHS, noun: "paths", doc: "Where coverage reports are looked for." },
  {
    key: "coverageFloor.high",
    file: "harness",
    scope: "auto",
    default: "auto",
    cap: "`verified` > `evidence` > `exempted` > `not-required`",
    doc: "Rung a high-risk story must reach; `auto` follows the mode.",
    // The coverage reader's own default, under the mode as written (a typo
    // such as "Strict" is named, and resolves as the reader resolves it).
    auto: (harness) => {
      const mode = harness && harness.mode !== undefined ? harness.mode : harnessDefault("mode")();
      const value = require("./coverage").defaultCoverageFloor(mode).high;
      return { value, reason: `mode ${mode} → ${value}` };
    },
  },
  { key: "coverageFloor.medium", file: "harness", scope: "project", defaultFrom: () => require("./coverage").defaultCoverageFloor(harnessDefault("mode")()).medium, doc: "Rung a medium-risk story must reach." },
  { key: "coverageFloor.low", file: "harness", scope: "project", defaultFrom: () => require("./coverage").defaultCoverageFloor(harnessDefault("mode")()).low, doc: "Rung a low-risk story must reach." },
  { key: "failOnContrarySignals", file: "harness", scope: "project", defaultFrom: () => require("./coverage-gate").failsOnContrarySignals({}), doc: "Contrary signals fail a high-risk story." },
  { key: "freshTestsFor", file: "harness", scope: "project", defaultFrom: harnessDefault("freshTestsFor"), noun: "risk levels", doc: "Risk levels where a cached run is not proof." },
  { key: "functionSize.max", file: "harness", scope: "project", defaultFrom: harnessDefault("functionSize.max"), unit: "lines", doc: "Function length past which verify warns." },
  { key: "functionSize.enforce", file: "harness", scope: "project", defaultFrom: harnessDefault("functionSize.enforce"), doc: "The function-size warning fails verify." },
  { key: "redAtBase.command", file: "harness", scope: "project", defaultFrom: harnessDefault("redAtBase.command"), doc: "Targeted command for verify --red-at-base." },
  { key: "redAtBase.timeoutMs", file: "harness", scope: "project", defaultFrom: harnessDefault("redAtBase.timeoutMs"), doc: "Its time limit; null means the command default." },
  { key: "highRiskPaths", file: "harness", scope: "project", defaultFrom: harnessList("defaultHighRiskPaths"), noun: "globs", doc: "Paths that make a diff high risk." },
  { key: "highRiskTerms", file: "harness", scope: "project", defaultFrom: () => require("./harness-config").defaultHarnessConfig().highRiskTerms, noun: "terms", doc: "Words that make a story's prose medium risk." },
  { key: "testGlobs", file: "harness", scope: "project", defaultFrom: harnessList("defaultTestGlobs"), noun: "globs", doc: "What counts as a test file." },
  { key: "nonBehaviorGlobs", file: "harness", scope: "project", defaultFrom: harnessList("defaultNonBehaviorGlobs"), noun: "globs", doc: "Files that change no behaviour." },
  { key: "policyGlobs", file: "harness", scope: "project", defaultFrom: harnessList("defaultPolicyGlobs"), noun: "globs", doc: "Files whose change is a policy change." },
  { key: "ignoredPaths", file: "harness", scope: "project", defaultFrom: harnessDefault("ignoredPaths"), noun: "globs", doc: "Generated output left out of the signals." },
  { key: "blockedPaths", file: "harness", scope: "project", defaultFrom: () => require("./harness-config").defaultHarnessConfig().blockedPaths, noun: "globs", doc: "Paths the guard refuses to write." },
  { key: "sensitiveGlobs", file: "harness", scope: "project", defaultFrom: () => require("./harness-config").defaultHarnessConfig().sensitiveGlobs, noun: "globs", doc: "Files harness check flags." },
  { key: "requiredChecks", file: "harness", scope: "project", defaultFrom: () => require("./harness-config").defaultHarnessConfig().requiredChecks, noun: "checks", doc: "Check names the harness contract lists (nothing runs them); a high-risk story adds 3." },

  // Story 29-03: read by the guard, which defines their fallbacks
  // (`destructivePolicy`); the human's edit only.
  { key: "destructiveCommands", file: "harness", scope: "project", defaultFrom: guardDefault("destructiveCommands"), story: "29-03", cap: "`deny`, `warn` or `off`; anything else reads as `deny`", doc: "What the guard does with a destructive command." },
  { key: "allowDestructive", file: "harness", scope: "project", defaultFrom: guardDefault("allowDestructive"), noun: "commands", story: "29-03", cap: "exact commands; a bare `*` or a verb-only `*` entry is ignored", doc: "Destructive commands the human allows." },
  { key: "worktrees.primaryLocked", file: "harness", scope: "project", defaultFrom: guardDefault("primaryLocked"), story: "29-03", doc: "No branch change in the primary checkout." },

  // In the code, not configurable.
  { key: "epic.maxStories", file: null, scope: "fixed", default: 7, unit: "stories", doc: "doctor warns `epic_too_large` above it." },
  { key: "review.strictCleanRounds", file: null, scope: "fixed", default: 2, unit: "rounds", story: "19-09", doc: "Passing rounds in a row a STRICT story needs after a failed review." },
];

// Context budgets: stated by the flow-run skill, never by RULES.md (which
// points at the skill). Kept here so the two cannot drift apart unseen.
const CONTEXT_BUDGETS = [
  { key: "context.quickBudget", text: "1–3 targeted searches (at most ~5 files read" },
  { key: "context.scoutBudget", text: "Budget: ~8 searches, ~12 files" },
  { key: "context.stopAndScout", text: "~5\nsearches or ~8 files means stop and scout" },
];

function ruleFor(key, rules = RULES) {
  return rules.find((rule) => rule.key === key) || null;
}

function valueOfRule(rule) {
  if (!Object.prototype.hasOwnProperty.call(rule, "default") && typeof rule.defaultFrom === "function") return rule.defaultFrom();
  return Array.isArray(rule.default) ? [...rule.default] : rule.default;
}

function defaultOf(key, rules = RULES) {
  const rule = ruleFor(key, rules);
  if (!rule) throw new Error(`unknown rule "${key}"`);
  return valueOfRule(rule);
}

// How docs/rules-and-limits.md writes a default: a scalar in backticks with
// its unit, an empty list as `[]`, a list by its count.
function docDefault(rule) {
  const value = valueOfRule(rule);
  if (Array.isArray(value)) return value.length === 0 ? "`[]`" : `${value.length} ${rule.noun || "entries"}`;
  return `\`${value === null ? "null" : String(value)}\`${rule.unit ? ` ${rule.unit}` : ""}`;
}

// The doc rows of Part 1 (shipped code), keyed by every backticked name in
// their first cell.
function docRows(doc) {
  const start = doc.indexOf("## Part 1");
  const end = doc.indexOf("## Part 2");
  const part = doc.slice(start < 0 ? 0 : start, end < 0 ? doc.length : end);
  const rows = new Map();

  for (const line of part.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*-/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    for (const [, name] of cells[0].matchAll(/`([^`]+)`/g)) {
      if (!rows.has(name)) rows.set(name, cells);
    }
  }

  return rows;
}

// Every registry key must have a Part 1 row whose Default cell states its
// default the way `docDefault` writes it. Returns what does not match.
function docMismatches(doc, rules = RULES) {
  const rows = docRows(doc);
  const out = [];

  for (const rule of rules) {
    const expected = docDefault(rule);
    const row = rows.get(rule.key);

    if (!row) {
      out.push({ key: rule.key, expected, message: `${rule.key}: no row in docs/rules-and-limits.md Part 1 (default ${expected})` });
    } else if (!row[1].includes(expected)) {
      out.push({ key: rule.key, expected, message: `${rule.key}: the doc's default is "${row[1]}", the registry's is ${expected}` });
    }
  }

  return out;
}

function contextBudgets() {
  return CONTEXT_BUDGETS.map((budget) => ({ ...budget }));
}

// "N searches" / "N files" as a text states them, normalised ("~5 files").
function budgetNumbersIn(text) {
  return [...text.matchAll(/~?\s*(\d+(?:–\d+)?)\s+(?:targeted\s+)?(searches|files)\b/g)].map(([, n, unit]) => `${n} ${unit}`);
}

module.exports = { RULES, ruleFor, defaultOf, docDefault, docMismatches, contextBudgets, budgetNumbersIn };
