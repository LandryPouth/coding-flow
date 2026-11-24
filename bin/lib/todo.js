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

// Each section of `content` whose heading (any level) is one of `headings`,
// case-insensitive, as its lines up to the next heading of the same or a
// higher level.
function sectionsUnder(content, headings) {
  const wanted = new Set(headings.map((heading) => heading.toLowerCase()));
  const lines = content.split(/\r?\n/);
  const sections = [];
  let current = null;
  let fence = null;

  for (const line of lines) {
    // A heading inside a fenced code block is an example, not a section.
    const fenceMark = line.match(/^\s*(```+|~~~+)/);

    if (fenceMark && (!fence || fenceMark[1][0] === fence[0])) {
      fence = fence ? null : fenceMark[1];
    }

    const heading = fence || fenceMark ? null : line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);

    if (heading) {
      if (current && heading[1].length <= current.level) {
        sections.push(current.lines);
        current = null;
      }

      if (!current && wanted.has(heading[2].trim().toLowerCase())) {
        current = { level: heading[1].length, lines: [] };
      }

      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(current.lines);
  }

  return sections;
}

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[( |x|X|~)\]\s+)?(.*\S)\s*$/;

// The list items among `lines`, each with its checkbox (" ", "x", "~", or null
// when it has none) and its text, wrapped lines joined: a line indented under
// an item, that is not itself an item, continues it.
function listItems(lines) {
  const items = [];
  let last = null;

  for (const line of lines) {
    const match = line.match(LIST_ITEM);

    if (match) {
      last = { indent: match[1].length, box: match[2] === undefined ? null : match[2].toLowerCase(), text: match[3] };
      items.push(last);
    } else if (last && line.trim() && line.match(/^\s*/)[0].length > last.indent) {
      last.text = `${last.text} ${line.trim()}`;
    } else {
      last = null;
    }
  }

  return items;
}

// Unchecked `- [ ]` items under the configured headings of an epic index.
function maintainerItems(indexContent, headings) {
  return sectionsUnder(indexContent, headings).flatMap((lines) =>
    listItems(lines)
      .filter((item) => item.box === " ")
      .map((item) => item.text),
  );
}

// A `## Needs you` section: each list item not checked `[x]`; a section
// written as prose is one item (its lines joined); an empty one is nothing.
function needsYouItems(content) {
  return sectionsUnder(content, ["Needs you"]).flatMap((lines) => {
    const listed = listItems(lines);

    if (listed.length > 0) {
      return listed.filter((item) => item.box !== "x").map((item) => item.text);
    }

    const prose = lines.map((line) => line.trim()).filter(Boolean).join(" ");
    return prose ? [prose] : [];
  });
}

// `lines` without the fenced code blocks: a `- [~]` in an example is not a
// deferred criterion.
function outsideFences(lines) {
  let fence = null;
  return lines.filter((line) => {
    const mark = line.match(/^\s*(```+|~~~+)/);

    if (mark && (!fence || mark[1][0] === fence[0])) {
      fence = fence ? null : mark[1];
      return false;
    }

    return !fence;
  });
}

const OWNER_HUMAN = /^\s*(?:[-*+]\s+)?\**Owner\**\s*:\s*\**\s*human\b/im;

function storyParts(storyDir) {
  // A single-file story answers every part with story.md; a split one has a
  // file per part. Reading each file once keeps both shapes from double-counting.
  const files = [...new Set(["spec", "plan", "tasks"].map((part) => storyPartPath(storyDir, part)))];
  return files.filter((file) => fs.existsSync(file)).map((file) => fs.readFileSync(file, "utf8"));
}

function storyItems(root, story) {
  const storyDir = path.join(root, story.path);
  const parts = storyParts(storyDir);
  const item = (kind, text) => ({ kind, text, story: story.name, source: story.path });
  const items = parts.flatMap((content) => needsYouItems(content)).map((text) => item("needs-you", text));

  if (story.status !== "done" && parts.some((content) => OWNER_HUMAN.test(content))) {
    items.push(item("human-owner", story.title));
  }

  for (const content of parts) {
    const deferred = listItems(outsideFences(content.split(/\r?\n/))).filter((entry) => entry.box === "~");
    items.push(...deferred.map((entry) => item("deferred", entry.text)));
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
