"use strict";

// Did the story's acceptance criteria change during the diff that implements it?
// The criteria at the diff base are compared with the ones in the tree, after
// whitespace normalisation: ticking `[ ]` to `[x]` or `[~]` is silent, a removed
// or reworded criterion is `criteria-changed`, and a story that does not exist at
// the base is `spec-in-diff` — the specifier is the coder. Only a contrary
// signal: it lowers what the verdict claims, it never raises it.

const path = require("path");
const { execFileSync } = require("child_process");

const { cwd } = require("./context");
const { storyPartPath, extractSection } = require("./story");
const { normalizePortable } = require("./util");

const CRITERION = /^\s*[-*]\s*\[([ xX~])\]\s*(.+?)\s*$/;

// The checklist lines of an `## Acceptance Criteria` section, in order.
function criterionItems(specText) {
  const items = [];

  for (const line of extractSection(specText, "Acceptance Criteria").split(/\r?\n/)) {
    const match = line.match(CRITERION);

    if (match) {
      items.push({ state: match[1] === "~" ? "deferred" : match[1] === " " ? "open" : "done", text: match[2] });
    }
  }

  return items;
}

function gitText(args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

// The spec's path at the base: its own, or — when the story was renamed on the
// branch — the oldest name `git log --follow` finds. null when it is not there.
function specTextAtBase(mergeBase, relPath) {
  const direct = gitText(["show", `${mergeBase}:./${relPath}`]);

  if (direct !== null) {
    return direct;
  }

  const log = gitText(["log", "--follow", "--relative", "--name-status", "--format=", `${mergeBase}..HEAD`, "--", relPath]);
  const renames = (log || "").split(/\r?\n/).filter((line) => /^R\d*\t/.test(line));
  const oldest = renames.length > 0 ? renames[renames.length - 1].split("\t")[1] : null;

  return oldest ? gitText(["show", `${mergeBase}:./${oldest}`]) : null;
}

const normalize = (text) => text.replace(/\s+/g, " ").trim();

function readSpecDrift(storyDir, mergeBase) {
  const none = { criteriaChanged: [], specInDiff: false };

  if (!storyDir || !mergeBase) {
    return none;
  }

  const specPath = storyPartPath(storyDir, "spec");
  const relPath = normalizePortable(path.relative(cwd, specPath));
  const before = specTextAtBase(mergeBase, relPath);

  if (before === null) {
    return { criteriaChanged: [], specInDiff: true };
  }

  const fs = require("fs");
  const after = fs.existsSync(specPath) ? fs.readFileSync(specPath, "utf8") : "";
  const kept = new Set(criterionItems(after).map((item) => normalize(item.text)));
  const had = new Set(criterionItems(before).map((item) => normalize(item.text)));
  const removed = [...had].filter((text) => !kept.has(text));
  const added = [...kept].filter((text) => !had.has(text));

  // Pair by order: a reworded criterion reads "old → new"; leftovers stand alone.
  const criteriaChanged = removed.map((old, index) =>
    index < added.length ? `${old} → ${added[index]}` : `${old} → (removed)`,
  );

  return { criteriaChanged, specInDiff: false };
}

module.exports = { criterionItems, readSpecDrift };
