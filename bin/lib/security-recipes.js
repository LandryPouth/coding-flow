"use strict";

// Security scanners the project could declare in `validation.security`. Nothing
// is bundled or downloaded (zero runtime dependencies): a recipe is a suggestion
// for a tool the developer installs, and `verify` proves what actually ran.
//
// Ecosystems are read from root manifests only; a member package in a
// subdirectory is covered by the root lockfile (npm, pnpm) or not at all.

const fs = require("fs");
const path = require("path");

// `match` is the command words a declared command must name to count as this recipe.
const ECOSYSTEM_RECIPES = [
  {
    tool: "pnpm-audit",
    ecosystem: "pnpm",
    // `pnpm audit` reads the lockfile and errors without one: a workspace file
    // alone would suggest a command that can only fail.
    markers: ["pnpm-lock.yaml"],
    command: "pnpm audit --prod --audit-level high",
    match: "pnpm audit",
  },
  {
    tool: "npm-audit",
    ecosystem: "npm",
    markers: ["package-lock.json", "npm-shrinkwrap.json"],
    command: "npm audit --omit=dev --audit-level=high",
    match: "npm audit",
  },
  { tool: "govulncheck", ecosystem: "go", markers: ["go.mod", "go.work"], command: "govulncheck ./...", match: "govulncheck" },
  {
    tool: "pip-audit",
    ecosystem: "python",
    markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"],
    command: "pip-audit",
    match: "pip-audit",
  },
];

// Not tied to an ecosystem: suggested only when the binary is already installed.
const BINARY_RECIPES = [
  { tool: "gitleaks", command: "gitleaks detect --no-banner", match: "gitleaks" },
  { tool: "semgrep", command: "semgrep --config auto --error", match: "semgrep" },
];

function isExecutableFile(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) {
      return false;
    }

    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(binary, env = process.env) {
  const extensions = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];

  return (env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => extensions.some((ext) => isExecutableFile(path.join(dir, `${binary}${ext}`))));
}

// A pnpm project often still carries a stale package-lock.json; one audit is enough.
function detectSecurityRecipes(root, env = process.env) {
  const present = (marker) => fs.existsSync(path.join(root, marker));
  const ecosystems = ECOSYSTEM_RECIPES.filter((recipe) => recipe.markers.some(present));
  const hasPnpm = ecosystems.some((recipe) => recipe.ecosystem === "pnpm");

  return [
    ...ecosystems.filter((recipe) => !(hasPnpm && recipe.ecosystem === "npm")),
    ...BINARY_RECIPES.filter((recipe) => onPath(recipe.tool, env)),
  ].map(({ tool, ecosystem = null, command, match }) => ({ tool, ecosystem, command, match }));
}

// Which declared security commands exist, and which recipes apply but are not
// declared. Entries are strings or `{ command, timeoutMs }`.
function securityCoverage(recipes, declaredEntries) {
  const declared = (declaredEntries || []).map((entry) => (typeof entry === "string" ? entry : entry.command));

  // A whole command word: "pnpm audit" does not declare `npm audit`.
  const names = (recipe) => new RegExp(`(?:^|[\\s;&|(])${recipe.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`);

  return {
    declared,
    undeclared: recipes.filter((recipe) => !declared.some((command) => names(recipe).test(command))),
  };
}

module.exports = { detectSecurityRecipes, securityCoverage, onPath };
