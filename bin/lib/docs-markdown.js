"use strict";

// Story 26-03: the Markdown reading `ai-flow docs check` needs — which lines are
// prose and which are code, the inline code spans and links of a prose line,
// and the anchors a page's headings make. Linear scanners only: a doc is input
// a hostile or simply large file can shape, and no regex here has nested or
// overlapping quantifiers.
//
// A second Markdown scanner beside story 26-02's `todo.js` one: two shapes of
// the same concept (rule of three — the third reader unifies them).

const SHELL_INFOS = new Set(["", "bash", "sh", "shell", "zsh", "console", "terminal", "powershell", "ps1", "cmd", "fish"]);

function leadingWidth(line) {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

// A fence opens at ANY indent (inside a list item too) on three or more ` or ~.
// A backtick opener whose info string holds a backtick is inline code, not a fence.
function fenceOpener(line) {
  const trimmed = line.trimStart();
  const char = trimmed[0];
  if (char !== "`" && char !== "~") return null;
  let length = 0;
  while (trimmed[length] === char) length += 1;
  if (length < 3) return null;
  const info = trimmed.slice(length).trim();
  if (char === "`" && info.includes("`")) return null;
  return { char, length, info: info.split(/\s/)[0].toLowerCase() };
}

function closesFence(line, fence) {
  const trimmed = line.trimStart();
  let length = 0;
  while (trimmed[length] === fence.char) length += 1;
  return length >= fence.length && trimmed.slice(length).trim() === "";
}

function isListItem(line) {
  const trimmed = line.trimStart();
  if (/^[-*+][ \t]/.test(trimmed)) return true;
  let digits = 0;
  while (digits < 10 && trimmed[digits] >= "0" && trimmed[digits] <= "9") digits += 1;
  return digits > 0 && (trimmed[digits] === "." || trimmed[digits] === ")") && /[ \t]/.test(trimmed[digits + 1] || "");
}

function isHeading(line) {
  return /^ {0,3}#{1,6}([ \t]|$)/.test(line);
}

// One entry per line: `prose` (read for paths, links, headings) or `code`
// (fenced, indented outside a list, or front matter), with the fence's info.
function classifyLines(lines) {
  const out = [];
  const state = { fence: null, inList: false, prevBlank: true, prevIndented: false };

  lines.forEach((line, index) => {
    if (index === 0 && line.trim() === "---") {
      state.frontMatter = true;
      out.push({ kind: "code", info: "yaml" });
      return;
    }
    if (state.frontMatter) {
      if (line.trim() === "---" || line.trim() === "...") state.frontMatter = false;
      out.push({ kind: "code", info: "yaml" });
      return;
    }
    out.push(classifyLine(line, state));
  });

  return out;
}

function classifyLine(line, state) {
  if (state.fence) {
    if (closesFence(line, state.fence)) {
      state.fence = null;
      state.prevBlank = false;
      return { kind: "fence" };
    }
    return { kind: "code", info: state.fence.info };
  }

  if (line.trim() === "") {
    state.prevBlank = true;
    return { kind: "prose" };
  }

  // Indented code first: a ``` inside it is text, not a fence (outside a list).
  const indent = leadingWidth(line);
  if (!state.inList && indent >= 4 && (state.prevBlank || state.prevIndented)) {
    state.prevIndented = true;
    state.prevBlank = false;
    return { kind: "code", info: "" };
  }

  const opener = fenceOpener(line);
  if (opener) {
    state.fence = opener;
    state.prevBlank = false;
    state.prevIndented = false;
    return { kind: "fence" };
  }

  state.prevIndented = false;
  if (isHeading(line)) state.inList = false;
  else if (isListItem(line)) state.inList = true;
  else if (indent === 0 && state.prevBlank) state.inList = false;
  state.prevBlank = false;
  return { kind: "prose" };
}

// Backtick runs of a line, with the next run of the same length found in
// amortised linear time (one moving pointer per length).
function backtickRuns(line) {
  const runs = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "`") continue;
    let j = i;
    while (line[j] === "`") j += 1;
    runs.push({ pos: i, len: j - i });
    i = j - 1;
  }
  return runs;
}

function closingRuns(runs) {
  const byLength = new Map();
  runs.forEach((run, index) => {
    if (!byLength.has(run.len)) byLength.set(run.len, []);
    byLength.get(run.len).push(index);
  });
  const pointer = new Map();
  return (index) => {
    const list = byLength.get(runs[index].len);
    let at = pointer.get(runs[index].len) || 0;
    while (at < list.length && list[at] <= index) at += 1;
    pointer.set(runs[index].len, at);
    return at < list.length ? list[at] : -1;
  };
}

