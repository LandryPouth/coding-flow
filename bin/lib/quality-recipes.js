"use strict";

// Boundary and complexity checks the project could declare in
// `validation.quality`. Same contract as security-recipes.js: nothing is bundled
// or written, a recipe names a tool the project installs, and no import graph is
// parsed here — the project's own checker does that better (design-decisions,
// the native import checker refusal).
//
// Ecosystems are read from root manifests only. A recipe whose config file is
// already there is reported `present` instead of suggested.

const fs = require("fs");
const path = require("path");

const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
];

// An ESLint config is not the complexity check: nearly every Node project has
// one. It counts only when it names both rules; `package.json` counts only
// through its `eslintConfig` key.
const ESLINT_RULES = /^(?=[\s\S]*\bcomplexity\b)(?=[\s\S]*\bmax-lines-per-function\b)/;
const ESLINT_PACKAGE_RULES = /^(?=[\s\S]*"eslintConfig")(?=[\s\S]*\bcomplexity\b)(?=[\s\S]*\bmax-lines-per-function\b)/;

const DEPCRUISE_CONFIGS = [".dependency-cruiser.js", ".dependency-cruiser.cjs", ".dependency-cruiser.mjs", ".dependency-cruiser.json"];

// A section inside a shared manifest counts as the config: import-linter reads
// `[tool.importlinter]` from pyproject.toml and `[importlinter]` from setup.cfg.
const IMPORTLINTER_CONFIGS = [
  { file: ".importlinter" },
  { file: "importlinter.ini" },
  { file: "pyproject.toml", section: /^\[tool\.importlinter\]/m },
  { file: "setup.cfg", section: /^\[importlinter\]/m },
];

// ArchUnit has no config file: the dependency in the build is the sign.
const ARCHUNIT_CONFIGS = [
  { file: "pom.xml", section: /archunit/i },
  { file: "build.gradle", section: /archunit/i },
  { file: "build.gradle.kts", section: /archunit/i },
];

const ECOSYSTEMS = [
  { ecosystem: "node", markers: ["package.json"] },
  { ecosystem: "python", markers: ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile"] },
  { ecosystem: "java", markers: ["pom.xml", "build.gradle", "build.gradle.kts"] },
];

function sourceDir(root) {
  return fs.existsSync(path.join(root, "src")) ? "src" : ".";
}

function recipesFor(ecosystem, root) {
  if (ecosystem === "node") {
    const dir = sourceDir(root);
    return [
      {
        tool: "dependency-cruiser",
        kind: "boundary",
        command: `npx depcruise ${dir} --config`,
        configs: DEPCRUISE_CONFIGS.map((file) => ({ file })),
      },
      {
        tool: "eslint",
        kind: "complexity",
        command: "npx eslint .",
        note: "with the `complexity` and `max-lines-per-function` rules",
        configs: [
          ...ESLINT_CONFIGS.map((file) => ({ file, section: ESLINT_RULES })),
          { file: "package.json", section: ESLINT_PACKAGE_RULES },
        ],
      },
    ];
  }

  if (ecosystem === "python") {
    return [{ tool: "import-linter", kind: "boundary", command: "lint-imports", configs: IMPORTLINTER_CONFIGS }];
  }

  // ArchUnit rules are tests: the suite that already runs them is the command.
  return [
    {
      tool: "archunit",
      kind: "boundary",
      command: null,
      note: "an ArchUnit test, run by the test suite",
      configs: ARCHUNIT_CONFIGS,
    },
  ];
}

function readSafely(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function presentConfig(root, configs) {
  const found = configs.find(({ file, section }) => {
    const filePath = path.join(root, file);
    if (!section) {
      return fs.existsSync(filePath);
    }
    const text = readSafely(filePath);
    return text !== null && section.test(text);
  });
  return found ? found.file : null;
}

function detectQualityRecipes(root) {
  const present = (marker) => fs.existsSync(path.join(root, marker));

  return ECOSYSTEMS.filter(({ markers }) => markers.some(present)).flatMap(({ ecosystem }) =>
    recipesFor(ecosystem, root).map(({ tool, kind, command, note = null, configs }) => ({
      tool,
      ecosystem,
      kind,
      command,
      note,
      present: presentConfig(root, configs),
    })),
  );
}

module.exports = { detectQualityRecipes };
