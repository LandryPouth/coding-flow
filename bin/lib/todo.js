"use strict";

// `ai-flow todo`: everything waiting on a human, across all epics, in one
// read-only list. Today those to-dos live in epic indexes, `## Needs you`
// sections, `Owner: human` stories and deferred `[~]` criteria, and are
// recalled by hand.
//
// This module is the one reader 26-07 extends (the `## Human to-do` shape with
// `when`, `ai-flow todo done`, `next`'s "We need you" block). Its API is small
// on purpose: `collectTodos(root, { headings })` returns the grouped items,
// `todoHeadings(config)` the headings an epic index is read under, and
// `TODO_KINDS` the item kinds. Nothing here writes a file.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { readConfig } = require("./config");
const { getStorage } = require("./storage");
const { storyPartPath } = require("./story");
const { log } = require("./util");

const DEFAULT_TODO_HEADINGS = ["Maintainer to-do", "Maintainer cleanup on delivery"];

// Order inside an epic: what the epic index asks of the maintainer, then each
// story's items in story order (a question first, then the story itself, then
// what it deferred).
const TODO_KINDS = ["maintainer", "needs-you", "human-owner", "deferred"];

// `todo.headings` from the project's config.json; anything but a list of
// non-empty strings falls back to the defaults, like every other key.
function todoHeadings(config) {
  const declared = config && config.todo && config.todo.headings;

  if (Array.isArray(declared)) {
    const clean = declared.filter((heading) => typeof heading === "string" && heading.trim());

    if (clean.length > 0) {
      return clean.map((heading) => heading.trim());
    }
  }

  return [...DEFAULT_TODO_HEADINGS];
}

