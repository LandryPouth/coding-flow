"use strict";

// State of the epics/stories (via the configured storage backend), enriched with
// the worktree linked to each story and the branch policy. The story content
// comes from storage; the worktree link and the policy are the git layer, orthogonal.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { log, toPortable } = require("./util");
const { collectWorktrees, realDirtyLines } = require("./worktree");
const { latestVerifyByStoryDir, isStale } = require("./audit");
const { currentTreeToken } = require("./identity");
const { getStorage } = require("./storage");
const { readConfig } = require("./config");
const { evaluateBranchPolicy } = require("./policy");

// Indexes the worktrees by branch name. The worktree<->story mapping is
// stateless: `worktree add --story` names the branch after the story directory,
// so we link a story to a worktree when branch === basename. Keeps both the
// portable path (existing `worktree` field, display/JSON) and the absolute
// path (needed to inspect that worktree's own lock file / dirty state / verify
// evidence for `landReady`, all of which live inside it, not in `cwd`).
function buildWorktreeIndex() {
  const { isRepo, entries } = collectWorktrees(cwd);
  const byBranch = new Map();

  for (const entry of entries) {
    if (entry.bare || !entry.branch) {
      continue;
    }
    byBranch.set(entry.branch, {
      path: toPortable(path.relative(cwd, entry.path)) || ".",
      fullPath: entry.path,
    });
  }

  return { isRepo, byBranch, entries };
}

// Whether a story's linked worktree is still active, ready to land, or not
// there yet — the same preconditions `worktree land` itself checks (story-02-02):
// no lock, a clean worktree, and a green, non-stale verify recorded *for that
// worktree* (verify evidence lives under `<worktree>/.coding-flow/runs`, so it
// is read from the worktree's own path, not from `cwd`).
function computeLandReady(worktreePath, storyPath) {
  const lockPath = path.join(worktreePath, ".coding-flow", "active-story.json");
  if (fs.existsSync(lockPath)) {
    return "active";
  }

  if (realDirtyLines(worktreePath).length > 0) {
    return "unverified";
  }

  const verifyEntry = latestVerifyByStoryDir(worktreePath).get(storyPath);
  const currentToken = currentTreeToken(worktreePath);

  if (!verifyEntry || !verifyEntry.ok || isStale(verifyEntry, currentToken)) {
    return "unverified";
  }

  return "landable";
}

const PLANS_DIR = "docs/plans";

// A design doc under docs/plans/ that no epic's index.md references yet — a
// decision written down but never turned into work `ai-flow status` can show.
// The link is deliberately loose: an epic "covers" a plan simply by
// mentioning its path (`docs/plans/<name>.md`) anywhere in its index.md, the
// way epic-01-multi-platform-support's index.md already references
// docs/plans/multi-agent-install.md while explaining why it supersedes part
// of it. No new frontmatter/convention to keep in sync by hand — one
// substring check against text a human already writes for other reasons.
function listUntrackedPlans(epics) {
  const plansDir = path.join(cwd, PLANS_DIR);

  if (!fs.existsSync(plansDir)) {
    return [];
  }

  const planFiles = fs
    .readdirSync(plansDir)
    .filter((name) => name.endsWith(".md"))
    .sort();

  const epicText = epics
    .map((epic) => {
      const indexPath = path.join(cwd, epic.path, "index.md");
      return fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
    })
    .join("\n");

  return planFiles
    .filter((name) => !epicText.includes(`${PLANS_DIR}/${name}`))
    .map((name) => toPortable(path.join(PLANS_DIR, name)));
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
      const wtEntry = wt.byBranch.get(story.name) || null;

      if (wtEntry) {
        mappedBranches.add(story.name);
      }

      const landReady = wtEntry ? computeLandReady(wtEntry.fullPath, story.path) : undefined;

      return { ...story, worktree: wtEntry ? wtEntry.path : null, ...(wtEntry ? { landReady } : {}) };
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
  const untrackedPlans = listUntrackedPlans(epics);

  return { epics, looseWorktrees, worktreesActive: wt.isRepo, policy, untrackedPlans };
}

function status({ json = false } = {}) {
  const config = readConfig(cwd);
  const { epics, looseWorktrees, worktreesActive, policy, untrackedPlans } = buildStatusModel(config);

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
          untrackedPlans,
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
        const wtSuffix = story.worktree
          ? `  → wt: ${story.worktree} [${story.landReady}]`
          : "";
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
        "Create one branch per epic (e.g. `ai-flow worktree place --epic <epic-dir> --story <story-dir>`) before coding.",
    );
    log("");
  }

  if (untrackedPlans.length > 0) {
    log("Docs not yet tracked by an epic:");
    for (const plan of untrackedPlans) {
      log(`- ${plan}`);
    }
    log("Run /flow-plan against one of these to turn it into stories.");
    log("");
  }
}

module.exports = { status, buildStatusModel };
