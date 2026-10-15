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

// Argument parsing depends on nothing but `process.argv`, so it sits above the
// requires and lets `guard` dispatch before them.
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

// `guard` is the only command on a hot path: Claude Code runs it before every
// Write, Edit and Bash, so its cost is paid tens of times per session while
// every other command is typed by hand. Loading the other twenty modules to
// answer it measured ~40 ms of pure waste per tool call. It returns here rather
// than falling through to the dispatch chain below.
if (command === "guard") {
  require("./lib/guard").guardCommand({ getFlagValue, flags });
  return;
}

const fs = require("fs");
const path = require("path");
const { cwd, invocationDir } = require("./lib/context");
const { log, fail, isCommandAvailable, binaryPathNote } = require("./lib/util");
const {
  copyTemplates,
  copyCodexSkills,
  copyPlatformCommands,
  listTemplateSkillNames,
  ensureConvenienceFiles,
  ensureFrictionLog,
  printConvenienceSummary,
  printPrunedSkills,
  upgrade,
} = require("./lib/templates");
const { doctor } = require("./lib/doctor");
const { status } = require("./lib/status");
const { nextCommand } = require("./lib/next");
const { bootstrapScan, scanProject, printProjectScanSummary } = require("./lib/bootstrap");
const { harnessCommand, ensureHarnessConfig } = require("./lib/harness");
const { auditCommand } = require("./lib/audit");
const { reviewCommand } = require("./lib/review");
const { traceCommand } = require("./lib/trace");
const { ciCommand } = require("./lib/ci");
const { pluginCommand } = require("./lib/plugin");
const { worktreeCommand } = require("./lib/worktree");
const { decidePlacement, autoLandIfChainFinished } = require("./lib/worktree-plan");
const { shipCommand } = require("./lib/ship");
const { runCommand } = require("./lib/run");
const { hookCommand } = require("./lib/hook");
const { reportCommand } = require("./lib/report");
const {
  ensureConfig,
  configPath,
  readConfig,
  readConfigSkillsChoice,
  writeConfigSkills,
  writeConfigInstall,
  writeConfigTarget,
  writeConfigAlsoTarget,
  activeTargets,
  STORAGE_BACKENDS,
} = require("./lib/config");
const { EXPLICIT_TARGETS, resolveTarget } = require("./lib/detect");
const { COMMANDS_ONLY_PLATFORMS } = require("./lib/platforms/registry");
const { writePlatformEvidence } = require("./lib/platforms/evidence");
const { detectPlugin } = require("./lib/claude-plugin");
const { ensureHookSettings } = require("./lib/settings");
const { ensureOpenCodePlugin, usesOpenCode } = require("./lib/opencode");
const { listSkills } = require("./lib/skills");
const { uninstall } = require("./lib/uninstall");
const { printCommands, printHelp } = require("./lib/commands");

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

  // The Claude Code plugin serves Claude Code only. OpenCode reads skills from
  // the project (.claude/skills, .agents/skills), so a project that uses it
  // needs its own copy even when the plugin is installed on this machine.
  if (flags.has("--opencode") || usesOpenCode()) {
    return { mode: "project", reason: "OpenCode reads skills from the project, not from the Claude Code plugin" };
  }

  const detection = detectPlugin();

  return detection.installed
    ? { mode: "plugin", reason: `plugin detected (${detection.source})` }
    : { mode: "project", reason: "no plugin detected" };
}

// One wording for the hook outcome, shared by the minimal and the full install
// so the same status never reads two different ways.
function describeHookStatus(status, dryRun) {
  if (status === "created") {
    return dryRun ? "would create .claude/settings.json" : "wired in .claude/settings.json";
  }
  if (status === "merged") {
    return dryRun ? "would merge into .claude/settings.json" : "merged into .claude/settings.json";
  }
  if (status === "upgraded") {
    return dryRun ? "would upgrade to the resolved binary" : "upgraded to the resolved binary";
  }
  if (status === "unchanged") {
    return "already wired";
  }
  return "skipped (.claude/settings.json is not valid JSON — wire `guard` manually)";
}

