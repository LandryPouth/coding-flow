"use strict";

// `ai-flow plugin sync|check` : le canal de distribution "plugin natif Claude Code".
// Les skills vivent dans templates/.claude/skills (source de vérité, copiée dans
// les projets par `init`). Un plugin Claude Code auto-découvre ses skills depuis
// <racine>/skills. Plutôt que de dupliquer 27 dossiers À LA MAIN (le tapis roulant
// que le plugin est censé éviter), `plugin sync` MATÉRIALISE skills/ depuis les
// templates par une seule commande, et `plugin check` garantit l'absence de dérive
// (utilisé en test/CI). Une source, une commande de sync, un garde-fou.

const fs = require("fs");
const path = require("path");

const { packageRoot } = require("./context");
const { log, walkFiles, hashFile, toPortable } = require("./util");

function templatesSkillsRoot() {
  return path.join(packageRoot, "templates", ".claude", "skills");
}

function pluginSkillsRoot() {
  return path.join(packageRoot, "skills");
}

// Compare la source (templates) et la cible (skills/) fichier par fichier.
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

  const missing = []; // dans templates, absent de skills/
  const changed = []; // présent des deux côtés mais contenu différent
  const extra = []; // dans skills/, absent des templates (obsolète)

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

// Matérialise skills/ à l'identique des templates : copie les manquants/modifiés,
// supprime les obsolètes.
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
      fs.rmSync(path.join(target, rel), { force: true });
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
