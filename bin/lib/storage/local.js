"use strict";

// "local" storage backend: epics/stories live as versioned directories under
// epics/. This is the historical behavior and the default. This module is the
// only thing that knows the layout of the story files; the rest of the tool
// goes through the interface returned by createLocalStorage.

const fs = require("fs");
const path = require("path");

const { toPortable } = require("../util");
const { latestVerifyByStoryDir } = require("../audit");
const { currentTreeToken } = require("../identity");

// Extracts the body of the `## Result` section (with its ### children) from a
// tasks.md. The checklist above Result must not influence status, so only the
// executed-outcome part counts as "notes". A tasks.md without a Result section
// (e.g. a bare unit-test fixture) is read whole.
function resultNotes(raw) {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Result\s*$/i.test(line));

  if (start === -1) {
    return raw;
  }

  const section = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }

    section.push(lines[index]);
  }

  return section.join("\n");
}

// Derives a story's status. Resolution order, from most to least authoritative:
//   1. an explicit `## Status <x>` in tasks.md (human/author override);
//   2. the latest captured `verify` evidence for this story — green -> "verified",
//      red -> "blocked". This is the anti-drift point: a proven status beats prose,
//      so the agent can no longer claim "done" without an executed check behind it;
//   3. the legacy prose heuristic over the tasks.md Result, only when no evidence
//      exists at all.
//
// `verify` is "pass" | "fail" | null, resolved by the caller from the run files
// (kept out of this function so it stays pure and directly unit-testable).
// `fresh` says whether a "pass" verify still describes the current code: a green
// but stale proof (the code changed since) is not "verified" but "stale". It
// defaults to true so a caller that cannot assess freshness keeps the old
// behavior.
function inferStoryStatus(storyDir, { verify = null, fresh = true } = {}) {
  const tasksPath = path.join(storyDir, "tasks.md");
  const raw = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, "utf8") : "";

  // 1. Explicit status wins, anywhere in the file: a person can mark a story
  //    blocked/wontfix/done regardless of the machine signal.
  const statusMatch = raw.match(/## Status\s+([a-zA-Z -]+)/i);

  if (statusMatch) {
    return statusMatch[1].trim().toLowerCase().replace(/\s+/g, "-");
  }

  // The prose heuristic (step 3) only sees the executed outcome, not the checklist.
  const notes = resultNotes(raw);

  // 2. Evidence-backed: a captured verify is proof, prose is not. A green proof
  //    that no longer matches the code is "stale" (re-verify), not "verified".
  if (verify === "pass") {
    return fresh ? "verified" : "stale";
  }

  if (verify === "fail") {
    return "blocked";
  }

  // 3. Legacy prose heuristic (fallback only).
  if (!notes) {
    return "planned";
  }

  const lower = notes.toLowerCase();

  if (lower.includes("blocked") || lower.includes("stop condition")) {
    return "blocked";
  }

  if (lower.includes("pass") && lower.includes("validation")) {
    return "done";
  }

  if (notes.trim().length > 160) {
    return "in-progress";
  }

  return "planned";
}

function storyTitle(storyDir) {
  const storyPath = path.join(storyDir, "spec.md");

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

      // Latest verify per story dir, read once for the whole listing, plus the
      // current working-tree token to tell a fresh proof from a stale one.
      const verifyByDir = latestVerifyByStoryDir(cwd);
      const currentToken = currentTreeToken(cwd);

      for (const epicEntry of fs.readdirSync(epicsRoot, { withFileTypes: true })) {
        if (!epicEntry.isDirectory()) {
          continue;
        }

        const epicDir = path.join(epicsRoot, epicEntry.name);
        const stories = [];

        for (const storyEntry of fs.readdirSync(epicDir, { withFileTypes: true })) {
          if (storyEntry.isDirectory() && storyEntry.name.startsWith("story-")) {
            const storyDir = path.join(epicDir, storyEntry.name);
            const storyPath = toPortable(path.relative(cwd, storyDir));
            const verifyEntry = verifyByDir.get(storyPath);
            const verify = verifyEntry ? (verifyEntry.ok ? "pass" : "fail") : null;
            // Freshness is only decidable when both tokens exist; otherwise stay
            // lenient (a green proof reads as "verified", as before).
            const fresh =
              !verifyEntry ||
              !verifyEntry.treeToken ||
              !currentToken ||
              verifyEntry.treeToken === currentToken;

            stories.push({
              name: storyEntry.name,
              title: storyTitle(storyDir),
              status: inferStoryStatus(storyDir, { verify, fresh }),
              path: storyPath,
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
