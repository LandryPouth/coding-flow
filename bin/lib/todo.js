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

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { readConfig } = require("./config");
const { currentBranch } = require("./policy");
const { execFileSync } = require("child_process");

const { getStorage } = require("./storage");
const { withFileLock } = require("./placement-store");
const { storyPartPath, FINISHED_STATUSES } = require("./story");
const { log, normalizePortable } = require("./util");
const { readHarnessConfig } = require("./harness-config");
const { getSecretPatterns, findSecretsInContent } = require("./security-policy");

const DEFAULT_TODO_HEADINGS = ["Maintainer to-do", "Maintainer cleanup on delivery"];

// Order inside an epic: what the epic index asks of the maintainer, then each
// story's items in story order (a question first, then the story itself, then
// what it deferred).
const TODO_KINDS = ["maintainer", "human-todo", "needs-you", "human-owner", "deferred"];

// `## Human to-do` (story 26-07): one checkbox line per action only a human can
// take, `- [ ] (before: deploy) Run the backfill, then deploy`. `when` says
// before what: the deploy, the next story of the chain, or nothing (`later`).
const HUMAN_TODO_HEADING = "Human to-do";
const WHEN_VALUES = ["deploy", "next-story", "later"];
const WHEN_PREFIX = /^\(\s*before\s*:\s*([^)]*?)\s*\)\s*/i;

// `(before: deploy) text` → { when, text }. No prefix, or a value outside the
// three, reads as `later` and says why (`whenIssue`), for doctor to warn.
function parseWhen(text) {
  const match = text.match(WHEN_PREFIX);

  if (!match) {
    return { when: "later", text, whenIssue: "missing" };
  }

  const rest = text.slice(match[0].length);
  const value = match[1].toLowerCase();

  return WHEN_VALUES.includes(value) ? { when: value, text: rest } : { when: "later", text: rest, whenIssue: `unknown "${match[1]}"` };
}

// A short id derived from where the item is and what it says: editing the text
// changes it, which is fine (it names this line, not a ticket).
function todoId(epic, story, text) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("sha1").update(`${epic}\n${story || ""}\n${normalized}`).digest("hex").slice(0, 7);
}

// The project's secret patterns (the guard's own), compiled once per read.
function secretPatternsOf(root) {
  try {
    return getSecretPatterns(readHarnessConfig(root).config);
  } catch {
    return getSecretPatterns(null);
  }
}

