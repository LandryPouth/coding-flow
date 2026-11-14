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

const CRITERION = /^(\s*)[-*]\s*\[([ xX~])\]\s*(.+?)\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;
const HEADING = /^\s*#{1,6}\s/;
const indentOf = (line) => line.match(/^\s*/)[0].length;

// The checklist items of an `## Acceptance Criteria` section, in order. `text`
// is the bullet line, as the open-criteria count reads it; `whole` adds every
// continuation line indented deeper than the bullet (blank lines between them
// included) up to the next list item or heading — a criterion wrapped at 80
// columns is one criterion, and a word changed on its second line is a change.
function criterionItems(specText) {
  const items = [];
  let current = null;

  for (const line of extractSection(specText, "Acceptance Criteria").split(/\r?\n/)) {
    const match = line.match(CRITERION);

    if (match) {
      const state = match[2] === "~" ? "deferred" : match[2] === " " ? "open" : "done";
      current = { state, text: match[3], whole: match[3], indent: match[1].length };
      items.push(current);
    } else if (!line.trim()) {
      continue;
    } else if (current && indentOf(line) > current.indent && !LIST_ITEM.test(line) && !HEADING.test(line)) {
      current.whole += ` ${line.trim()}`;
    } else {
      current = null;
    }
  }

  return items.map(({ state, text, whole }) => ({ state, text, whole }));
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

// `a` minus `b` as multisets: removing one of two identical criteria counts.
function without(a, b) {
  const left = [...b];

  return a.filter((text) => {
    const index = left.indexOf(text);

    if (index === -1) {
      return true;
    }

    left.splice(index, 1);
    return false;
  });
}

const words = (text) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));

// Shared words over all words (Jaccard), from 0 to 1.
function similarity(a, b) {
  const left = words(a);
  const right = words(b);
  const shared = [...left].filter((word) => right.has(word)).length;
  const all = new Set([...left, ...right]).size;

  return all === 0 ? 0 : shared / all;
}

// A pair is clear when at least half the words are shared.
const CLEAR_PAIR = 0.5;

// Pair each removed criterion with its most similar added one, best pairs
// first; what has no clear pair is listed apart: "old → (removed)" and
// "(added) → new".
function pairChanges(removed, added) {
  const candidates = [];

  removed.forEach((old, r) => added.forEach((now, a) => candidates.push({ r, a, score: similarity(old, now) })));
  candidates.sort((x, y) => y.score - x.score || x.r - y.r || x.a - y.a);

  const pairedOld = new Map();
  const usedNew = new Set();

  for (const { r, a, score } of candidates) {
    if (score >= CLEAR_PAIR && !pairedOld.has(r) && !usedNew.has(a)) {
      pairedOld.set(r, a);
      usedNew.add(a);
    }
  }

  return [
    ...removed.map((old, r) => `${old} → ${pairedOld.has(r) ? added[pairedOld.get(r)] : "(removed)"}`),
    ...added.filter((_, a) => !usedNew.has(a)).map((now) => `(added) → ${now}`),
  ];
}

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
  const kept = criterionItems(after).map((item) => normalize(item.whole));
  const had = criterionItems(before).map((item) => normalize(item.whole));

  return { criteriaChanged: pairChanges(without(had, kept), without(kept, had)), specInDiff: false };
}

module.exports = { criterionItems, readSpecDrift };
