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
const { guardCommand } = require("./lib/guard");
const { worktreeCommand } = require("./lib/worktree");
const { shipCommand } = require("./lib/ship");
const { ensureConfig, STORAGE_BACKENDS } = require("./lib/config");
const { ensureHookSettings } = require("./lib/settings");
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
  const storage = getFlagValue("--storage", "local");

  if (!STORAGE_BACKENDS.includes(storage)) {
    fail(`unknown --storage "${storage}". Use one of: ${STORAGE_BACKENDS.join(", ")}.`);
  }

  if (storage !== "local") {
    fail(
      `storage backend "${storage}" n'est pas encore disponible. ` +
        "Seul \"local\" est supporté pour l'instant (voir docs/plans/storage-backends.md).",
    );
  }

  const result = copyTemplates({
    force: flags.has("--force"),
    dryRun: flags.has("--dry-run"),
  });
  const convenience = ensureConvenienceFiles({
    force: flags.has("--force"),
    dryRun: flags.has("--dry-run"),
  });
  const configResult = ensureConfig(cwd, {
    dryRun: flags.has("--dry-run"),
    storage,
    branchPerEpic: !flags.has("--no-branch-per-epic"),
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

  if (configResult.created) {
    const suffix = `storage=${configResult.config.storage}, branchPerEpic=${configResult.config.branchPerEpic}`;
    log(`${flags.has("--dry-run") ? "Config: would create" : "Config: created"} (${suffix})`);
  } else {
    log("Config: unchanged");
  }

  // Câble le hook PreToolUse `guard` : garde-fou déterministe (secrets/chemins
  // bloqués refusés AVANT écriture). Fusion non destructive dans settings.json.
  if (!flags.has("--no-guard")) {
    const hook = ensureHookSettings({ dryRun: flags.has("--dry-run") });
    const dry = flags.has("--dry-run");

    if (hook.status === "created") {
      log(dry ? "Guard hook: would create .claude/settings.json" : "Guard hook: wired in .claude/settings.json");
    } else if (hook.status === "merged") {
      log(dry ? "Guard hook: would merge into .claude/settings.json" : "Guard hook: merged into .claude/settings.json");
    } else if (hook.status === "unchanged") {
      log("Guard hook: already wired");
    } else if (hook.status === "unparseable") {
      log("Guard hook: skipped (.claude/settings.json is not valid JSON — wire `guard` manually)");
    }
  }

  printConvenienceSummary(convenience, { dryRun: flags.has("--dry-run") });

  if (result.skipped.length > 0) {
    log(`Skipped existing files: ${result.skipped.length}`);
    log("Use --force to overwrite them.");
  }
} else if (command === "upgrade") {
  // Migration : les projets installes avant le seam de stockage n'ont pas de
  // config.json. On la cree avec les defauts sans jamais ecraser un choix existant.
  ensureConfig(cwd, { dryRun: flags.has("--dry-run") });
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
} else if (command === "guard") {
  guardCommand({ getFlagValue, flags });
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
} else if (command === "ship") {
  shipCommand({ getFlagValue, flags, cwd });
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
