"use strict";

// OpenCode custom commands: markdown with `description` frontmatter under
// `.opencode/command/coding-flow/`, invoked as `/coding-flow/<name>`.

const { parseSkill, rewriteInvocations, escapeYamlDoubleQuoted } = require("./skill-source");

const OPENCODE_COMMANDS_DIR = ".opencode/command/coding-flow";

function renderSkill(markdown) {
  const { name, description, body } = parseSkill(markdown);
  const template = rewriteInvocations(body, (n) => `/coding-flow/${n}`).replace(/\.claude\/skills/g, OPENCODE_COMMANDS_DIR);

  return {
    relPath: `${OPENCODE_COMMANDS_DIR}/${name}.md`,
    content: `---\ndescription: "${escapeYamlDoubleQuoted(description)}"\n---\n\n${template}`,
  };
}

module.exports = { OPENCODE_COMMANDS_DIR, renderSkill };