// Masks every match of every pattern that fires on `text`. Returns the masked
// text and the first pattern's name, or null when nothing fired.
function maskSecrets(text, patterns) {
  const found = findSecretsInContent(text, patterns);

  if (found.length === 0) {
    return { text, secret: null };
  }

  let masked = text;

  for (const pattern of patterns) {
    const flags = pattern.regex.flags.includes("g") ? pattern.regex.flags : `${pattern.regex.flags}g`;
    masked = masked.replace(new RegExp(pattern.regex.source, flags), "[masked]");
  }

  return { text: masked, secret: found[0].name };
}

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

  for (const [offset, raw] of all.slice(front.length).entries()) {
    // 1-based line in the file, kept on each block so a checkbox can be ticked
    // where it is (`ai-flow todo done`) and a warning can name its line.
    state.lineNo = front.length + offset + 1;
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
    line: state.lineNo,
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
      state.last.lineNumbers.push(state.lineNo);
    }
  } else if (state.afterBlank && open && indent > open.indent) {
    open.text = `${open.text} ${text}`;
    state.last = open;
  } else {
    if (indent === 0 || state.afterBlank) {
      state.listStack = state.listStack.filter((entry) => entry.indent < indent);
    }

    state.last = { type: "prose", text, lines: [text], lineNumbers: [state.lineNo], headings: state.headings, line: state.lineNo };
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
function maintainerItems(scan, headings) {
  return scan.blocks.filter((block) => block.type === "item" && block.box === " " && underAny(block, headings));
}

// Open `- [ ]` items under `## Human to-do` (any level, any depth), with the
// line they sit on. A checked `[x]` item is done; a plain bullet is not a to-do.
function humanTodoBlocks(scan) {
  return scan.blocks.filter((block) => block.type === "item" && block.box === " " && underAny(block, [HUMAN_TODO_HEADING]));
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
  const read = (file) => (fs.existsSync(file) ? { file, content: fs.readFileSync(file, "utf8") } : null);
  const specFile = storyPartPath(storyDir, "spec");
  const others = [...new Set(["plan", "tasks"].map((part) => storyPartPath(storyDir, part)))].filter(
    (file) => file !== specFile,
  );

  return { spec: read(specFile), others: others.map(read).filter(Boolean) };
}

// `## Human to-do` items of one file, as to-do entries. Listed whatever the
// story's status: a `before: deploy` item outlives the land by design.
function humanTodoItems(root, file, scan, { epic, story = null }) {
  const source = normalizePortable(path.relative(root, file));

  return humanTodoBlocks(scan).map((block) => {
    const parsed = parseWhen(block.text);

    return {
      kind: "human-todo",
      when: parsed.when,
      text: parsed.text,
      ...(parsed.whenIssue ? { whenIssue: parsed.whenIssue } : {}),
      ...(story ? { story } : {}),
      source,
      line: block.line,
      _epic: epic,
    };
  });
}

function storyItems(root, story, epic) {
  const files = storyFiles(path.join(root, story.path));
  const specFile = files.spec;
  const scanned = [specFile, ...files.others].filter(Boolean).map((entry) => ({ ...entry, scan: scanMarkdown(entry.content) }));
  const spec = specFile ? scanned[0].scan : null;
  const scans = scanned.map((entry) => entry.scan);
  const item = (kind, text, extra = {}) => ({ kind, text, ...extra, story: story.name, source: story.path });
  const items = scanned.flatMap((entry) => humanTodoItems(root, entry.file, entry.scan, { epic, story: story.name }));

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
  const patterns = secretPatternsOf(root);
  const grouped = [];

  for (const epic of epics) {
    const indexFile = path.join(root, epic.path, "index.md");
    const indexContent = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, "utf8") : "";
    const indexScan = scanMarkdown(indexContent);
    const items = maintainerItems(indexScan, headings).map((block) => ({
      kind: "maintainer",
      text: block.text,
      source: `${epic.path}/index.md`,
      line: block.line,
    }));
    const indexTodos = humanTodoItems(root, indexFile, indexScan, { epic: epic.name });
    const storyTodos = epic.stories.flatMap((story) => storyItems(root, story, epic.name));
    // The same text under a story and the epic index is listed once: the story wins.
    const storyTexts = new Set(storyTodos.filter((entry) => entry.kind === "human-todo").map((entry) => normalizedText(entry.text)));

    items.push(...indexTodos.filter((entry) => !storyTexts.has(normalizedText(entry.text))), ...storyTodos);

    if (items.length > 0) {
      grouped.push({ epic: epic.name, path: epic.path, items: items.map((entry) => finishItem(entry, epic.name, patterns)) });
    }
  }

  return { count: grouped.reduce((sum, epic) => sum + epic.items.length, 0), epics: grouped };
}

const normalizedText = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

// Every item gets its id; its text is masked when it matches a secret pattern
// (printed and in --json alike), and says which pattern fired.
function finishItem(entry, epic, patterns) {
  const { _epic, ...item } = entry;
  const masked = maskSecrets(item.text, patterns);
  const id = todoId(epic, item.story, item.text);
  const options = item.options ? { options: item.options.map((option) => maskSecrets(option, patterns).text) } : {};

  return { id, ...item, ...options, text: masked.text, ...(masked.secret ? { secret: masked.secret } : {}) };
}

