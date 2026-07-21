"use strict";

// Backend de stockage "local" : les epics/stories vivent en dossiers versionnes
// sous epics/. C'est le comportement historique et le defaut. Ce module est la
// seule chose qui connait le layout des fichiers de story ; le reste de l'outil
// passe par l'interface renvoyee par createLocalStorage.

const fs = require("fs");
const path = require("path");

const { toPortable } = require("../util");

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

  const heading = fs
    .readFileSync(storyPath, "utf8")
    .split(/\r?\n/)
    .find((line) => line.startsWith("# "));
  return heading ? heading.replace(/^#\s+/, "").trim() : path.basename(storyDir);
}

function createLocalStorage(cwd) {
  return {
    kind: "local",

    listEpics() {
      const epicsRoot = path.join(cwd, "epics");
      const epics = [];

      if (!fs.existsSync(epicsRoot)) {
        return epics;
      }

      for (const epicEntry of fs.readdirSync(epicsRoot, { withFileTypes: true })) {
        if (!epicEntry.isDirectory()) {
          continue;
        }

        const epicDir = path.join(epicsRoot, epicEntry.name);
        const stories = [];

        for (const storyEntry of fs.readdirSync(epicDir, { withFileTypes: true })) {
          if (storyEntry.isDirectory() && storyEntry.name.startsWith("story-")) {
            const storyDir = path.join(epicDir, storyEntry.name);
            stories.push({
              name: storyEntry.name,
              title: storyTitle(storyDir),
              status: inferStoryStatus(storyDir),
              path: toPortable(path.relative(cwd, storyDir)),
            });
          }
        }

        epics.push({
          name: epicEntry.name,
          path: toPortable(path.relative(cwd, epicDir)),
          stories,
        });
      }

      return epics;
    },
  };
}

module.exports = { createLocalStorage, inferStoryStatus, storyTitle };
