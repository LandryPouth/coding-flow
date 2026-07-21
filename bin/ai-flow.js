#!/usr/bin/env node

"use strict";

// Point d'entree mince : parse les arguments et dispatche vers les modules de
// bin/lib. La logique de chaque commande vit dans son propre module.

const { cwd } = require("./lib/context");
const { log, fail } = require("./lib/util");
const {
  copyTemplates,
  ensureConvenienceFiles,
  printConvenienceSummary,
  upgrade,
} = require("./lib/templates");
const { doctor } = require("./lib/doctor");
const { status } = require("./lib/status");
const { bootstrapScan } = require("./lib/bootstrap");
const { harnessCommand } = require("./lib/harness");
const { worktreeCommand } = require("./lib/worktree");
const { listSkills } = require("./lib/skills");
const { uninstall } = require("./lib/uninstall");
const { printCommands, printHelp } = require("./lib/commands");

const args = process.argv.slice(2);
const command = args[0] || "help";
const commandArgs = args.slice(1);
const flags = new Set(args.slice(1));

function getFlagValue(name, fallback = null) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));

  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);

  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }

  return fallback;
}

if (command === "init") {
  const result = copyTemplates({
    force: flags.has("--force"),
    dryRun: flags.has("--dry-run"),
  });
  const convenience = ensureConvenienceFiles({
    force: flags.has("--force"),
    dryRun: flags.has("--dry-run"),
  });

  if (flags.has("--dry-run")) {
    log("Dry run complete.");
  } else {
    log("Coding Flow installed.");
  }

  log(`Copied: ${result.copied.length}`);
  log(`Updated: ${result.updated.length}`);

  if (result.harnessCreated) {
    log(flags.has("--dry-run") ? "Harness config: would create" : "Harness config: created");
  }

  printConvenienceSummary(convenience, { dryRun: flags.has("--dry-run") });

  if (result.skipped.length > 0) {
    log(`Skipped existing files: ${result.skipped.length}`);
    log("Use --force to overwrite them.");
  }
} else if (command === "upgrade") {
  upgrade({
    force: flags.has("--force"),
    dryRun: flags.has("--dry-run"),
    json: flags.has("--json"),
  });
} else if (command === "doctor") {
  doctor({
    fix: flags.has("--fix"),
    json: flags.has("--json"),
    strict: flags.has("--strict"),
  });
} else if (command === "status") {
  status({
    json: flags.has("--json"),
  });
} else if (command === "bootstrap") {
  if (!flags.has("--scan")) {
    fail("bootstrap currently requires --scan");
  }

  bootstrapScan({
    json: flags.has("--json"),
    dryRun: flags.has("--dry-run"),
  });
} else if (command === "harness") {
  harnessCommand({ commandArgs, getFlagValue, flags });
} else if (command === "worktree") {
  worktreeCommand({
    commandArgs,
    from: getFlagValue("--from", null),
    deps: getFlagValue("--deps", null),
    story: getFlagValue("--story", null),
    dryRun: flags.has("--dry-run"),
    force: flags.has("--force"),
    cwd,
  });
} else if (command === "commands") {
  printCommands({
    json: flags.has("--json"),
  });
} else if (command === "uninstall") {
  uninstall({
    dryRun: flags.has("--dry-run"),
    force: flags.has("--force"),
    json: flags.has("--json"),
  });
} else if (command === "list-skills") {
  listSkills({
    json: flags.has("--json"),
  });
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else {
  fail(`unknown command "${command}". Run "ai-flow help".`);
}
