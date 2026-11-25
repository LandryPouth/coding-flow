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
const { storyPartPath, FINISHED_STATUSES } = require("./story");
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

// ---------------------------------------------------------------------------
// The one Markdown scanner. Every reader below (to-do sections, Needs you,
// Owner: human, deferred criteria) goes through `scanMarkdown`, so a rule about
// what is an example and what is a to-do is decided once.
//
// Code is never content:
// - a line whose trimmed start is ``` or ~~~ opens a fence at ANY indent (under
//   a list item too); the same marker run, at least as long, closes it; an
//   unclosed fence runs to the end of the file (safe side: nothing is invented);
// - a line indented 4 spaces or a tab, after a blank line, is an indented code
//   block — unless a list is open (then it is the list's nested item or
//   continuation). A heading, or a blank line followed by a line at the margin
//   that is not an item, closes the list.
// ---------------------------------------------------------------------------

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const INDENTED_CODE = /^( {4}|\t)/;
const BLOCKQUOTE = /^ {0,3}>\s?/;
// A list item, with an optional checkbox: `[ ]` or `[]` (unchecked), `[x]`, `[~]`.
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX~]?)\]\s+)?(.*\S)\s*$/;

const indentOf = (line) => line.replace(/\t/g, "    ").match(/^ */)[0].length;

// YAML-ish front matter (`---` … `---` on the first line): `key: value` pairs,
// keys lower-cased. Returns the pairs and the number of lines it spans.
function frontMatter(lines) {
  if (!/^---\s*$/.test(lines[0] || "")) {
    return { fields: {}, length: 0 };
  }

  const close = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));

  if (close === -1) {
    return { fields: {}, length: 0 };
  }

  const fields = {};

  for (const line of lines.slice(1, close)) {
    const pair = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/);

    if (pair) {
      fields[pair[1].toLowerCase()] = pair[2].replace(/^["']|["']$/g, "");
    }
  }

  return { fields, length: close + 1 };
}

// Scans `content` into its front matter and its blocks, in order:
// - `{ type: "item", box, text, depth, children, headings }`: box is " ", "x",
//   "~", or null without a checkbox; wrapped lines are joined into `text`;
//   nested items are in `children` (and in the list too, with depth > 0);
// - `{ type: "prose", text, lines, headings }`: a paragraph (blockquote markers
//   stripped), its lines kept one by one;
// `headings` is the stack of headings the block sits under.
function scanMarkdown(content) {
  const all = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const front = frontMatter(all);
  const state = { blocks: [], headings: [], fence: null, comment: false, afterBlank: true, inIndentedCode: false, listStack: [], last: null };

  for (const raw of all.slice(front.length)) {
    // A blockquote's content is read like any other (`> - [ ] task`), except
    // that a quoted heading is quoted text, not a section.
    const quoted = /^ {0,3}>/.test(raw);
    const unquoted = raw.replace(/^(?: {0,3}>\s?)+/, "");
    // Comments are not looked for inside a fence, nor on the line opening one.
    const opensFence = !state.comment && FENCE.test(unquoted);
    const line = state.fence || opensFence ? raw : withoutComments(state, unquoted);

    if (line === null || consumedAsCodeOrBlank(state, line)) {
      continue;
    }

    const heading = quoted ? null : line.match(HEADING);
    const item = line.match(LIST_ITEM);

    if (heading) {
      openHeading(state, heading);
      continue;
    }

    if (item) {
      addItem(state, item);
    } else {
      addText(state, line);
    }

    state.afterBlank = false;
  }

  return { frontMatter: front.fields, blocks: state.blocks };
}

// HTML comments (`<!-- … -->`, over several lines too) are not content, like
// code. Returns the line without them, or null when nothing is left of it.
// Markers inside a code span (`` `<!--` ``) are text: they are looked for in
// a copy where code spans are blanked, so positions still line up.
function withoutComments(state, line) {
  let rest = line;
  const masked = () => rest.replace(/(`+)[^`][\s\S]*?\1/g, (span) => " ".repeat(span.length));

  if (state.comment) {
    const end = masked().indexOf("-->");

    if (end === -1) {
      return null;
    }

    state.comment = false;
    rest = rest.slice(end + 3);
  }

  for (let open = masked().indexOf("<!--"); open !== -1; open = masked().indexOf("<!--")) {
    const end = masked().indexOf("-->", open + 4);

    if (end === -1) {
      state.comment = true;
      rest = rest.slice(0, open);
      break;
    }

    rest = rest.slice(0, open) + rest.slice(end + 3);
  }

  return rest !== line && !rest.trim() ? null : rest;
}

// Fences, blank lines and indented code: true when `line` is one of them (it is
// then not content).
function consumedAsCodeOrBlank(state, line) {
  const mark = line.match(FENCE);

  if (state.fence) {
    const closes = mark && mark[1][0] === state.fence[0] && mark[1].length >= state.fence.length;

    if (closes && !line.trim().slice(mark[1].length).trim()) {
      state.fence = null;
    }

    state.afterBlank = false;
    return true;
  }

  if (mark) {
    state.fence = mark[1];
    state.afterBlank = false;
    return true;
  }

  if (!line.trim()) {
    state.afterBlank = true;
    state.last = null;
    return true;
  }

  const startsCode = state.afterBlank && state.listStack.length === 0;

  if (INDENTED_CODE.test(line) && (state.inIndentedCode || startsCode)) {
    state.inIndentedCode = true;
    state.afterBlank = false;
    return true;
  }

  state.inIndentedCode = false;
  return false;
}

