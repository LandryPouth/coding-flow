"use strict";

// Where a story's content lives. The three-file split (spec / plan / tasks) earns
// itself on a story worth a day: three authors, three review moments, three things
// that change at different times. On a copy change it is three files to create,
// three to re-read on every later turn, and two to update at the end — to record
// that a heading changed.
//
// So a QUICK story is one `story.md` holding the same sections, and everything
// downstream asks for a ROLE rather than a filename. A dedicated file wins when it
// exists; `story.md` answers otherwise. Three-file stories behave exactly as before
// — this adds a fallback, it changes no existing resolution.

const fs = require("fs");
const path = require("path");

const PART_FILES = {
  spec: "spec.md",
  plan: "plan.md",
  tasks: "tasks.md",
};

const SINGLE_FILE = "story.md";

const STORY_FILES = [...Object.values(PART_FILES), SINGLE_FILE];

// The file that answers for `part`. When neither the dedicated file nor story.md
// exists, this returns the dedicated path on purpose: callers use it to say what
// is missing, and "spec.md is required" is a more useful message than a path that
// was never going to be there either.
function storyPartPath(storyDir, part) {
  const dedicated = path.join(storyDir, PART_FILES[part]);

  if (fs.existsSync(dedicated)) {
    return dedicated;
  }

  const single = path.join(storyDir, SINGLE_FILE);

  return fs.existsSync(single) ? single : dedicated;
}

function readStoryPart(storyDir, part) {
  const filePath = storyPartPath(storyDir, part);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

// True when the directory holds story content in either shape. Used where the tool
// asked "does spec.md exist" purely to mean "is this a real story".
function hasStoryContent(storyDir) {
  return STORY_FILES.some((name) => fs.existsSync(path.join(storyDir, name)));
}

module.exports = {
  PART_FILES,
  SINGLE_FILE,
  STORY_FILES,
  storyPartPath,
  readStoryPart,
  hasStoryContent,
};
