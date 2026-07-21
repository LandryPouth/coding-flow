"use strict";

// Desinstallation : retire les fichiers geres (selon le manifeste, en preservant
// les edits locaux sauf --force) tout en conservant epics/stories.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const {
  log,
  readJson,
  hashFile,
  walkFiles,
  normalizePortable,
  isPathInside,
  removeFileIfExists,
  removeEmptyDirsUpward,
} = require("./util");
const {
  manifestPath,
  getTemplateSpecs,
  detectProjectPackageJson,
  removePackageScripts,
} = require("./templates");
const { harnessRunsDir } = require("./harness");

function collectUninstallPlan({ force = false } = {}) {
  const manifest = readJson(manifestPath(), null);
  const files = [];
  const skippedModified = [];
  const skippedUnsafe = [];
  const missing = [];
  const protectedPaths = new Set(["epics", "epics/.gitkeep"]);

  const manifestFiles = manifest && manifest.files && typeof manifest.files === "object"
    ? Object.entries(manifest.files)
    : getTemplateSpecs().map((spec) => [
        spec.targetRel,
        {
          hash: hashFile(spec.source),
          kind: spec.kind,
        },
      ]);

  for (const [targetRel, entry] of manifestFiles) {
    const normalizedTarget = normalizePortable(targetRel);

    if (protectedPaths.has(normalizedTarget) || normalizedTarget.startsWith("epics/")) {
      continue;
    }

    const target = path.resolve(cwd, normalizedTarget);

    if (!isPathInside(target, cwd)) {
      skippedUnsafe.push(normalizedTarget);
      continue;
    }

    if (!fs.existsSync(target)) {
      missing.push(normalizedTarget);
      continue;
    }

    const expectedHash = entry && entry.hash;
    const currentHash = hashFile(target);

    if (force || !expectedHash || currentHash === expectedHash) {
      files.push(normalizedTarget);
    } else {
      skippedModified.push(normalizedTarget);
    }
  }

  for (const generated of [".coding-flow/COMMANDS.md", ".coding-flow/harness.json"]) {
    const target = path.join(cwd, generated);

    if (fs.existsSync(target) && !files.includes(generated)) {
      files.push(generated);
    }
  }

  return {
    manifestExists: Boolean(manifest),
    packageJsonCreated: Boolean(manifest && manifest.packageJsonCreated),
    files: [...new Set(files)].sort((a, b) => b.localeCompare(a)),
    skippedModified,
    skippedUnsafe,
    missing,
    preserves: ["epics/"],
  };
}

function uninstall({ dryRun = false, force = false, json = false } = {}) {
  const plan = collectUninstallPlan({ force });
  const removedFiles = [];
  const removedDirs = [];
  const blockingSkipped = plan.skippedModified.length > 0 && !force;
  const blockingUnsafe = plan.skippedUnsafe.length > 0;
  const blocked = blockingSkipped || blockingUnsafe;

  if (!blocked) {
    for (const targetRel of plan.files) {
      const target = path.resolve(cwd, targetRel);

      if (removeFileIfExists(target, { dryRun })) {
        removedFiles.push(targetRel);
        removedDirs.push(...removeEmptyDirsUpward(path.dirname(target), cwd, { dryRun }));
      }
    }

    if (fs.existsSync(harnessRunsDir())) {
      const runFiles = walkFiles(harnessRunsDir()).map((filePath) => normalizePortable(path.relative(cwd, filePath)));

      for (const runFile of runFiles) {
        const target = path.join(cwd, runFile);

        if (removeFileIfExists(target, { dryRun })) {
          removedFiles.push(runFile);
        }
      }

      removedDirs.push(...removeEmptyDirsUpward(harnessRunsDir(), cwd, { dryRun }));
    }

    const manifestRemoved = removeFileIfExists(manifestPath(), { dryRun });

    if (manifestRemoved) {
      removedFiles.push(".coding-flow/manifest.json");
    }

    removedDirs.push(...removeEmptyDirsUpward(path.join(cwd, ".coding-flow"), cwd, { dryRun }));
  }

  const scripts = blocked
    ? {
        packageJsonExists: detectProjectPackageJson().exists,
        packageJsonRemoved: false,
        removed: [],
        skipped: [],
        conflicts: [],
      }
    : removePackageScripts({ dryRun, removeGeneratedPackageJson: plan.packageJsonCreated });
  const result = {
    ok: !blocked && scripts.conflicts.length === 0,
    dryRun,
    force,
    removedFiles: [...new Set(removedFiles)].sort(),
    removedDirs: [...new Set(removedDirs)].sort(),
    skippedModified: plan.skippedModified,
    skippedUnsafe: plan.skippedUnsafe,
    packageJsonRemoved: scripts.packageJsonRemoved,
    removedScripts: scripts.removed,
    skippedScripts: scripts.skipped,
    scriptConflicts: scripts.conflicts,
    preserved: plan.preserves,
  };

  if (json) {
    log(JSON.stringify(result, null, 2));
  } else {
    if (blockingUnsafe) {
      log("Coding Flow uninstall blocked by unsafe manifest paths.");
    } else if (blockingSkipped) {
      log("Coding Flow uninstall blocked by modified installed files.");
    } else {
      log(dryRun ? "Coding Flow uninstall dry run." : "Coding Flow uninstalled.");
    }

    log(`Removed files: ${result.removedFiles.length}`);
    log(`Removed package scripts: ${result.removedScripts.length}`);
    if (result.packageJsonRemoved) {
      log(dryRun ? "Would remove generated package.json." : "Removed generated package.json.");
    }
    log("Preserved: epics/");

    if (result.skippedModified.length > 0) {
      log("");
      log("Skipped modified files:");
      for (const file of result.skippedModified) {
        log(`- ${file}`);
      }
      log("Use --force only if you intentionally want to remove modified Coding Flow files.");
    }

    if (result.skippedUnsafe.length > 0) {
      log("");
      log("Skipped unsafe manifest paths:");
      for (const file of result.skippedUnsafe) {
        log(`- ${file}`);
      }
    }

    if (result.skippedScripts.length > 0) {
      log("");
      log("Skipped package scripts with custom commands:");
      for (const script of result.skippedScripts) {
        log(`- ${script}`);
      }
    }
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

module.exports = { uninstall };
