"use strict";

// Constants shared by every command. A single place that knows the package root,
// the templates, the cwd, and the generated npm scripts.

const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..", "..");
const templatesRoot = path.join(packageRoot, "templates");

// Every command operates on the PROJECT, not on the directory the user happened
// to stand in. Running `verify --story epics/x` from `apps/web` used to resolve
// the config, the story, and the evidence dir against `apps/web`: the config was
// not found, the declared validation commands were silently replaced by whatever
// `apps/web/package.json` had, and the evidence recorded `root: .../apps/web`.
// A proof that quietly proves something else is worse than no proof.
//
// `.coding-flow/` is the marker, so the root is wherever `init` actually ran —
// not the git root, which is the wrong answer for a repo holding several
// installs. When no marker exists above (a fresh `init`, or a project that never
// installed), this is process.cwd() and nothing changes.
const invocationDir = process.cwd();

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);

  for (;;) {
    if (fs.existsSync(path.join(current, ".coding-flow"))) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return startDir;
    }

    current = parent;
  }
}

const cwd = findProjectRoot(invocationDir);
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
  "flow:next": `${npxCommand} next`,
  "flow:check": `${npxCommand} doctor --strict`,
  "flow:harness": `${npxCommand} harness check --quick`,
  "flow:commands": `${npxCommand} commands`,
  "flow:uninstall": `${npxCommand} uninstall`,
};

module.exports = {
  packageRoot,
  templatesRoot,
  cwd,
  invocationDir,
  packageJson,
  npxCommand,
  flowScripts,
};