const KIND_LABELS = {
  maintainer: "to-do",
  "human-todo": "human to-do",
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
      const label = item.kind === "human-todo" ? `before: ${item.when}` : KIND_LABELS[item.kind];
      log(`- [${label}] ${item.text}${where} [${item.id}]`);

      for (const option of item.options || []) {
        log(`    - ${option}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// What waits on a human, flattened for `next`'s We need you block (and its
// `--json` `needsYou`): `## Human to-do` items keep their `when`; a Needs you
// question and a ready `Owner: human` story block the chain (`next-story`);
// an item under a `todo.headings` heading has no deadline (`later`). Deferred
// criteria are a debt, not an action: they stay in `ai-flow todo` only.
// ---------------------------------------------------------------------------

const WHEN_OF_KIND = { "needs-you": "next-story", "human-owner": "next-story", maintainer: "later" };
const WHEN_ORDER = { deploy: 0, "next-story": 1, later: 2 };

function needsYouEntries(payload) {
  const entries = payload.epics.flatMap((epic) =>
    epic.items
      .filter((item) => item.kind !== "deferred")
      .map((item) => ({
        id: item.id,
        when: item.kind === "human-todo" ? item.when : WHEN_OF_KIND[item.kind],
        epic: epic.epic,
        story: item.story || null,
        text: item.text,
        source: item.source,
        kind: item.kind,
      })),
  );

  // A stable sort: epic order is kept inside each `when`.
  return entries.sort((a, b) => WHEN_ORDER[a.when] - WHEN_ORDER[b.when]);
}

function collectNeedsYou(root) {
  return needsYouEntries(collectTodos(root, { headings: todoHeadings(readConfig(root)) }));
}

// Open `before: deploy` items of the given stories (story dirs, as storage names
// their `path`). What `ship`, `land` and `autoland` say out loud.
function openDeployTodos(root, storyPaths) {
  const relative = (entry) => (path.isAbsolute(entry) ? path.relative(root, entry) : entry);
  const wanted = new Set(storyPaths.map((entry) => normalizePortable(relative(entry)).replace(/^\.\//, "").replace(/\/+$/, "")));

  return collectNeedsYou(root).filter(
    (entry) => entry.kind === "human-todo" && entry.when === "deploy" && [...wanted].some((dir) => entry.source.startsWith(`${dir}/`)),
  );
}

// The lines `ship` and `land` print; nothing when there is nothing to say.
function printDeployTodos(entries, write = log) {
  if (entries.length === 0) {
    return;
  }

  write(`Before you deploy (${entries.length}):`);

  for (const entry of entries) {
    write(`  - [ ] ${entry.text} (${entry.story || entry.epic}) [${entry.id}]`);
  }
}

// ---------------------------------------------------------------------------
// Uncaptured prose (`todo.uncaptured`): a story whose `## Result` says
// something only a human can do ("before the deploy", "à faire par
// l'utilisateur") while it has no open `## Human to-do` item. A warning in
// `verify` and `doctor`, never a failure: the phrase list is a heuristic.
// ---------------------------------------------------------------------------

// A bare "in production" / "en prod" describes the product ("JSON logs, one
// line in production"); only an action done there is a to-do: a verb before
// it ("run the seed in production", "à lancer en prod") or right after it ("In
// production, set …").
const DEFAULT_UNCAPTURED_PATTERNS = [
  "the maintainer must",
  "to do by the user",
  "before (the )?deploy",
  "\\b(run|set|apply|execute|launch|trigger|enable|rotate|seed|migrate)\\b[^.]*\\bin prod(uction)?\\b",
  "^\\W*in prod(uction)?\\b[\\s,:—–-]*(run|set|apply|execute|launch|trigger|enable|rotate|seed|migrate)\\b",
  "à faire par l'utilisateur",
  "côté utilisateur",
  "avant (le )?déploiement",
  "(lancer|exécuter|appliquer|activer|définir|configurer|à faire)[^.]*\\ben prod(uction)?\\b",
  "^\\W*en prod(uction)?\\b[\\s,:—–-]*(lancer|exécuter|appliquer|activer|définir|configurer)",
];

// `todo.uncapturedPatterns`: each entry a case-insensitive regular expression.
// A value that is not a list of strings falls back to the defaults; an entry
// that does not compile is skipped.
function uncapturedPatterns(config) {
  const declared = config && config.todo && config.todo.uncapturedPatterns;
  const source = Array.isArray(declared) && declared.some((entry) => typeof entry === "string" && entry.trim())
    ? declared.filter((entry) => typeof entry === "string" && entry.trim())
    : DEFAULT_UNCAPTURED_PATTERNS;

  return source.flatMap((entry) => {
    try {
      return [new RegExp(entry, "iu")];
    } catch {
      return [];
    }
  });
}

// The lines of a block, each with its line number.
function blockLines(block) {
  return block.type === "prose"
    ? block.lines.map((text, index) => ({ text, line: block.lineNumbers[index] }))
    : [{ text: block.text, line: block.line }];
}

// `storyDir` is the story's directory (absolute). Returns `[{ source, line,
// text }]`, empty when the story already holds an open `## Human to-do` item.
function uncapturedTodoLines(root, storyDir, config) {
  const files = storyFiles(storyDir);
  const scanned = [files.spec, ...files.others].filter(Boolean).map((entry) => ({ ...entry, scan: scanMarkdown(entry.content) }));

  if (scanned.some((entry) => humanTodoBlocks(entry.scan).length > 0)) {
    return [];
  }

  const patterns = uncapturedPatterns(config);
  const secrets = secretPatternsOf(root);
  const found = [];

  for (const entry of scanned) {
    const source = normalizePortable(path.relative(root, entry.file));
    // A `### Rollback` sub-block says what to do if it goes wrong, not a step
    // of the delivery.
    const result = entry.scan.blocks.filter((block) => underAny(block, ["Result"]) && !underAny(block, ["Rollback"]));

    for (const { text, line } of result.flatMap(blockLines)) {
      if (patterns.some((pattern) => pattern.test(text))) {
        // Masked here, so verify and doctor can only print the masked line.
        found.push({ source, line, text: maskSecrets(text, secrets).text });
      }
    }
  }

  return found;
}

// Printed by `verify --story` after its verdict, from the command layer (the
// verify core does not read story to-dos): a warning, never part of the proof.
// With no `--story`, the story verify resolved itself (the active Spec Kit
// feature) is read, as verify scoped to it.
function implicitStory(root) {
  const feature = require("./speckit").detectFeature(root, { branch: currentBranch(root) });
  return feature ? feature.dir : null;
}

function printUncapturedTodos(root, storyPath) {
  let lines = [];
  try {
    const story = storyPath || implicitStory(root);
    if (!story) {
      return;
    }
    lines = uncapturedTodoLines(root, path.resolve(root, story), readConfig(root));
  } catch {
    return; // best effort: a read error never changes a verify.
  }

  if (lines.length === 0) {
    return;
  }

  log(`Warning — todo.uncaptured: ${lines.length} line(s) of the Result say something only a human can do, and the story has no open \`## Human to-do\` item:`);

  for (const entry of lines) {
    log(`  ${entry.source}:${entry.line}: ${entry.text}`);
  }

  log("  Write it as: `## Human to-do` then `- [ ] (before: deploy|next-story|later) <the action>`.");
}

// ---------------------------------------------------------------------------
// `ai-flow todo done <id>`: ticks that one checkbox, under a lock, and nothing
// else in the file. Only checkbox items (`## Human to-do`, `todo.headings`) can
// be ticked; a question or an owner is answered in its file.
// ---------------------------------------------------------------------------

const TICKABLE = new Set(["human-todo", "maintainer"]);
const UNCHECKED_BOX = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[ ?\]/;

function todoLockPath(root) {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return path.join(path.resolve(root, common), "coding-flow", "todo.lock");
  } catch {
    return path.join(root, ".coding-flow", "todo.lock");
  }
}

function findTodo(root, id) {
  const matches = collectTodos(root, { headings: todoHeadings(readConfig(root)) }).epics.flatMap((epic) =>
    epic.items.filter((item) => item.id === id).map((item) => ({ ...item, epic: epic.epic })),
  );

  if (matches.length === 0) {
    throw new Error(`no open to-do has the id "${id}". Run "ai-flow todo" to list them with their ids.`);
  }

  if (matches.length > 1) {
    throw new Error(`the id "${id}" names ${matches.length} items (${matches.map((item) => `${item.source}:${item.line}`).join(", ")}); tick the one you mean in its file.`);
  }

  if (!TICKABLE.has(matches[0].kind)) {
    throw new Error(`"${id}" is not a checkbox (${KIND_LABELS[matches[0].kind]}, in ${matches[0].source}); answer it in its file.`);
  }

  return matches[0];
}

// The id of the open checkbox that starts on the item's line now (the same
// hash `todo` lists, a wrapped item read whole), or null when that line no
// longer starts an open checkbox.
function currentTodoId(content, item) {
  const block = scanMarkdown(content).blocks.find((entry) => entry.type === "item" && entry.line === item.line);

  if (!block || block.box !== " ") {
    return null;
  }

  return todoId(item.epic, item.story, item.kind === "human-todo" ? parseWhen(block.text).text : block.text);
}

// `dryRun`: says which line would be ticked, and writes nothing.
function todoDone(root, id, { dryRun = false } = {}) {
  const item = findTodo(root, id);
  const file = path.join(root, item.source);

  const tick = () => {
    const content = fs.readFileSync(file, "utf8");
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const index = item.line - 1;

    // Re-read under the lock: the line must still be that open checkbox, with
    // the same text (another writer may have edited it since the read).
    const now = UNCHECKED_BOX.test(lines[index] || "") ? currentTodoId(content, item) : null;
    if (now === null) {
      throw new Error(`${item.source}:${item.line} is no longer an open checkbox; nothing was changed.`);
    }
    if (now !== id) {
      throw new Error(`${item.source}:${item.line} changed since it was read (it no longer holds "${id}"); nothing was changed. Run "ai-flow todo" again.`);
    }

    lines[index] = lines[index].replace(UNCHECKED_BOX, "$1[x]");
    if (!dryRun) {
      fs.writeFileSync(file, lines.join(eol));
    }
    return { ...item, dryRun, ticked: maskSecrets(lines[index].trim(), secretPatternsOf(root)).text };
  };

  return dryRun ? tick() : withFileLock(todoLockPath(root), tick);
}

function todoDoneCommand(id, { dryRun = false } = {}) {
  const result = todoDone(cwd, id, { dryRun });
  log(`${dryRun ? "Would tick" : "Ticked"} ${result.source}:${result.line}${dryRun ? " (dry run: nothing written)" : ""}`);
  log(`  ${result.ticked}`);
}

function todoCommand({ json = false } = {}) {
  const payload = collectTodos(cwd, { headings: todoHeadings(readConfig(cwd)) });

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  printTodos(payload);
}

module.exports = {
  scanMarkdown,
  collectTodos,
  collectNeedsYou,
  needsYouEntries,
  openDeployTodos,
  printDeployTodos,
  todoHeadings,
  todoCommand,
  todoDone,
  todoDoneCommand,
  parseWhen,
  maskSecrets,
  uncapturedTodoLines,
  uncapturedPatterns,
  printUncapturedTodos,
  DEFAULT_UNCAPTURED_PATTERNS,
  secretPatternsOf,
  headingMatches,
  DEFAULT_TODO_HEADINGS,
  TODO_KINDS,
  WHEN_VALUES,
  HUMAN_TODO_HEADING,
};