function openHeading(state, heading) {
  const level = heading[1].length;
  state.headings = [...state.headings.filter((entry) => entry.level < level), { level, text: heading[2].trim() }];
  state.listStack = [];
  state.last = null;
  // An indented code block may follow a heading directly.
  state.afterBlank = true;
}

function addItem(state, item) {
  const indent = indentOf(item[1]);
  state.listStack = state.listStack.filter((open) => open.indent < indent);
  const parent = state.listStack[state.listStack.length - 1] || null;
  const block = {
    type: "item",
    box: item[2] === undefined ? null : item[2].toLowerCase() || " ",
    text: item[3],
    depth: state.listStack.length,
    indent,
    children: [],
    headings: state.headings,
  };

  if (parent) {
    parent.children.push(block);
  }

  state.listStack.push(block);
  state.blocks.push(block);
  state.last = block;
}

// A line that is neither a heading nor an item: it continues the block right
// above it (no blank line between, any indent — a lazy continuation included),
// or, after a blank line, the open item when indented under it; otherwise it
// starts a prose paragraph, which closes the list when it sits at the margin.
function addText(state, line) {
  const text = line.trim().replace(BLOCKQUOTE, "");
  const indent = indentOf(line);
  const open = state.listStack[state.listStack.length - 1];

  if (state.last && !state.afterBlank) {
    state.last.text = `${state.last.text} ${text}`;

    if (state.last.lines) {
      state.last.lines.push(text);
    }
  } else if (state.afterBlank && open && indent > open.indent) {
    open.text = `${open.text} ${text}`;
    state.last = open;
  } else {
    if (indent === 0 || state.afterBlank) {
      state.listStack = state.listStack.filter((entry) => entry.indent < indent);
    }

    state.last = { type: "prose", text, lines: [text], headings: state.headings };
    state.blocks.push(state.last);
  }
}

// A heading matches a configured name when it starts with it (any case),
// followed by the end or by a space, `(`, `:`, `—`, `–` or `-`:
// `## À faire côté utilisateur (epics 39 et 40)`, `## Needs you (round 2)`,
// `## Maintainer to-do:` match; `## Maintainer to-dos` does not.
function headingMatches(heading, name) {
  const text = heading.toLowerCase();
  const wanted = name.toLowerCase();
  return text.startsWith(wanted) && /^(?:$|[\s(:—–-])/.test(text.slice(wanted.length));
}

const underAny = (block, names) =>
  block.headings.some((heading) => names.some((name) => headingMatches(heading.text, name)));

// Unchecked `- [ ]` items, at any depth, under the configured headings of an
// epic index.
function maintainerItems(indexContent, headings) {
  return scanMarkdown(indexContent)
    .blocks.filter((block) => block.type === "item" && block.box === " " && underAny(block, headings))
    .map((block) => block.text);
}

// A story file's `## Needs you` items: each top-level list item not checked
// `[x]`, with its sub-items as `options`, and each prose paragraph (a
// question, "Run this:"), in order. An empty section is nothing.
function needsYouItems(scan) {
  return scan.blocks
    .filter((block) => underAny(block, ["Needs you"]))
    .filter((block) => block.type === "prose" || (block.depth === 0 && block.box !== "x"))
    .map((block) => ({ text: block.text, options: block.type === "item" ? block.children.map((child) => child.text) : [] }));
}

// `Owner: human` at the start of a line — in the text, a list item, a
// blockquote, or front matter (`owner: human`, any case). `Owner:
// human-in-the-loop`, a mention inside a sentence, or code is not it.
// A one-line reason may follow (`Owner: human — touches money`, the form 20-05
// writes): `human` then the end, a space or a separator, never a word joined
// by a hyphen.
const OWNER_HUMAN = /^\**Owner\**\s*:\s*\**\s*human\**(?=$|[\s—–:,;(.]|-(?![\p{L}\d]))/iu;

function ownedByHuman(scan) {
  if (scan.frontMatter.owner !== undefined && OWNER_HUMAN.test(`Owner: ${scan.frontMatter.owner}`)) {
    return true;
  }

  return scan.blocks.some((block) =>
    block.type === "prose" ? block.lines.some((line) => OWNER_HUMAN.test(line.trim())) : OWNER_HUMAN.test(block.text.trim()),
  );
}

// Deferred `[~]` criteria: items under the spec's `## Acceptance Criteria`
// (the section the coverage gate reads). A `[~]` task under `## Tasks` is
// bookkeeping. A finished story's deferred criteria stay listed: a deferral is
// still a debt.
function deferredCriteria(scan) {
  return scan.blocks
    .filter((block) => block.type === "item" && block.box === "~" && underAny(block, ["Acceptance Criteria"]))
    .map((block) => block.text);
}

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
  const spec = files.spec === null ? null : scanMarkdown(files.spec);
  const scans = [spec, ...files.others.map(scanMarkdown)].filter(Boolean);
  const item = (kind, text, extra = {}) => ({ kind, text, ...extra, story: story.name, source: story.path });
  const items = [];

  // A finished story asks nothing any more: its Needs you and its owner are
  // history. Its deferred criteria stay listed (a deferral is still a debt).
  if (!FINISHED_STATUSES.has(story.status)) {
    items.push(...scans.flatMap(needsYouItems).map((entry) => item("needs-you", entry.text, { options: entry.options })));

    if (scans.some(ownedByHuman)) {
      items.push(item("human-owner", story.title));
    }
  }

  if (spec) {
    items.push(...deferredCriteria(spec).map((text) => item("deferred", text)));
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

      for (const option of item.options || []) {
        log(`    - ${option}`);
      }
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

module.exports = { scanMarkdown, collectTodos, todoHeadings, todoCommand, DEFAULT_TODO_HEADINGS, TODO_KINDS };