// A prose line split into its code spans and its prose (spans and HTML
// comments blanked to spaces, so columns hold). `state.comment` carries an
// open `<!--` to the next line. A `<!--` inside a code span is text.
function inlineParts(line, state) {
  const spans = [];
  const prose = line.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) prose[k] = " ";
  };
  const runs = backtickRuns(line);
  const nextClosing = closingRuns(runs);
  let position = 0;
  let runIndex = 0;
  let commentAt = -2;

  while (position < line.length) {
    if (state.comment) {
      const end = line.indexOf("-->", position);
      blank(position, end === -1 ? line.length : end + 3);
      if (end === -1) return { spans, prose: prose.join("") };
      state.comment = false;
      position = end + 3;
      continue;
    }

    while (runIndex < runs.length && runs[runIndex].pos < position) runIndex += 1;
    if (commentAt !== -1 && commentAt < position) commentAt = line.indexOf("<!--", position);
    const run = runs[runIndex];

    if (commentAt !== -1 && (!run || commentAt < run.pos)) {
      state.comment = true;
      blank(commentAt, commentAt + 4);
      position = commentAt + 4;
      continue;
    }
    if (!run) break;

    const closing = nextClosing(runIndex);
    if (closing === -1) {
      position = run.pos + run.len;
      continue;
    }
    const end = runs[closing];
    spans.push({ text: line.slice(run.pos + run.len, end.pos).trim(), column: run.pos });
    blank(run.pos, end.pos + end.len);
    position = end.pos + end.len;
  }

  return { spans, prose: prose.join("") };
}

// Link destinations of a prose line: inline `](dest)` and reference
// definitions `[label]: dest`. Each `](` is read once, forward only.
function linkTargets(prose) {
  const targets = [];
  const definition = /^ {0,3}\[[^\]]{1,999}\]:[ \t]*(\S+)/.exec(prose);
  if (definition) targets.push(definition[1].replace(/^<|>$/g, ""));

  let from = 0;
  for (;;) {
    const at = prose.indexOf("](", from);
    if (at === -1) break;
    const read = readDestination(prose, at + 2);
    if (read.dest) targets.push(read.dest);
    from = Math.max(read.end, at + 2);
  }
  return targets;
}

function readDestination(text, start) {
  let i = start;
  while (text[i] === " ") i += 1;
  if (text[i] === "<") {
    const close = text.indexOf(">", i);
    return close === -1 ? { dest: null, end: i + 1 } : { dest: text.slice(i + 1, close), end: close + 1 };
  }
  let depth = 0;
  const begin = i;
  for (; i < text.length; i += 1) {
    const char = text[i];
    if (char === " " || char === "\t") break;
    if (char === "(") depth += 1;
    if (char === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return { dest: text[i] === ")" || text[i] === " " ? text.slice(begin, i) || null : null, end: i };
}

// GitHub's heading slug: inline markup dropped, lower case, anything but
// letters, numbers, marks, spaces, `-` and `_` removed, spaces to `-`; a
// repeated slug gets `-1`, `-2`…
function slugOf(text) {
  return withoutLinkTargets(text)
    .replace(/[`*]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

// `[text](target)` → `text`, in one forward pass (cached next `]` and `)`).
function withoutLinkTargets(text) {
  let out = "";
  let nextParen = -2;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "]" || text[i + 1] !== "(") {
      out += text[i] === "[" ? "" : text[i];
      continue;
    }
    if (nextParen !== -1 && nextParen < i) nextParen = text.indexOf(")", i);
    if (nextParen === -1) {
      out += text[i];
      continue;
    }
    i = nextParen;
  }
  return out;
}

// The text of an ATX heading (`## Title ##`), or of a setext one (a prose line
// underlined by `===` / `---`); null for any other line.
function headingText(line, next) {
  if (isHeading(line)) {
    let text = line.trimStart().replace(/^#+/, "").trim();
    let end = text.length;
    while (end > 0 && text[end - 1] === "#") end -= 1;
    if (end < text.length && (end === 0 || text[end - 1] === " " || text[end - 1] === "\t")) text = text.slice(0, end).trim();
    return text;
  }
  if (next !== undefined && line.trim() && /^ {0,3}(=+|-+)[ \t]*$/.test(next) && !isListItem(line)) return line.trim();
  return null;
}

// Every anchor a page offers: its heading slugs and the HTML `id` / `name`
// attributes of its prose.
function anchorsOf(text) {
  const lines = text.split(/\r?\n/);
  const kinds = classifyLines(lines);
  const anchors = new Set();
  const seen = new Map();

  lines.forEach((line, index) => {
    if (kinds[index].kind !== "prose") return;
    const next = kinds[index + 1] && kinds[index + 1].kind === "prose" ? lines[index + 1] : undefined;
    const heading = headingText(line, next);
    if (heading !== null) {
      const slug = slugOf(heading);
      const count = seen.get(slug) || 0;
      seen.set(slug, count + 1);
      anchors.add(count === 0 ? slug : `${slug}-${count}`);
    }
    for (const match of line.matchAll(/\b(?:id|name)="([^"]{1,200})"/g)) anchors.add(match[1]);
  });

  return anchors;
}

module.exports = { classifyLines, inlineParts, linkTargets, anchorsOf, slugOf, SHELL_INFOS };
