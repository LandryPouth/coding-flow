#!/usr/bin/env node

"use strict";

// Thin entry point: parses the arguments and dispatches to the bin/lib modules.
// The logic of each command lives in its own module.

// A crash used to reach the user as a raw Node stack trace. Agents driving this
// CLI reported that as "the tool errored internally" with nothing actionable in
// it, and a stack trace is not a diagnosis for the human either. Registered
// before the requires so a module that fails to load is covered too.
process.on("uncaughtException", (error) => {
  if (error && error.code === "EPIPE") {
    process.exit(0);
  }

  process.stderr.write(`Error: ${(error && error.message) || error}\n`);
  process.stderr.write(
    "This is a Coding Flow bug, not a validation failure. " +
      "Re-run with CODING_FLOW_DEBUG=1 for the stack trace, and please report it.\n",
  );

  if (process.env.CODING_FLOW_DEBUG && error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }

  process.exit(1);
});

const { cwd, invocationDir } = require("./lib/context");
const { log, fail } = require("./lib/util");
const {
  copyTemplates,
  ensureConvenienceFiles,
  printConvenienceSummary,
  printPrunedSkills,
  upgrade,
} = require("./lib/templates");
const { doctor } = require("./lib/doctor");
const { status } = require("./lib/status");
const { bootstrapScan, scanProject, printProjectScanSummary } = require("./lib/bootstrap");
const { harnessCommand } = require("./lib/harness");
const { guardCommand } = require("./lib/guard");
const { auditCommand } = require("./lib/audit");
const { traceCommand } = require("./lib/trace");
const { ciCommand } = require("./lib/ci");
const { pluginCommand } = require("./lib/plugin");
const { worktreeCommand } = require("./lib/worktree");
const { shipCommand } = require("./lib/ship");
const { runCommand } = require("./lib/run");
const { hookCommand } = require("./lib/hook");
const {
  ensureConfig,
  readConfigSkillsChoice,
  writeConfigSkills,
  STORAGE_BACKENDS,
} = require("./lib/config");
const { detectPlugin } = require("./lib/claude-plugin");
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

// Commands operate on the project, not on the directory the user stood in. When
// those differ, say so once: a silently relocated root is how a verify ends up
// proving a subpackage while reporting the project. stderr, so `--json` stays
// machine-readable on stdout.
if (cwd !== invocationDir) {
  process.stderr.write(`Coding Flow project root: ${cwd} (invoked from ${invocationDir})\n`);
}

// Which channel serves this project's skills. `--with-skills` / `--no-skills`
// are the explicit overrides; otherwise the plugin, when installed, wins — it
// already provides them globally, and a second copy under a second name is the
// confusion this resolves.
function resolveSkillsMode() {
  if (flags.has("--with-skills")) {
    return { mode: "project", reason: "--with-skills" };
  }

  if (flags.has("--no-skills")) {
    return { mode: "plugin", reason: "--no-skills" };
  }

  const detection = detectPlugin();

  return detection.installed
    ? { mode: "plugin", reason: `plugin detected (${detection.source})` }
    : { mode: "project", reason: "no plugin detected" };
}

function describeSkillsMode(mode, reason) {
  return mode === "plugin"
    ? `Skills: served by the plugin as coding-flow:flow-* — no project copy (${reason})`
    : `Skills: installed in .claude/skills as /flow-* (${reason})`;
}