// The number an epic directory starts with (`epic-9-x` → 9), so `epic-10`
// sorts after `epic-9`. An epic without one sorts last, by name.
function epicNumber(name) {
  const match = name.match(/^epic-(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function byEpicAge(a, b) {
  return epicNumber(a.name) - epicNumber(b.name) || a.name.localeCompare(b.name);
}

// `lines` with every code block blanked (kept as empty lines, so a list item
// or paragraph around it ends there): fenced blocks (``` or ~~~) and indented
// blocks (4 spaces or a tab, after a blank line, outside a list). A heading,
// a `- [ ]` or a question inside one is an example, not a to-do.
function withoutCode(lines) {
  const out = [];
  let fence = null;
  let afterBlank = true;
  let inList = false;
  let inIndented = false;

  for (const line of lines) {
    const mark = line.match(/^ {0,3}(```+|~~~+)/);

    if (fence || mark) {
      if (mark && (!fence || (mark[1][0] === fence[0] && mark[1].length >= fence.length))) {
        fence = fence ? null : mark[1];
      }

      out.push("");
      afterBlank = false;
      continue;
    }

    if (!line.trim()) {
      out.push(line);
      afterBlank = true;
      continue;
    }

    const indentedCode = /^( {4}|\t)/.test(line);

    if (indentedCode && (inIndented || (afterBlank && !inList))) {
      inIndented = true;
      out.push("");
      afterBlank = false;
      continue;
    }

    inIndented = false;

    if (LIST_ITEM.test(line)) {
      inList = true;
    } else if (!/^\s/.test(line)) {
      // A line at the margin that is not an item ends the list (a lazy
      // continuation right after an item stays part of it).
      inList = inList && !afterBlank;
    }

    out.push(line);
    afterBlank = false;
  }

  return out;
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

// Splits code-free `lines` into the sections whose heading (any level) is one
// of `headings`, case-insensitive — each running to the next heading of the
// same or a higher level — and the lines outside them.
function splitSections(lines, headings) {
  const wanted = new Set(headings.map((heading) => heading.toLowerCase()));
  const inside = [];
  const outside = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(HEADING);

    if (heading) {
      if (current && heading[1].length <= current.level) {
        inside.push(current.lines);
        current = null;
      }

      if (!current && wanted.has(heading[2].trim().toLowerCase())) {
        current = { level: heading[1].length, lines: [] };
        continue;
      }
    }

    (current ? current.lines : outside).push(line);
  }

  if (current) {
    inside.push(current.lines);
  }

  return { inside, outside };
}

// A list item, with an optional checkbox: `[ ]` or `[]` (unchecked), `[x]`,
// `[~]`.
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX~]?)\]\s+)?(.*\S)\s*$/;

// The blocks of code-free `lines`, in order: list items (box " ", "x", "~", or
// null without a checkbox) with their wrapped lines joined, and prose
// paragraphs (box null, `prose: true`). A heading ends a block and is not one.
function blocks(lines) {
  const out = [];
  let last = null;

  for (const line of lines) {
    const match = line.match(LIST_ITEM);

    if (!line.trim() || HEADING.test(line)) {
      last = null;
    } else if (match) {
      const box = match[2] === undefined ? null : match[2].toLowerCase() || " ";
      last = { indent: match[1].length, box, text: match[3] };
      out.push(last);
    } else if (last && (last.prose || line.match(/^\s*/)[0].length > last.indent)) {
      last.text = `${last.text} ${line.trim()}`;
    } else {
      last = { indent: 0, box: null, prose: true, text: line.trim() };
      out.push(last);
    }
  }

  return out;
}

function codeFreeLines(content) {
  return withoutCode(content.replace(/^﻿/, "").split(/\r?\n/));
}

// Unchecked `- [ ]` items under the configured headings of an epic index.
function maintainerItems(indexContent, headings) {
  return splitSections(codeFreeLines(indexContent), headings).inside.flatMap((lines) =>
    blocks(lines)
      .filter((block) => block.box === " ")
      .map((block) => block.text),
  );
}

// A story file's `## Needs you` sections: each list item not checked `[x]`
// and each prose paragraph (a question, "Run this:"), in order. An empty
// section is nothing. `rest` is the file outside those sections.
function needsYou(content) {
  const { inside, outside } = splitSections(codeFreeLines(content), ["Needs you"]);
  const items = inside.flatMap((lines) =>
    blocks(lines)
      .filter((block) => block.box !== "x")
      .map((block) => block.text),
  );

  return { items, rest: outside };
}

// `Owner: human` on a line of its own (list bullet and bold allowed);
// `Owner: human-in-the-loop` or a mention inside a sentence is not it.
const OWNER_HUMAN = /^\s*(?:[-*+]\s+)?\**Owner\**\s*:\s*\**\s*human\s*\**\s*$/i;

// The story's files, each read once: a single-file story answers every part
// with story.md. `spec` is the file that holds the acceptance criteria.
function storyFiles(storyDir) {
  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
  const specFile = storyPartPath(storyDir, "spec");
  const others = [...new Set(["plan", "tasks"].map((part) => storyPartPath(storyDir, part)))].filter(
    (file) => file !== specFile,
  );

  return { spec: read(specFile), others: others.map(read).filter((content) => content !== null) };
}

function storyItems(root, story) {
  const files = storyFiles(path.join(root, story.path));
  const all = [files.spec, ...files.others].filter((content) => content !== null).map(needsYou);
  const item = (kind, text) => ({ kind, text, story: story.name, source: story.path });
  const items = all.flatMap((file) => file.items).map((text) => item("needs-you", text));

  if (story.status !== "done" && all.some((file) => file.rest.some((line) => OWNER_HUMAN.test(line)))) {
    items.push(item("human-owner", story.title));
  }

  // Deferred criteria live in the spec (or story.md); a `[~]` task in
  // tasks.md is bookkeeping, and one under Needs you is already listed.
  // A done story's deferred criteria stay listed: deferring is still a debt.
  if (files.spec !== null) {
    const deferred = blocks(all[0].rest).filter((block) => block.box === "~");
    items.push(...deferred.map((block) => item("deferred", block.text)));
  }

  return items;
}

// Everything waiting on a human, grouped by epic, oldest epic first. Epics
// with nothing waiting are left out.
function collectTodos(root, { headings = DEFAULT_TODO_HEADINGS } = {}) {
  const epics = [...getStorage(root).listEpics()].sort(byEpicAge);
  const grouped = [];

  for (const epic of epics) {
    const indexFile = path.join(root, epic.path, "index.md");
    const indexContent = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, "utf8") : "";
    const items = maintainerItems(indexContent, headings).map((text) => ({
      kind: "maintainer",
      text,
      source: `${epic.path}/index.md`,
    }));

    for (const story of epic.stories) {
      items.push(...storyItems(root, story));
    }

    if (items.length > 0) {
      grouped.push({ epic: epic.name, path: epic.path, items });
    }
  }

  return { count: grouped.reduce((sum, epic) => sum + epic.items.length, 0), epics: grouped };
}

const KIND_LABELS = {
  maintainer: "to-do",
  "needs-you": "needs you",
  "human-owner": "yours to do",
  deferred: "deferred",
};

function printTodos(payload) {
  if (payload.count === 0) {
    log("Nothing is waiting on you.");
    return;
  }

  log(`Waiting on you: ${payload.count} item(s)`);

  for (const epic of payload.epics) {
    log("");
    log(epic.epic);

    for (const item of epic.items) {
      const where = item.story ? ` (${item.story})` : "";
      log(`- [${KIND_LABELS[item.kind]}] ${item.text}${where}`);
    }
  }
}

function todoCommand({ json = false } = {}) {
  const payload = collectTodos(cwd, { headings: todoHeadings(readConfig(cwd)) });

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  printTodos(payload);
}

module.exports = { collectTodos, todoHeadings, todoCommand, DEFAULT_TODO_HEADINGS, TODO_KINDS };
