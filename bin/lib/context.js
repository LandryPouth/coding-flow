"use strict";

// Constants shared by every command. A single place that knows the package root,
// the templates, the cwd, and the generated npm scripts.

const path = require("path");

const packageRoot = path.resolve(__dirname, "..", "..");
const templatesRoot = path.join(packageRoot, "templates");
const cwd = process.cwd();
const packageJson = require(path.join(packageRoot, "package.json"));
// The published npm package. Built from packageJson.name so it always matches the
// published scope. npx resolves it from the registry and caches it after the first
// call — users never install it by hand. (Previously fetched from GitHub via
// `npx github:…`; that only added latency and broke version pinning now that the
// package is published.)
const npxCommand = `npx ${packageJson.name}`;

const flowScripts = {
  flow: npxCommand,
  "flow:init": `${npxCommand} init`,
  "flow:upgrade": `${npxCommand} upgrade`,
  "flow:doctor": `${npxCommand} doctor`,
  "flow:fix": `${npxCommand} doctor --fix`,
  "flow:skills": `${npxCommand} list-skills`,
  "flow:status": `${npxCommand} status`,
  "flow:check": `${npxCommand} doctor --strict`,
  "flow:harness": `${npxCommand} harness check --quick`,
  "flow:commands": `${npxCommand} commands`,
  "flow:uninstall": `${npxCommand} uninstall`,
};

module.exports = {
  packageRoot,
  templatesRoot,
  cwd,
  packageJson,
  npxCommand,
  flowScripts,
};
