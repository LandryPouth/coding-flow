"use strict";

// `ai-flow plugin sync|check`: the "native Claude Code plugin" distribution channel.
// Skills live in templates/.claude/skills (source of truth, copied into projects
// by `init`). A Claude Code plugin auto-discovers its skills from <root>/skills.
// Rather than duplicating 27 directories BY HAND (the treadmill the plugin is
// meant to avoid), `plugin sync` MATERIALIZES skills/ from the templates with a
// single command, and `plugin check` guarantees the absence of drift (used in
// test/CI). One source, one sync command, one guardrail.

const fs = require("fs");
const path = require("path");

const { packageRoot } = require("./context");
const { log, walkFiles, hashFile, toPortable, removeEmptyDirsUpward } = require("./util");

function templatesSkillsRoot() {
  return path.join(packageRoot, "templates", ".claude", "skills");
}

function pluginSkillsRoot() {
  return path.join(packageRoot, "skills");
}

// Compares the source (templates) and the target (skills/) file by file.
function diffSkills() {
  const source = templatesSkillsRoot();
  const target = pluginSkillsRoot();

  const sourceFiles = new Map();
  for (const file of walkFiles(source)) {
    sourceFiles.set(toPortable(path.relative(source, file)), file);
  }

  const targetFiles = new Map();
  for (const file of walkFiles(target)) {
    targetFiles.set(toPortable(path.relative(target, file)), file);
  }

  const missing = []; // in templates, absent from skills/
  const changed = []; // present on both sides but different content
  const extra = []; // in skills/, absent from templates (stale)

  for (const [rel, srcPath] of sourceFiles) {
    const tgtPath = targetFiles.get(rel);
    if (!tgtPath) {
      missing.push(rel);
    } else if (hashFile(srcPath) !== hashFile(tgtPath)) {
      changed.push(rel);
    }
  }

  for (const rel of targetFiles.keys()) {
    if (!sourceFiles.has(rel)) {
      extra.push(rel);
    }
  }

  return {
    inSync: missing.length === 0 && changed.length === 0 && extra.length === 0,
    missing,
    changed,
    extra,
  };
}

// Materializes skills/ identically to the templates: copies the missing/changed,
// removes the stale ones.
function pluginSync({ dryRun = false } = {}) {
  const source = templatesSkillsRoot();
  const target = pluginSkillsRoot();
  const diff = diffSkills();
  const toWrite = [...diff.missing, ...diff.changed];

  if (!dryRun) {
    for (const rel of toWrite) {
      const from = path.join(source, rel);
      const to = path.join(target, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }

    for (const rel of diff.extra) {
      const stale = path.join(target, rel);
      fs.rmSync(stale, { force: true });
      // A renamed skill leaves its old directory behind once the file is gone.
      // Pruning it keeps skills/ an exact mirror of the templates.
      removeEmptyDirsUpward(path.dirname(stale), target);
    }
  }

  log(
    `${dryRun ? "Would sync" : "Synced"} plugin skills/: ${toWrite.length} written, ${diff.extra.length} removed.`,
  );
  return { written: toWrite, removed: diff.extra };
}

function pluginCheck({ json = false } = {}) {
  const diff = diffSkills();

  if (json) {
    log(JSON.stringify(diff, null, 2));
  } else if (diff.inSync) {
    log("Plugin skills/ are in sync with templates/.claude/skills.");
  } else {
    log("Plugin skills/ are OUT OF SYNC with templates/.claude/skills. Run `ai-flow plugin sync`.");
    for (const rel of diff.missing) log(`- missing: ${rel}`);
    for (const rel of diff.changed) log(`- changed: ${rel}`);
    for (const rel of diff.extra) log(`- stale:   ${rel}`);
  }

  if (!diff.inSync) {
    process.exitCode = 1;
  }
  return diff;
}

function pluginCommand({ commandArgs, flags }) {
  const subcommand = commandArgs[0] || "check";

  if (subcommand === "sync") {
    pluginSync({ dryRun: flags.has("--dry-run") });
  } else if (subcommand === "check") {
    pluginCheck({ json: flags.has("--json") });
  } else {
    const { fail } = require("./util");
    fail(`unknown plugin command "${subcommand}". Use sync or check.`);
  }
}

module.exports = { pluginCommand, diffSkills, pluginSync, templatesSkillsRoot, pluginSkillsRoot };
