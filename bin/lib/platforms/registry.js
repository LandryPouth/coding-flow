"use strict";

// Platforms whose skills are rendered into the host's own command format (as
// opposed to Claude's .claude/skills and Codex's .codex/skills). Whether each one
// also gets a guard is a separate fact: see `guard` on the entry.

const gemini = require("./gemini");
const opencode = require("./opencode");
const antigravity = require("./antigravity");

const COMMAND_PLATFORMS = {
  gemini: { render: gemini.renderSkill, dir: gemini.GEMINI_COMMANDS_DIR },
  // OpenCode's guard is a plugin on `tool.execute.before` (bin/lib/opencode.js),
  // verified against the OpenCode binary: a throw refuses the call.
  // `renderCommand` adds the `/` menu entry OpenCode's TUI does not give skills.
  opencode: {
    render: opencode.renderSkill,
    renderCommand: opencode.renderCommand,
    dir: opencode.OPENCODE_SKILLS_DIR,
    commandDir: opencode.OPENCODE_SLASH_DIR,
    guard: "plugin",
  },
  antigravity: { render: antigravity.renderSkill, dir: antigravity.ANTIGRAVITY_SKILLS_DIR },
};

module.exports = { COMMAND_PLATFORMS };
