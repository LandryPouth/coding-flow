"use strict";

// Each `## Stories` entry of an epic `index.md` opens the story's spec in the
// editor: `1. [story-…](story-…/spec.md) — outcome *(MODE)*`, or `story.md` for a
// single-file story (`/flow-plan`'s contract). Agents drift from a prompt-level
// rule — bold names, folder links, `([spec](…))` suffixes, plain bullets were all
// found in real epics — so `doctor` checks every entry against the files on disk
// and `doctor --fix` rewrites the drifted ones. The entry reading is
// `backbone.js`'s, so what is checked is exactly what `worktree place` parses.

const fs = require("fs");
const path = require("path");

const { parseStoryEntries } = require("./backbone");

// A spec link right after an old-style name: `**story-x** ([spec](story-x/spec.md))`.
const SPEC_SUFFIX = /^\s*\(\[[^\]]*\]\([^)]*\)\)/;
// The story number a title link often repeats: `[43-01 — Title](…)`.
const NUMBER_PREFIX = /^\d+-\d+\s*[—–:-]\s*/;

// spec.md when the story has one, else story.md, else the folder; null when the
// folder itself is missing (nothing to link to).
function expectedTarget(epicDir, dir) {
  const storyDir = path.join(epicDir, dir);

  if (fs.existsSync(path.join(storyDir, "spec.md"))) return `${dir}/spec.md`;
  if (fs.existsSync(path.join(storyDir, "story.md"))) return `${dir}/story.md`;
  if (fs.existsSync(storyDir)) return `${dir}/`;
  return null;
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// The entry line rewritten to the canonical link, the rest of its text kept: a
// title used as link text moves after the link (minus a repeated story number),
// a trailing `([spec](…))` is dropped since the link now carries it.
function canonicalLine(text, entry, target) {
  const rest = text.slice(entry.prefix.length + entry.head.length);
  let extra = "";
  let tail = rest;

  if (entry.link) {
    const title = entry.link.text.trim().replace(/^`|`$/g, "").replace(/\/$/, "");
    if (title && title !== entry.dir) {
      extra = ` — ${title.replace(NUMBER_PREFIX, "")}`;
    }
  } else {
    tail = rest.replace(SPEC_SUFFIX, "");
  }

  return `${entry.prefix}[${entry.dir}](${target})${extra}${tail}`;
}

function describe(epicDir, entry, expected) {
  const want = `[${entry.dir}](${expected})`;

  if (!entry.link) return `story entry ${entry.dir} is not a link — write ${want}`;

  const target = entry.link.target.split("#")[0];
  const resolved = path.join(epicDir, target);

  if (!fs.existsSync(resolved)) return `${entry.link.target} does not exist — link ${want}`;
  if (!isFile(resolved) && !expected.endsWith("/")) return `links to ${entry.link.target}, not to its spec — link ${want}`;
  return `links as [${entry.link.text}](${entry.link.target}) — write ${want}`;
}

// Per entry that is not the canonical link: { line (1-based), dir, message,
// fixed (the rewritten line, or null when the story folder is missing) }.
function storyLinkIssues(epicDir, indexText) {
  const lines = indexText.split(/\r?\n/);
  const issues = [];

  for (const entry of parseStoryEntries(indexText)) {
    const expected = expectedTarget(epicDir, entry.dir);
    const line = entry.line + 1;

    if (!expected) {
      issues.push({ line, dir: entry.dir, message: `${entry.dir} has no folder — create it or drop the entry`, fixed: null });
      continue;
    }

    if (entry.link && entry.link.text === entry.dir && entry.link.target === expected) {
      continue;
    }

    issues.push({
      line,
      dir: entry.dir,
      message: describe(epicDir, entry, expected),
      fixed: canonicalLine(lines[entry.line], entry, expected),
    });
  }

  return issues;
}

// Rewrites the fixable entries of one index.md in place; returns how many.
function fixStoryLinks(epicDir) {
  const indexPath = path.join(epicDir, "index.md");
  if (!fs.existsSync(indexPath)) return 0;

  const text = fs.readFileSync(indexPath, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let count = 0;

  for (const issue of storyLinkIssues(epicDir, text)) {
    if (issue.fixed !== null) {
      lines[issue.line - 1] = issue.fixed;
      count += 1;
    }
  }

  if (count > 0) fs.writeFileSync(indexPath, lines.join(eol));
  return count;
}

module.exports = { storyLinkIssues, fixStoryLinks };
