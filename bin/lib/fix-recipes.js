"use strict";

// Fixer commands the project could declare in `validation.fix` (story 19-05).
// Same contract as quality-recipes.js: suggested, never written. Read from the
// root `package.json` scripts only: a script that already rewrites files
// (`--fix`, `--write`) is offered as is, and an ESLint `lint` script without
// one is offered with `-- --fix` appended.

const fs = require("fs");
const path = require("path");

const REWRITES = /(?:^|\s)--(?:fix|write)(?:\s|=|$)/;
// The scripts `init` adds (`flow:fix` is `doctor --fix`): Coding Flow's own
// repairs, not a formatter of the project's code.
const OWN = /(?:@landry_pouth\/)?coding-flow\b|\bai-flow\b/;

function readScripts(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8").replace(/^﻿/, ""));
    return pkg && pkg.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts) ? pkg.scripts : {};
  } catch {
    return {};
  }
}

function detectFixRecipes(root) {
  const scripts = readScripts(root);
  const recipes = [];

  for (const [name, text] of Object.entries(scripts)) {
    if (typeof text !== "string" || OWN.test(text)) {
      continue;
    }

    if (REWRITES.test(text)) {
      recipes.push({ script: name, command: `npm run ${name}` });
    }
  }

  const lint = scripts.lint;
  if (typeof lint === "string" && /\beslint\b/.test(lint) && !REWRITES.test(lint)) {
    recipes.push({ script: "lint", command: "npm run lint -- --fix" });
  }

  return recipes;
}

module.exports = { detectFixRecipes };
