"use strict";

// Constantes partagees par toutes les commandes. Un seul endroit qui connait la
// racine du package, les templates, le cwd et les scripts npm generes.

const path = require("path");

const packageRoot = path.resolve(__dirname, "..", "..");
const templatesRoot = path.join(packageRoot, "templates");
const cwd = process.cwd();
const packageJson = require(path.join(packageRoot, "package.json"));
const githubNpxCommand = "npx github:LandryPouth/codin-flow";

const flowScripts = {
  flow: githubNpxCommand,
  "flow:init": `${githubNpxCommand} init`,
  "flow:upgrade": `${githubNpxCommand} upgrade`,
  "flow:doctor": `${githubNpxCommand} doctor`,
  "flow:fix": `${githubNpxCommand} doctor --fix`,
  "flow:skills": `${githubNpxCommand} list-skills`,
  "flow:status": `${githubNpxCommand} status`,
  "flow:check": `${githubNpxCommand} doctor --strict`,
  "flow:harness": `${githubNpxCommand} harness check --quick`,
  "flow:commands": `${githubNpxCommand} commands`,
  "flow:uninstall": `${githubNpxCommand} uninstall`,
};

module.exports = {
  packageRoot,
  templatesRoot,
  cwd,
  packageJson,
  githubNpxCommand,
  flowScripts,
};