if (command === "init") {
  const storage = getFlagValue("--storage", "local");

  if (!STORAGE_BACKENDS.includes(storage)) {
    fail(`unknown --storage "${storage}". Use one of: ${STORAGE_BACKENDS.join(", ")}.`);
  }

  if (storage !== "local") {
    fail(
      `storage backend "${storage}" is not available yet. ` +
        "Only \"local\" is supported for now (see docs/plans/storage-backends.md).",
    );
  }

  const skills = resolveSkillsMode();
  // Config first: on a re-init, the choice recorded at the original install wins
  // over whatever this machine detects, so the copy below matches the config.
  const configResult = ensureConfig(cwd, {
    dryRun: flags.has("--dry-run"),
    storage,
    branchPerEpic: !flags.has("--no-branch-per-epic"),
    skills: skills.mode,
  });
  const effectiveSkills = configResult.config.skills;
  const result = copyTemplates({
    force: flags.has("--force"),
    dryRun: flags.has("--dry-run"),
    includeSkills: effectiveSkills === "project",
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
  // An existing project already had a config, so its recorded choice wins over
  // what we just detected — say which one is actually in effect.
  log(describeSkillsMode(effectiveSkills, configResult.created ? skills.reason : "recorded at init"));
  printPrunedSkills(result.prunedSkills, { dryRun: flags.has("--dry-run") });

  if (result.harnessCreated) {
    log(flags.has("--dry-run") ? "Harness config: would create" : "Harness config: created");
  }

  if (configResult.created) {
    const suffix = `storage=${configResult.config.storage}, branchPerEpic=${configResult.config.branchPerEpic}`;
    log(`${flags.has("--dry-run") ? "Config: would create" : "Config: created"} (${suffix})`);
  } else {
    log("Config: unchanged");
  }

  // Wires the `guard` PreToolUse hook: deterministic guardrail (secrets/blocked
  // paths refused BEFORE the write). Non-destructive merge into settings.json.
  if (!flags.has("--no-guard")) {
    const hook = ensureHookSettings({ dryRun: flags.has("--dry-run") });
    const dry = flags.has("--dry-run");

    if (hook.status === "created") {
      log(dry ? "Guard hook: would create .claude/settings.json" : "Guard hook: wired in .claude/settings.json");
    } else if (hook.status === "merged") {
      log(dry ? "Guard hook: would merge into .claude/settings.json" : "Guard hook: merged into .claude/settings.json");
    } else if (hook.status === "upgraded") {
      log(dry ? "Guard hook: would upgrade to the resolved binary" : "Guard hook: upgraded to the resolved binary");
    } else if (hook.status === "unchanged") {
      log("Guard hook: already wired");
    } else if (hook.status === "unparseable") {
      log("Guard hook: skipped (.claude/settings.json is not valid JSON — wire `guard` manually)");
    }
  }

  printConvenienceSummary(convenience, { dryRun: flags.has("--dry-run") });

  // Name them. On a brownfield repo the collision is typically the project's own
  // docs/architecture.md, and "use --force to overwrite them" then reads as advice
  // to replace a real architecture document with a template stub.
  if (result.skipped.length > 0) {
    log("");
    log(`Kept ${result.skipped.length} existing file${result.skipped.length === 1 ? "" : "s"} (yours, not overwritten):`);
    for (const file of result.skipped) {
      log(`- ${file}`);
    }
    log("Use --force only if you want the Coding Flow templates to replace them.");
  }

  // Brownfield detection, last so it reads as the next step. The scan is a
  // function call, not an artifact: nothing is written, and the deliverable is
  // the pointer to /flow-plan — the expensive half of onboarding it cannot do.
  printProjectScanSummary(scanProject(), { dryRun: flags.has("--dry-run") });
} else if (command === "upgrade") {
  // Migration: projects installed before the storage seam have no config.json.
  // We create it with the defaults without ever overwriting an existing choice.
  // Read the recorded choice BEFORE ensureConfig, which would otherwise write a
  // default and make "never chose" indistinguishable from "chose project".
  const recorded = readConfigSkillsChoice(cwd);
  let skills;
  let reason;

  if (flags.has("--with-skills") || flags.has("--no-skills")) {
    // The explicit way to MOVE channel: --no-skills hands the skills to the
    // plugin and drops this project's copies, --with-skills brings them back.
    ({ mode: skills, reason } = resolveSkillsMode());
  } else if (recorded) {
    // An install that already chose is never second-guessed — not even when
    // this machine would detect something different.
    skills = recorded;
    reason = "recorded in .coding-flow/config.json";
  } else {
    // A project installed before this was a choice. Upgrading is exactly when
    // it gets made, so nobody has to re-run `init` to stop having two names for
    // one skill.
    const detection = resolveSkillsMode();
    skills = detection.mode;
    reason = `${detection.reason}, recorded now`;
  }

  ensureConfig(cwd, { dryRun: flags.has("--dry-run"), skills });

  if (!flags.has("--dry-run") && recorded !== skills) {
    writeConfigSkills(cwd, skills);
  }

  if (!flags.has("--json")) {
    log(describeSkillsMode(skills, reason));
  }

  upgrade({
    force: flags.has("--force"),
    dryRun: flags.has("--dry-run"),
    json: flags.has("--json"),
    includeSkills: skills === "project",
    skillsMode: skills,
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
    force: flags.has("--force"),
  });
} else if (command === "harness") {
  harnessCommand({ commandArgs, getFlagValue, flags });
} else if (command === "verify") {
  // Top-level alias of `harness verify`. The harness namespace earns itself for
  // preflight/check/evidence, which nobody types by hand; verify is the one a
  // user reaches for — re-proving a story that went `stale` after a small edit.
  harnessCommand({ commandArgs: ["verify"], getFlagValue, flags });
} else if (command === "guard") {
  guardCommand({ getFlagValue, flags });
} else if (command === "audit") {
  auditCommand({ getFlagValue, flags });
} else if (command === "trace") {
  traceCommand({ getFlagValue, flags });
} else if (command === "ci") {
  ciCommand({ commandArgs, flags });
} else if (command === "plugin") {
  pluginCommand({ commandArgs, flags });
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
} else if (command === "run") {
  runCommand({ getFlagValue, flags });
} else if (command === "hook") {
  hookCommand({ commandArgs, flags, cwd });
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
} else if (command === "version" || command === "--version" || command === "-v") {
  log(require("../package.json").version);
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp({ all: flags.has("--all") });
} else {
  fail(`unknown command "${command}". Run "ai-flow help".`);
}
