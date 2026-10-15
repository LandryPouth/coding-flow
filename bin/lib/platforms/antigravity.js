"use strict";

// Antigravity skills: `<name>/SKILL.md` with `name` + `description` frontmatter,
// matched implicitly by description rather than typed as a slash command. The
// workspace location is `.agent/skills/`.
//
// The description is always double-quoted: a bare `:` mid-value breaks YAML
// frontmatter, which is the real bug ai-learn hit on this very renderer.

const { parseSkill, rewriteInvocations, escapeYamlDoubleQuoted } = require("./skill-source");

const ANTIGRAVITY_SKILLS_DIR = ".agent/skills";

function renderSkill(markdown) {
  const { name, description, body } = parseSkill(markdown);
  const text = rewriteInvocations(body, (n) => n);

  return {
    relPath: `${ANTIGRAVITY_SKILLS_DIR}/${name}/SKILL.md`,
    content: `---\nname: ${name}\ndescription: "${escapeYamlDoubleQuoted(description)}"\n---\n\n${text}`,
  };
}

module.exports = { ANTIGRAVITY_SKILLS_DIR, renderSkill };
