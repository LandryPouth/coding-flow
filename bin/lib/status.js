"use strict";

// Etat des epics/stories, avec un statut inferre depuis implementation-notes.md.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { log, toPortable } = require("./util");
const { collectWorktrees } = require("./worktree");

function inferStoryStatus(storyDir) {
  const notesPath = path.join(storyDir, "implementation-notes.md");

  if (!fs.existsSync(notesPath)) {
    return "planned";
  }

  const content = fs.readFileSync(notesPath, "utf8");
  const statusMatch = content.match(/## Status\s+([a-zA-Z -]+)/i);

  if (statusMatch) {
    return statusMatch[1].trim().toLowerCase().replace(/\s+/g, "-");
  }

  const lower = content.toLowerCase();

  if (lower.includes("blocked") || lower.includes("stop condition")) {
    return "blocked";
  }

  if (lower.includes("pass") && lower.includes("validation")) {
    return "done";
  }

  if (content.trim().length > 160) {
    return "in-progress";
  }

  return "planned";
}

function storyTitle(storyDir) {
  const storyPath = path.join(storyDir, "story.md");

  if (!fs.existsSync(storyPath)) {
    return path.basename(storyDir);
  }

  const heading = fs.readFileSync(storyPath, "utf8").split(/\r?\n/).find((line) => line.startsWith("# "));
  return heading ? heading.replace(/^#\s+/, "").trim() : path.basename(storyDir);
}

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
  const epicsRoot = path.join(cwd, "epics");
  const epics = [];
  const wt = buildWorktreeIndex();
  const mappedBranches = new Set();

  if (fs.existsSync(epicsRoot)) {
    for (const epicEntry of fs.readdirSync(epicsRoot, { withFileTypes: true })) {
      if (!epicEntry.isDirectory()) {
        continue;
      }

      const epicDir = path.join(epicsRoot, epicEntry.name);
      const stories = [];

      for (const storyEntry of fs.readdirSync(epicDir, { withFileTypes: true })) {
        if (storyEntry.isDirectory() && storyEntry.name.startsWith("story-")) {
          const storyDir = path.join(epicDir, storyEntry.name);
          const worktree = wt.byBranch.get(storyEntry.name) || null;

          if (worktree) {
            mappedBranches.add(storyEntry.name);
          }

          stories.push({
            name: storyEntry.name,
            title: storyTitle(storyDir),
            status: inferStoryStatus(storyDir),
            path: toPortable(path.relative(cwd, storyDir)),
            worktree,
          });
        }
      }

      epics.push({
        name: epicEntry.name,
        path: toPortable(path.relative(cwd, epicDir)),
        stories,
      });
    }
  }

  // Worktrees actifs qui ne correspondent a aucune story (branches libres,
  // main/master, etc.). Utile pour voir tout le travail parallele en cours.
  const looseWorktrees = wt.entries
    .filter((entry) => !entry.bare && entry.branch && !mappedBranches.has(entry.branch))
    .map((entry) => ({
      branch: entry.branch,
      path: toPortable(path.relative(cwd, entry.path)) || ".",
    }));

  if (json) {
    log(JSON.stringify({ epics, worktrees: { active: wt.isRepo, loose: looseWorktrees } }, null, 2));
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
}

module.exports = { status };
