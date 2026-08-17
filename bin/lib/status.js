"use strict";

// State of the epics/stories (via the configured storage backend), enriched with
// the worktree linked to each story and the branch policy. The story content
// comes from storage; the worktree link and the policy are the git layer, orthogonal.

const path = require("path");

const { cwd } = require("./context");
const { log, toPortable } = require("./util");
const { collectWorktrees } = require("./worktree");
const { getStorage } = require("./storage");
const { readConfig } = require("./config");
const { evaluateBranchPolicy } = require("./policy");

// Indexes the worktrees by branch name. The worktree<->story mapping is
// stateless: `worktree add --story` names the branch after the story directory,
// so we link a story to a worktree when branch === basename.
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

// The read model behind `status` — epics/stories enriched with their linked
// worktree, loose worktrees, and the branch policy. Extracted so other reporting
// commands (`next`) can read the exact same state without re-deriving it.
function buildStatusModel(config) {
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

  // Active worktrees that don't match any story (loose branches, main/master,
  // etc.). Useful to see all the parallel work in progress.
  const looseWorktrees = wt.entries
    .filter((entry) => !entry.bare && entry.branch && !mappedBranches.has(entry.branch))
    .map((entry) => ({
      branch: entry.branch,
      path: toPortable(path.relative(cwd, entry.path)) || ".",
    }));

  const policy = evaluateBranchPolicy(cwd, config);

  return { epics, looseWorktrees, worktreesActive: wt.isRepo, policy };
}

function status({ json = false } = {}) {
  const config = readConfig(cwd);
  const { epics, looseWorktrees, worktreesActive, policy } = buildStatusModel(config);

  if (json) {
    log(
      JSON.stringify(
        {
          storage: config.storage,
          epics,
          worktrees: { active: worktreesActive, loose: looseWorktrees },
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
    log("Worktrees (not linked to a story):");
    for (const entry of looseWorktrees) {
      log(`- ${entry.branch.padEnd(42)} ${entry.path}`);
    }
    log("");
  }

  // Policy reminder: never blocking from status, just a signal.
  if (policy.enforced && policy.onBase) {
    log(
      `Policy branchPerEpic: you are on "${policy.branch}" (base branch). ` +
        "Create one branch per epic (e.g. `ai-flow worktree add --story <dir>`) before coding.",
    );
    log("");
  }
}

module.exports = { status, buildStatusModel };
