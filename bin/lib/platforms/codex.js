"use strict";

// Codex CLI flavor of the coding-flow commands.
//
// Codex has no `.codex/prompts/` for this: custom prompts are gone from current
// builds (0.138 ships none), and what Codex discovers instead is a skill — a
// directory holding a SKILL.md with `name`/`description` frontmatter, the exact
// shape coding-flow's own skills already have. So each Claude skill is rendered
// as `.codex/skills/<name>/SKILL.md`, adapted rather than copied: Codex invokes
// a skill as `$name`, not `/name`, and the skills must not point at `.claude/`.

const CODEX_SKILLS_DIR = ".codex/skills";

function renderSkill(markdown) {
  return String(markdown)
    .replace(/(^|[^\w/.:$-])\/(flow-[a-z]+)/g, "$1$$$2")
    .replace(/\.claude\/skills/g, CODEX_SKILLS_DIR);
}

module.exports = { CODEX_SKILLS_DIR, renderSkill };
