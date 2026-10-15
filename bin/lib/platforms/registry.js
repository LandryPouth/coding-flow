"use strict";

// Platforms that get commands but no guard: no write-blocking mechanism has been
// verified on any of them, so they ship `enforcementTier: "commands-only"` and
// say so (doctor, report) instead of implying protection.

const gemini = require("./gemini");
const opencode = require("./opencode");
const antigravity = require("./antigravity");

const COMMANDS_ONLY_PLATFORMS = {
  gemini: { render: gemini.renderSkill, dir: gemini.GEMINI_COMMANDS_DIR },
  opencode: { render: opencode.renderSkill, dir: opencode.OPENCODE_COMMANDS_DIR },
  antigravity: { render: antigravity.renderSkill, dir: antigravity.ANTIGRAVITY_SKILLS_DIR },
};

module.exports = { COMMANDS_ONLY_PLATFORMS };
