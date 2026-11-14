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
const HEADING = /^ {0,3}#{1,6}\s/;
const FENCE = /^\s*(`{3,}|~{3,})/;

// A fence closes on a line holding only a run of its own character, at least
// as long as the run that opened it.
function closesFence(line, fence) {
  const run = line.trim();

  return /^(`+|~+)$/.test(run) && run[0] === fence[0] && run.length >= fence.length;
}
// A tab counts as four columns, so a tab-indented line is deeper than a
// two-space nested bullet.
const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, "    ").length;

// The checklist items of an `## Acceptance Criteria` section, in order. `text`
// is the bullet line, as the open-criteria count reads it; `whole` adds every
// following line indented deeper than the bullet — wrapped words, sub-steps
// written as a plain list, a fenced block read whole (up to its closing run,
// or the first line at or left of the bullet) — up to the next
// checkbox, a heading, or a line at or left of the bullet. Blank lines are
// skipped. A criterion wrapped at 80 columns is one criterion, and a word
// changed on its second line, or a sub-step removed, is a change.
function criterionItems(specText) {
  const items = [];
  let current = null;
  let fence = null;

  for (const line of extractSection(specText, "Acceptance Criteria").split(/\r?\n/)) {
    // Inside a fence every line is the criterion's, until the fence closes —
    // or a line at or left of the bullet, which ends both (an unclosed fence
    // never swallows the next criterion).
    if (fence && (!line.trim() || indentOf(line) > current.indent)) {
      current.whole += ` ${line.trim()}`;
      fence = closesFence(line, fence) ? null : fence;
      continue;
    }

    fence = null;

    const match = line.match(CRITERION);

    if (match) {
      const state = match[2] === "~" ? "deferred" : match[2] === " " ? "open" : "done";
      current = { state, text: match[3], whole: match[3], indent: indentOf(match[1]) };
      items.push(current);
    } else if (!line.trim()) {
      continue;
    } else if (current && indentOf(line) > current.indent && !HEADING.test(line)) {
      current.whole += ` ${line.trim()}`;
      fence = (line.match(FENCE) || [])[1] || null;
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
