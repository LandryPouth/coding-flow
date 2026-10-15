"use strict";

// OpenCode custom commands: markdown with `description` frontmatter directly
// under `.opencode/command/`, invoked as `/<name>`. Flat on purpose: OpenCode
// names a command after its path, so a `coding-flow/` subfolder would make it
// `/coding-flow/flow-run` and hide it from anyone typing `/flow-`.

const { parseSkill, rewriteInvocations, escapeYamlDoubleQuoted } = require("./skill-source");

const OPENCODE_COMMANDS_DIR = ".opencode/command";

function renderSkill(markdown) {
  const { name, description, body } = parseSkill(markdown);
  const template = rewriteInvocations(body, (n) => `/${n}`);

  return {
    relPath: `${OPENCODE_COMMANDS_DIR}/${name}.md`,
    content: `---\ndescription: "${escapeYamlDoubleQuoted(description)}"\n---\n\n${template}`,
  };
}

module.exports = { OPENCODE_COMMANDS_DIR, renderSkill };
