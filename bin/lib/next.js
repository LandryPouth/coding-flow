"use strict";

// `ai-flow next`: turns the exact state `status` already reads (epics, stories,
// worktrees, captured proof) into ONE ranked suggestion — the single command
// worth running right now. Pure aggregation: read-only, no LLM call, nothing to
// fool. Scoped to the checkout it runs from, same as `status` — it is not a
// live cross-worktree dashboard (each worktree has its own working tree; run
// `next` from wherever you are to get the answer for THAT checkout).
//
// Tiers, highest priority first:
//   1. blocked      — a story's own status says blocked. Needs a human, not a command.
//   2. unproven      — status claims done/verified but no matching green verify was
//                       captured (or the last one failed). A written label is not proof.
//   3. stale         — a green verify exists but the code moved on since.
//   4. ready-to-ship — proven green, and its branch has commits or a dirty tree
//                       ship would push.
//   5. planned       — nothing started yet, no worktree.
// "in-progress" stories are not surfaced: they are not blocked on a command, they
// are blocked on the work itself.

const path = require("path");
const { execFileSync } = require("child_process");

const { cwd } = require("./context");
const { log } = require("./util");
const { readConfig } = require("./config");
const { buildStatusModel } = require("./status");
const { latestVerifyByStoryDir } = require("./audit");
const { defaultBranch, currentBranch } = require("./policy");

const TIER_LABELS = {
  1: "blocked",
  2: "unproven",
  3: "stale",
  4: "ready-to-ship",
  5: "planned",
};

function git(dir, args) {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// A story's proof, independent of its written status: "green" (last captured
// verify passed), "red" (last captured verify failed), or "none" (never captured).
function storyProof(verifyByDir, story) {
  const entry = verifyByDir.get(story.path);
  if (!entry) {
    return "none";
  }
  return entry.ok ? "green" : "red";
}

// Where this story's work actually lives on disk: its linked worktree, or the
// current checkout itself when its branch is the one already checked out here
// (the common case for a project that does not use worktrees at all).
function storyLocation(story) {
  if (story.worktree) {
    return path.join(cwd, story.worktree);
  }
  if (currentBranch(cwd) === story.name) {
    return cwd;
  }
  return null;
}

// Whether `ship` would have anything to do at this location: a dirty tree (it
// would auto-commit it) or commits above the base it has not pushed yet.
function hasUnshippedWork(location, base) {
  if (!location) {
    return false;
  }
  const porcelain = git(location, ["status", "--porcelain"]);
  if (porcelain === null) {
    return false;
  }
  if (porcelain.length > 0) {
    return true;
  }
  const ahead = git(location, ["rev-list", "--count", `${base}..HEAD`]);
  return ahead !== null && ahead !== "" && ahead !== "0";
}

function buildQueue() {
  const config = readConfig(cwd);
  const model = buildStatusModel(config);
  const verifyByDir = latestVerifyByStoryDir(cwd);
  const base = defaultBranch(cwd);

  const items = [];

  for (const epic of model.epics) {
    for (const story of epic.stories) {
      const claimsDone = story.status === "done" || story.status === "verified";
      const proof = storyProof(verifyByDir, story);

      if (story.status === "blocked") {
        items.push({
          tier: 1,
          epic: epic.name,
          story: story.name,
          message: `"${story.name}" is blocked`,
          command: null,
        });
      } else if (claimsDone && proof !== "green") {
        items.push({
          tier: 2,
          epic: epic.name,
          story: story.name,
          message:
            proof === "red"
              ? `"${story.name}" is marked ${story.status} but its last captured verify failed`
              : `"${story.name}" is marked ${story.status} but has no captured verify — a written status is not proof`,
          command: `ai-flow verify --story ${story.path}`,
        });
      } else if (story.status === "stale") {
        items.push({
          tier: 3,
          epic: epic.name,
          story: story.name,
          message: `"${story.name}" verify is stale — the code moved since the last green run`,
          command: `ai-flow verify --story ${story.path}`,
        });
      } else if (claimsDone) {
        const location = storyLocation(story);
        if (hasUnshippedWork(location, base)) {
          const here = location === cwd;
          items.push({
            tier: 4,
            epic: epic.name,
            story: story.name,
            message: `"${story.name}" is proven and has unshipped work`,
            command: here ? "ai-flow ship" : `cd ${story.worktree} && ai-flow ship`,
          });
        }
      } else if (story.status === "planned" && !story.worktree) {
        items.push({
          tier: 5,
          epic: epic.name,
          story: story.name,
          message: `"${story.name}" is planned and has no worktree yet`,
          command: `ai-flow worktree add --story ${story.path}`,
        });
      }
    }
  }

  items.sort((a, b) => a.tier - b.tier);
  return items;
}

function printItem(item, index) {
  const label = `[${TIER_LABELS[item.tier]}]`;
  const prefix = index != null ? `${index}. ` : "";
  log(`${prefix}${label.padEnd(15)} ${item.message}`);
  if (item.command) {
    log(`    ${item.command}`);
  }
}

function next({ all = false, json = false } = {}) {
  const items = buildQueue();

  if (json) {
    log(JSON.stringify({ items: all ? items : items.slice(0, 1) }, null, 2));
    return;
  }

  if (items.length === 0) {
    log("Nothing waiting on you — status is caught up.");
    return;
  }

  if (!all) {
    printItem(items[0]);
    return;
  }

  log(`Next queue (${items.length} item(s)):`);
  items.forEach((item, i) => printItem(item, i + 1));
}

function nextCommand({ flags }) {
  next({ all: flags.has("--all"), json: flags.has("--json") });
}

module.exports = { nextCommand, next, buildQueue };
