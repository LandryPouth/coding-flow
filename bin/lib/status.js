"use strict";

// Etat des epics/stories (via le backend de stockage configure), enrichi du
// worktree lie a chaque story et de la policy de branche. Le contenu des stories
// vient du storage ; le lien worktree et la policy sont la couche git, orthogonale.

const path = require("path");

const { cwd } = require("./context");
const { log, toPortable } = require("./util");
const { collectWorktrees } = require("./worktree");
const { getStorage } = require("./storage");
const { readConfig } = require("./config");
const { evaluateBranchPolicy } = require("./policy");

// Indexe les worktrees par nom de branche. La correspondance worktree<->story
// est sans etat : `worktree add --story` nomme la branche d'apres le dossier de
// la story, donc on relie une story a un worktree quand branch === basename.
function buildWorktreeIndex() {
  const { isRepo, entries } = collectWorktrees(cwd);
  const byBranch = new Map();

  for (const entry of entries) {
    if (entry.bare || !entry.branch) {
      continue;
    }
    byBranch.set(entry.branch, toPortable(path.relative(cwd, entry.path)) || ".");
  }

  return { isRepo, byBranch, entries };
}

function status({ json = false } = {}) {
  const config = readConfig(cwd);
  const storage = getStorage(cwd, config);
  const wt = buildWorktreeIndex();
  const mappedBranches = new Set();

  const epics = storage.listEpics().map((epic) => ({
    ...epic,
    stories: epic.stories.map((story) => {
      const worktree = wt.byBranch.get(story.name) || null;

      if (worktree) {
        mappedBranches.add(story.name);
      }

      return { ...story, worktree };
    }),
  }));

  // Worktrees actifs qui ne correspondent a aucune story (branches libres,
  // main/master, etc.). Utile pour voir tout le travail parallele en cours.
  const looseWorktrees = wt.entries
    .filter((entry) => !entry.bare && entry.branch && !mappedBranches.has(entry.branch))
    .map((entry) => ({
      branch: entry.branch,
      path: toPortable(path.relative(cwd, entry.path)) || ".",
    }));

  const policy = evaluateBranchPolicy(cwd, config);

  if (json) {
    log(
      JSON.stringify(
        {
          storage: config.storage,
          epics,
          worktrees: { active: wt.isRepo, loose: looseWorktrees },
          policy: {
            branchPerEpic: policy.enforced,
            branch: policy.branch,
            onBase: policy.onBase,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (epics.length === 0) {
    log("No epics found.");
  } else {
    for (const epic of epics) {
      log(epic.name);

      if (epic.stories.length === 0) {
        log("- no stories");
        log("");
        continue;
      }

      for (const story of epic.stories) {
        const wtSuffix = story.worktree ? `  → wt: ${story.worktree}` : "";
        log(`- ${story.name.padEnd(42)} ${story.status.padEnd(12)}${wtSuffix}`);
      }
      log("");
    }
  }

  if (looseWorktrees.length > 0) {
    log("Worktrees (hors story):");
    for (const entry of looseWorktrees) {
      log(`- ${entry.branch.padEnd(42)} ${entry.path}`);
    }
    log("");
  }

  // Rappel de policy : jamais bloquant depuis status, juste un signal.
  if (policy.enforced && policy.onBase) {
    log(
      `Policy branchPerEpic : tu es sur "${policy.branch}" (branche de base). ` +
        "Crée une branche par epic (ex. `ai-flow worktree add --story <dir>`) avant de coder.",
    );
    log("");
  }
}

module.exports = { status };
