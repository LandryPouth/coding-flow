"use strict";

// Gemini CLI custom commands: TOML files under `.gemini/commands/coding-flow/`,
// invoked as `/coding-flow:<name>`. The format has a required `prompt` and an
// optional `description`, nothing else (ported from ai-learn's validated
// renderer). No `{{args}}` or `!{...}` is used: the body is plain instructions.

const { parseSkill, rewriteInvocations } = require("./skill-source");

const GEMINI_COMMANDS_DIR = ".gemini/commands/coding-flow";

// The escaping ai-learn arrived at by hitting real parser failures.
function escapeToml(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// A multi-line literal string takes the body verbatim — skills carry backslashes,
// which a basic multi-line string would read as escapes. Only a body holding the
// literal delimiter itself falls back to the escaped basic form.
function tomlBody(body) {
  const text = body.replace(/\s+$/, "");

  if (!text.includes("'''")) {
    return `'''\n${text}\n'''`;
  }

  return `"""\n${text.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}\n"""`;
}

function renderSkill(markdown) {
  const { name, description, body } = parseSkill(markdown);
  const prompt = rewriteInvocations(body, (n) => `/coding-flow:${n}`);

  return {
    relPath: `${GEMINI_COMMANDS_DIR}/${name}.toml`,
    content: `description = "${escapeToml(description)}"\nprompt = ${tomlBody(prompt)}\n`,
  };
}

module.exports = { GEMINI_COMMANDS_DIR, escapeToml, renderSkill };
