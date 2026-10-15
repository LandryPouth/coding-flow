"use strict";

// The shared source of every rendered flavor: a coding-flow skill is
// `---\nname: x\ndescription: y\n---\nbody`. Gemini, OpenCode and Antigravity
// each re-render these three parts into their own format, so the split lives in
// one place. The frontmatter is flat by design, so no YAML parser is needed.

function parseSkill(markdown) {
  const match = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    throw new Error("skill is missing its frontmatter");
  }

  const field = (key) => {
    const line = match[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    const value = line ? line.slice(key.length + 1).trim() : "";

    // Tolerate a source that already quotes its value, undoing the escapes the
    // renderers will apply again (otherwise `\"` would be escaped twice).
    return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).replace(/\\(["\\])/g, "$1")
      : value;
  };

  return { name: field("name"), description: field("description"), body: match[2].replace(/^\n+/, "") };
}

// Skills name each other as `/flow-x` (Claude's invocation). `invoke` rewrites
// that to the host's own form, and never touches a path like `a/flow-x`.
function rewriteInvocations(body, invoke) {
  return body.replace(/(^|[^\w/.:$-])\/(flow-[a-z]+)/g, (_, lead, name) => `${lead}${invoke(name)}`);
}

// Backslashes first, then quotes: the same order as the TOML escaper.
function escapeYamlDoubleQuoted(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

module.exports = { parseSkill, rewriteInvocations, escapeYamlDoubleQuoted };
