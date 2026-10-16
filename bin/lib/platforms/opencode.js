"use strict";

// OpenCode flavor of the coding-flow skills: a skill, not a command.
//
// OpenCode (checked on 1.19) discovers `SKILL.md` directories under
// `.opencode/skills/`, `~/.config/opencode/skills/`, and also `.claude/skills/`
// and `.agents/skills/` — and every skill it discovers is also invocable as
// `/<name>`. A skill is therefore strictly better than the `.opencode/command/`
// files this used to render: the model can pick `flow-run` up by its
// description ("implement X") exactly as Claude Code does, and `/flow-run` still
// works. The body is the Claude skill itself (only paths pointing at
// `.claude/skills` are rewritten); the frontmatter is re-emitted with a quoted
// description so it is valid YAML even when the text holds a ": ".
//
// When the project already carries the Claude copy (`.claude/skills/flow-*`),
// OpenCode reads those and nothing is rendered here: one skill set serves both
// agents (see `servedByClaude`). Two copies would only make OpenCode warn
// "duplicate skill name" and keep one of them.

const fs = require("fs");
const path = require("path");

const { parseSkill, escapeYamlDoubleQuoted } = require("./skill-source");

const OPENCODE_SKILLS_DIR = ".opencode/skills";
// Where earlier versions rendered commands. Kept so upgrade/uninstall can
// retire what they wrote.
const OPENCODE_COMMANDS_DIR = ".opencode/command";

function renderSkill(markdown) {
  const { name, description, body } = parseSkill(markdown);

  return {
    relPath: `${OPENCODE_SKILLS_DIR}/${name}/SKILL.md`,
    content:
      `---\nname: ${name}\ndescription: "${escapeYamlDoubleQuoted(description)}"\n---\n\n` +
      body.replace(/\.claude\/skills/g, OPENCODE_SKILLS_DIR),
  };
}

// True when every skill already sits in `.claude/skills/` (a Claude install with
// project skills): OpenCode loads them from there.
function servedByClaude(root, names) {
  return names.length > 0 && names.every((name) => fs.existsSync(path.join(root, ".claude", "skills", name, "SKILL.md")));
}

module.exports = { OPENCODE_SKILLS_DIR, OPENCODE_COMMANDS_DIR, renderSkill, servedByClaude };