// OpenCode has no settings.json: its guard is a plugin under .opencode/plugins/.
// Wired when asked for (`--opencode`) or when the project already uses OpenCode;
// never created for someone who does not.
function wireOpenCode({ dryRun, quiet = false }) {
  if (flags.has("--no-guard") || !(flags.has("--opencode") || usesOpenCode())) {
    return;
  }

  const plugin = ensureOpenCodePlugin({ dryRun });
  const words = {
    created: dryRun ? "would create .opencode/plugins/coding-flow-guard.js" : "wired in .opencode/plugins/coding-flow-guard.js",
    upgraded: dryRun ? "would upgrade the OpenCode plugin" : "OpenCode plugin upgraded",
    unchanged: "OpenCode plugin already wired",
    skipped: "skipped (.opencode/plugins/coding-flow-guard.js exists and is not ours — wire `guard` manually)",
  };

  if (!quiet) {
    log(`Guard plugin (OpenCode): ${words[plugin.status]}`);
  }
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

  // --minimal: the enforcement layer alone. The smallest thing worth adopting is
  // "stop me from committing a secret and refuse to call an untested change
  // proven" — and that should not require taking on a story format, a docs tree,
  // and a set of skills first. Everything the full install adds can be laid down
  // later with a plain `init`.
  if (flags.has("--minimal")) {
    if (flags.has("--with-skills")) {
      fail("--minimal and --with-skills are contradictory: a minimal install lays down no skills.");
    }

    const dryRun = flags.has("--dry-run");
    // The minimal install is the Claude-native default; an explicit --target
    // codex records Codex instead and must not get Claude's settings.json.
    const minimalTarget = getFlagValue("--target", "claude");

    if (!EXPLICIT_TARGETS.includes(minimalTarget)) {
      fail(`unknown --target "${minimalTarget}". Use one of: ${EXPLICIT_TARGETS.join(", ")}.`);
    }

    const configResult = ensureConfig(cwd, {
      dryRun,
      storage,
      branchPerEpic: !flags.has("--no-branch-per-epic"),
      skills: "plugin",
      install: "minimal",
      target: minimalTarget,
    });
    const harnessCreated = ensureHarnessConfig({ dryRun });
    const frictionLog = ensureFrictionLog({ dryRun });

    log(dryRun ? "Dry run complete." : "Coding Flow installed (minimal).");
    log(`Config: ${configResult.created ? (dryRun ? "would create" : "created") : "unchanged"}`);
    log(`Harness config: ${harnessCreated ? (dryRun ? "would create" : "created") : "unchanged"}`);
    log(`Friction log: docs/DOGFOODING.md ${frictionLog}`);

    if (!flags.has("--no-guard") && minimalTarget === "claude") {
      const hook = ensureHookSettings({ dryRun });
      log(`Guard hook: ${describeHookStatus(hook.status, dryRun)}`);
    } else if (minimalTarget !== "claude") {
      log(`Guard hook: none for "${minimalTarget}" yet (commands-only platform)`);
    }

    wireOpenCode({ dryRun });

    log("");
    log("Installed: the guard hook, the proof layer, and the friction log. No RULES.md, no epics/, no skills.");
    log("Next: `ai-flow verify` on a branch — it needs no story and no scaffolding.");
    log("When something goes wrong: `ai-flow report` collects it into one file you can send.");
    log("Later: `ai-flow init` (without --minimal) lays down the full workflow when you want it.");
    log("");
    log(binaryPathNote(isCommandAvailable("ai-flow")));

    process.exit(0);
  }

  if (storage !== "local") {
    fail(
      `storage backend "${storage}" is not available yet. ` +
        "Only \"local\" is supported for now (see docs/plans/storage-backends.md).",
    );
  }

  const requestedTarget = getFlagValue("--target", null);

  if (requestedTarget && !EXPLICIT_TARGETS.includes(requestedTarget)) {
    fail(`unknown --target "${requestedTarget}". Use one of: ${EXPLICIT_TARGETS.join(", ")}.`);
  }

  // Which platform is this install for? A recorded decision wins on a re-init,
  // then an explicit --target, then what the environment confirms — and when
  // nothing is confirmed the answer is "unrecognized", never a guess.
  const dryRun = flags.has("--dry-run");
  const recorded = readConfig(cwd);
  const hadConfig = fs.existsSync(configPath(cwd));
  const detected = resolveTarget({ flags: { target: requestedTarget }, env: process.env, cwd });
  const target =
    requestedTarget || !hadConfig || recorded.target === "unrecognized" ? detected.target : recorded.target;
  const detectionSource =
    requestedTarget || !hadConfig || recorded.target === "unrecognized" ? detected.source : "config";

  // Only a Claude install can draw on the Claude plugin; Codex and an
  // unrecognized host get no `.claude/skills` copy to keep or prune.
  const skills =
    target === "claude" ? resolveSkillsMode() : { mode: "plugin", reason: `no Claude skills for target "${target}"` };
  // Config first: on a re-init, the choice recorded at the original install wins
  // over whatever this machine detects, so the copy below matches the config.
  const configResult = ensureConfig(cwd, {
    dryRun,
    storage,
    branchPerEpic: !flags.has("--no-branch-per-epic"),
    skills: skills.mode,
    target,
  });

  // "unrecognized" is the one recorded target that is not a decision: the first
  // explicit or confirmed platform after it is allowed to replace it.
  if (!dryRun && !configResult.created && recorded.target === "unrecognized" && target !== "unrecognized") {
    configResult.config = writeConfigTarget(cwd, target, skills.mode);
  } else if (!dryRun && !configResult.created && requestedTarget && requestedTarget !== recorded.target) {
    // The recorded platform stays the project's first decision. An explicit
    // --target for another one is added alongside, so doctor and upgrade keep
    // judging the files of both instead of dropping the first one's checks.
    const alreadyAlongside = recorded.alsoTargets.includes(requestedTarget);

    configResult.config = writeConfigAlsoTarget(cwd, requestedTarget, skills.mode);

    if (!alreadyAlongside) {
      log(`Target: "${requestedTarget}" added alongside "${recorded.target}"; both are kept up to date`);
    }
  }

  const effectiveSkills = configResult.config.skills;
  const result = copyTemplates({
    force: flags.has("--force"),
    dryRun,
    includeSkills: target === "claude" && effectiveSkills === "project",
    target,
  });
  const codexSkills = target === "codex" ? copyCodexSkills({ force: flags.has("--force"), dryRun }) : null;
  const platformCommands = COMMANDS_ONLY_PLATFORMS[target]
    ? copyPlatformCommands(target, { force: flags.has("--force"), dryRun })
    : null;
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
  if (target === "claude") {
    log(describeSkillsMode(effectiveSkills, configResult.created ? skills.reason : "recorded at init"));
  } else if (target === "codex") {
    log(`Skills: ${codexSkills.written.length} written to .codex/skills as $flow-* (${codexSkills.skipped.length} kept)`);
  } else if (platformCommands) {
    log(
      `Commands: ${platformCommands.written.length} written to ${COMMANDS_ONLY_PLATFORMS[target].dir} ` +
        `(${platformCommands.skipped.length} kept)`,
    );
    log(`Guard hook: none for "${target}" — commands-only platform, writes are not mechanically protected`);
  } else {
    log(
      "Platform not recognized: no commands were installed. " +
        "Re-run with `ai-flow init --target claude` or `--target codex`. " +
        "Until then NO guard is installed.",
    );
  }
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
  // `.claude/settings.json` is Claude's file: a Codex or unrecognized install
  // must not create it (Codex's guard is a sandbox profile, a later story).
  let hookWired = false;

  if (!flags.has("--no-guard") && target === "claude") {
    const hook = ensureHookSettings({ dryRun: flags.has("--dry-run") });
    hookWired = hook.status !== "unparseable";
    log(`Guard hook: ${describeHookStatus(hook.status, flags.has("--dry-run"))}`);
  }

  wireOpenCode({ dryRun: flags.has("--dry-run") });

  const countInstalledCommands = () => {
    const rendered = target === "codex" ? codexSkills : platformCommands;

    if (rendered) {
      return rendered.written.length + rendered.skipped.length;
    }

    return target === "claude" && effectiveSkills === "project" ? listTemplateSkillNames().length : 0;
  };

  // What this install did for its platform, as evidence: a missing guard has to
  // show up in `ai-flow report` as a fact, not stay an absence nobody can see.
  if (!dryRun) {
    writePlatformEvidence(cwd, {
      target,
      detectionSource,
      // For Codex this counts files present, including locally edited ones kept as-is.
      commandsInstalled: countInstalledCommands(),
      enforcementTier: target === "claude" ? (hookWired ? "hook" : "none") : target === "codex" || platformCommands ? "commands-only" : "none",
    });
  }

  // A plain `init` over a project that started minimal is how it grows into the
  // full workflow. The files were just laid down; the record has to follow, or
  // doctor keeps judging it as a minimal install forever.
  if (!flags.has("--dry-run") && readConfig(cwd).install === "minimal") {
    writeConfigInstall(cwd, "full");
    log("Install: promoted from minimal to full");
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

  // Right after install is exactly when "will the commands I'm about to be
  // told to type actually work" matters most — answer it here instead of
  // waiting for a `command not found` in a later terminal.
  log("");
  log(binaryPathNote(isCommandAvailable("ai-flow")));
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

  const upgradeConfig = readConfig(cwd);
  const platforms = activeTargets(upgradeConfig);
  const hasClaude = platforms.includes("claude");
  const hasCodex = platforms.includes("codex");

  // The skills mode describes the Claude install; saying it for a Codex-only
  // project would claim a plugin channel that project does not use.
  if (!flags.has("--json") && hasClaude) {
    log(describeSkillsMode(skills, reason));
  }
  const upgradeTarget = hasClaude ? "claude" : upgradeConfig.target;

  upgrade({
    force: flags.has("--force"),
    dryRun: flags.has("--dry-run"),
    json: flags.has("--json"),
    includeSkills: upgradeTarget === "claude" && skills === "project",
    skillsMode: skills,
    platform: upgradeTarget,
  });

  for (const platform of platforms.filter((p) => COMMANDS_ONLY_PLATFORMS[p])) {
    const commands = copyPlatformCommands(platform, {
      force: flags.has("--force"),
      dryRun: flags.has("--dry-run"),
    });

    if (!flags.has("--json")) {
      log(`Commands (${platform}): ${commands.written.length} written to ${COMMANDS_ONLY_PLATFORMS[platform].dir} (${commands.skipped.length} kept)`);
    }
  }

  if (hasCodex) {
    const codexSkills = copyCodexSkills({ force: flags.has("--force"), dryRun: flags.has("--dry-run") });

    if (!flags.has("--json")) {
      log(`Skills: ${codexSkills.written.length} written to .codex/skills (${codexSkills.skipped.length} kept)`);
    }
  }

  // The hook command hard-codes the absolute path of the binary that wrote it
  // (see settings.js). Upgrading the package leaves that path pointing at the
  // OLD copy — an npx cache directory keyed to the old version keeps existing
  // and keeps working — so without this the project silently keeps enforcing
  // with the version it was installed with, forever. Every guard fix would ship
  // to npm and reach nobody. Re-wiring here also promotes a matcher we shipped
  // as a default before it covered `Bash`.
  if (!flags.has("--no-guard") && hasClaude) {
    const hook = ensureHookSettings({ dryRun: flags.has("--dry-run") });

    if (!flags.has("--json")) {
      log(`Guard hook: ${describeHookStatus(hook.status, flags.has("--dry-run"))}`);
    }
  }

  wireOpenCode({ dryRun: flags.has("--dry-run"), quiet: flags.has("--json") });

  if (!flags.has("--json")) {
    log("");
    log(binaryPathNote(isCommandAvailable("ai-flow")));
  }
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
} else if (command === "next") {
  nextCommand({ flags });
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
} else if (command === "report") {
  reportCommand({ getFlagValue, flags });
} else if (command === "audit") {
  auditCommand({ getFlagValue, flags });
} else if (command === "review") {
  reviewCommand({ commandArgs, getFlagValue, flags });
} else if (command === "trace") {
  traceCommand({ getFlagValue, flags });
} else if (command === "ci") {
  ciCommand({ commandArgs, flags });
} else if (command === "plugin") {
  pluginCommand({ commandArgs, flags });
} else if (command === "worktree" && commandArgs[0] === "place") {
  // Not routed through worktreeCommand/worktree.js: decidePlacement
  // (worktree-plan.js) itself calls back into worktree.js's worktreeAdd, so
  // wiring this here — the one module neither of them requires — avoids a
  // circular require between the two.
  const epic = getFlagValue("--epic", null);
  const story = getFlagValue("--story", null);

  if (!epic || !story) {
    fail("worktree place requires --epic <dir> and --story <dir>.");
  }

  let result;
  try {
    result = decidePlacement({ cwd, epicPath: epic, storyPath: story });
  } catch (err) {
    fail(err.message);
  }

  if (flags.has("--json")) {
    log(JSON.stringify(result, null, 2));
  } else {
    log(`Chain: ${result.chainId} (story label ${result.label})`);
    log(`Location: ${result.location}${result.created ? " (new worktree)" : " (current checkout)"}`);
    if (result.created) {
      log("");
      log(
        `Reason: chain ${result.parallelTo.chainId} already occupies this checkout (${result.parallelTo.location}), ` +
          `so chain ${result.chainId} runs parallel to it in its own worktree.`,
      );
      log("");
      log("Next step:");
      log(`  cd ${path.relative(cwd, result.location) || result.location}`);
    }
  }
} else if (command === "worktree" && commandArgs[0] === "autoland") {
  // Not routed through worktreeCommand/worktree.js either, same reason as
  // `place`: autoLandIfChainFinished (worktree-plan.js) calls back into
  // worktree.js's worktreeLand.
  const epic = getFlagValue("--epic", null);
  const story = getFlagValue("--story", null);

  if (!epic || !story) {
    fail("worktree autoland requires --epic <dir> and --story <dir>.");
  }

  let result;
  try {
    result = autoLandIfChainFinished({ cwd, epicPath: epic, storyPath: story });
  } catch (err) {
    fail(err.message);
  }

  const reviewGateMessages = {
    "review-missing": `has no captured review for its STRICT-tier story "${result.story}"`,
    "review-stale": `has a stale review (the tree moved since capture) for its STRICT-tier story "${result.story}"`,
    "review-failed": `has a failing review for its STRICT-tier story "${result.story}"`,
  };

  if (flags.has("--json")) {
    log(JSON.stringify(result, null, 2));
  } else if (result.landed) {
    log(`Landed: chain ${result.chainId} ("${result.worktreeName}") merged and its worktree removed.`);
  } else if (result.reason === "chain-not-finished") {
    log(`Chain ${result.chainId} is not finished yet — nothing to land.`);
  } else if (reviewGateMessages[result.reason]) {
    log(`Chain ${result.chainId} ${reviewGateMessages[result.reason]} — run /flow-review before landing.`);
  } else {
    log(`Chain ${result.chainId} never left the primary checkout — nothing to land.`);
  }
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
