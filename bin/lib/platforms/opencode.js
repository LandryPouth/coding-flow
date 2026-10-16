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
// Skills alone are not enough for a person, though: OpenCode's TUI leaves every
// skill out of the `/` autocomplete (it lists them only under `/skills`), so a
// user typing `/flow` saw "No matching items". Each skill therefore also gets a
// one-paragraph command of the same name under `.opencode/commands/`, which
// shows in the `/` menu and hands over to the skill. The command does not copy
// the skill body: a command template is expanded by OpenCode (`!\`…\`` runs a
// shell command, `@path` attaches a file) and the skill text is full of both
// shapes. Same name on purpose: a command shadows the skill only in the command
// list; the model still sees and loads the skill.
//
// When the project already carries the Claude copy (`.claude/skills/flow-*`),
// OpenCode reads those and nothing is rendered here: one skill set serves both
// agents (see `servedByClaude`). Two copies would only make OpenCode warn
// "duplicate skill name" and keep one of them.

const fs = require("fs");
const path = require("path");

const { parseSkill, escapeYamlDoubleQuoted } = require("./skill-source");

const OPENCODE_SKILLS_DIR = ".opencode/skills";
// `commands`, not `command`: the singular is where 0.11 wrote full commands, and
// upgrade retires everything it recorded there.
const OPENCODE_SLASH_DIR = ".opencode/commands";
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

function renderCommand(markdown) {
  const { name, description } = parseSkill(markdown);

  return {
    relPath: `${OPENCODE_SLASH_DIR}/${name}.md`,
    content:
      `---\ndescription: "${escapeYamlDoubleQuoted(description)}"\n---\n\n` +
      `Load the ${name} skill with your skill tool and follow it for this request.\n\n$ARGUMENTS\n`,
  };
}

// True when every skill already sits in `.claude/skills/` (a Claude install with
// project skills): OpenCode loads them from there.
function servedByClaude(root, names) {
  return names.length > 0 && names.every((name) => fs.existsSync(path.join(root, ".claude", "skills", name, "SKILL.md")));
}

module.exports = { OPENCODE_SKILLS_DIR, OPENCODE_COMMANDS_DIR, OPENCODE_SLASH_DIR, renderSkill, renderCommand, servedByClaude };
