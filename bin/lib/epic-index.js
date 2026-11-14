"use strict";

// `epics/INDEX.md`: the one file that remembers every epic once its directory
// has left the checkout (epic 17). This module owns its archived section, which
// is append-only — nothing on disk could regenerate it. Each entry's heading
// carries `<!-- coding-flow:archived NN slug -->`, the marker idempotence and
// numbering (story 17-03) read back. A hand-written INDEX.md is never rewritten:
// the section is appended after whatever is already there.

const fs = require("fs");
const path = require("path");

const INDEX_FILE = path.join("epics", "INDEX.md");
const SECTION_MARKER = "<!-- coding-flow:archived-section -->";
const ENTRY_MARKER = /<!-- coding-flow:archived (\d+) ([^\s]+) -->/g;

const SECTION_HEADER = [
  "## Archived epics",
  "",
  SECTION_MARKER,
  "",
  "Written by `ai-flow archive`, append-only. Each entry names the commit where",
  "the epic's text still exists and the command that brings it back.",
  "",
].join("\n");

function indexPath(root) {
  return path.join(root, INDEX_FILE);
}

function readIndex(root) {
  const file = indexPath(root);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

// Every archived entry as { number, slug }, in file order.
function archivedEpics(root) {
  const text = readIndex(root) || "";
  return [...text.matchAll(ENTRY_MARKER)].map((match) => ({ number: match[1], slug: match[2] }));
}

// The file content once `entry` (Markdown) is appended to the archived section,
// creating the file or the section when missing. Pure: the caller writes.
function withArchivedEntry(existing, entry) {
  if (existing === null) {
    return `# Epics\n\n${SECTION_HEADER}\n${entry}`;
  }

  const base = existing.endsWith("\n") ? existing : `${existing}\n`;

  if (base.includes(SECTION_MARKER)) {
    return `${base}\n${entry}`;
  }

  return `${base}\n${SECTION_HEADER}\n${entry}`;
}

module.exports = { INDEX_FILE, indexPath, readIndex, archivedEpics, withArchivedEntry };
