"use strict";

// Wiring of the `guard` into OpenCode. Claude Code runs a shell hook declared in
// .claude/settings.json; OpenCode has no such file — it loads TypeScript/JS
// plugins from .opencode/plugins/ and exposes `tool.execute.before`, where a
// `throw` refuses the call. So the wiring is a small plugin that does only one
// thing: translate an OpenCode tool call into the PreToolUse payload the guard
// already understands, run `ai-flow guard`, and throw on its exit 2. `decide`
// itself is untouched — it stays the single part under test.
//
// Same contract as settings.js: the plugin runs the LOCALLY-RESOLVED binary
// (no npx on every write) and falls back to a version-pinned npx when that path
// is gone; it is fail-open on anything but an explicit deny, because a guard
// that breaks legitimate use gets turned off; and `ensure` is idempotent and
// never overwrites a file we did not write.

const fs = require("fs");
const path = require("path");

const { cwd, packageJson } = require("./context");
const { guardBinaryPath } = require("./settings");

const PLUGIN_RELATIVE = path.join(".opencode", "plugins", "coding-flow-guard.js");

// First line of the file, and how we recognise it as ours. A plugin carrying
// this marker is regenerated freely; one without it is the user's and is left
// alone — same rule as a customised matcher in settings.json.
const MARKER = "// coding-flow:guard-plugin";

// OpenCode tool name -> the Claude-shaped payload `decide` reads. `edit`'s
// `oldString`/`newString` and `write`'s `content` are what a secret can ride in;
// `bash` is checked on the command text and its write targets, like Claude's.
const PLUGIN_BODY = `
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const BINARY = __BINARY__;
const FALLBACK = __FALLBACK__;

// \`apply_patch\` is how GPT-family models edit in OpenCode: one patchText, many
// files. Each file section becomes one Write-shaped payload carrying the lines
// the patch ADDS (the only text that can introduce a secret), plus a bare path
// check for the destination of a \`Move to\`. Deleting a file writes nothing.
function patchPayloads(patchText) {
  const out = [];
  let current = null;
  // CRLF too: \`.\` stops at \\r, so a CRLF header would match nothing and allow.
  for (const line of String(patchText || "").split(/\\r?\\n/)) {
    const file = line.match(/^\\*\\*\\* (?:Add|Update) File: (.+)$/);
    const move = line.match(/^\\*\\*\\* Move to: (.+)$/);
    if (file) {
      current = { tool_name: "Write", tool_input: { file_path: file[1].trim(), content: "" } };
      out.push(current);
    } else if (move) {
      out.push({ tool_name: "Write", tool_input: { file_path: move[1].trim(), content: "" } });
      current = null;
    } else if (/^\\*\\*\\* /.test(line)) {
      current = null;
    } else if (current && line.startsWith("+")) {
      current.tool_input.content += line.slice(1) + "\\n";
    }
  }
  return out;
}

function toPayloads(tool, args) {
  const a = args || {};
  if (tool === "write") {
    return [{ tool_name: "Write", tool_input: { file_path: a.filePath || a.path, content: a.content } }];
  }
  if (tool === "edit") {
    return [{ tool_name: "Edit", tool_input: { file_path: a.filePath || a.path, new_string: a.newString } }];
  }
  if (tool === "bash" || tool === "shell") {
    return [{ tool_name: "Bash", tool_input: { command: a.command } }];
  }
  if (tool === "apply_patch" || tool === "patch") {
    return patchPayloads(a.patchText);
  }
  return [];
}

// In-process first: OpenCode runs on Bun, which loads the guard's CommonJS
// directly — no \`node\` needed on OpenCode's PATH (an IDE or desktop launcher
// often has none, and a spawn that cannot find \`node\` would fail open in
// silence), and no process per write. The spawn is the fallback for a package
// that is no longer at BINARY (npx, pinned to the version that wrote this).
let local = null;
try {
  if (BINARY && existsSync(BINARY)) {
    local = createRequire(BINARY)("./lib/guard.js");
  }
} catch {
  local = null;
}

function spawnGuard(payload) {
  const [cmd, args] =
    BINARY && existsSync(BINARY) ? ["node", [BINARY, "guard"]] : ["npx", ["--yes", FALLBACK, "guard"]];
  const res = spawnSync(cmd, args, { input: JSON.stringify(payload), encoding: "utf8", timeout: 60000 });

  if (res.error) {
    // Cannot enforce: say so where it can be seen instead of allowing silently.
    process.stderr.write(\`coding-flow guard: could not run (\${res.error.code || res.error.message}); this write was NOT checked\\n\`);
  }

  return res.status === 2 ? { decision: "deny", reason: (res.stderr || "").replace(/^coding-flow guard: /, "").trim() } : null;
}

// Not a named export: 1.x loads \`default.server\` (checked on 1.19.0), and a
// module exporting the same plugin twice would be registered twice.
const CodingFlowGuard = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    for (const payload of toPayloads(input.tool, output.args)) {
      const hook = { ...payload, cwd: directory };
      const result = local && typeof local.evaluate === "function" ? local.evaluate(hook, directory) : spawnGuard(hook);

      // Only an explicit deny blocks. A crash, a timeout or a missing binary is
      // fail-open: the write proceeds and the harness scan is the net.
      if (result && result.decision === "deny") {
        throw new Error(\`coding-flow guard: \${result.reason}\`);
      }
    }
  },
});

// OpenCode 2.x loads a default export \`{ id, server, setup }\`; \`setup\` registers
// the same check on its own hook. 1.x also calls \`setup\`, with a partial
// context and no \`ctx.tool\`: return early, or 1.x fails the whole plugin.
async function setup(ctx) {
  if (!ctx || !ctx.tool || typeof ctx.tool.hook !== "function") return;
  const directory = (ctx.location && ctx.location.directory) || process.cwd();
  const hooks = await CodingFlowGuard({ directory });
  await ctx.tool.hook("execute.before", (event) =>
    hooks["tool.execute.before"]({ tool: event.tool }, { args: event.input }));
}

export default { id: "coding-flow.guard", server: CodingFlowGuard, setup };
`;

function pluginPath(root = cwd) {
  return path.join(root, PLUGIN_RELATIVE);
}

function pluginSource() {
  const binary = guardBinaryPath();
  const fallback = `${packageJson.name}@${packageJson.version}`;

  return (
    `${MARKER} v${packageJson.version} — generated by \`ai-flow init\`/\`upgrade\`; edit freely by removing this line\n` +
    PLUGIN_BODY.replace("__BINARY__", () => JSON.stringify(binary)).replace("__FALLBACK__", () => JSON.stringify(fallback))
  );
}

// OpenCode is "in use" when the project already carries its config or plugin
// directory. We never create `.opencode/` for someone who does not use it —
// `--opencode` is the explicit opt-in.
function usesOpenCode(root = cwd) {
  return ["opencode.json", "opencode.jsonc", ".opencode"].some((name) => fs.existsSync(path.join(root, name)));
}

function isOurs(source) {
  return typeof source === "string" && source.startsWith(MARKER);
}

// Statuses: "created", "upgraded" (ours, regenerated), "unchanged",
// "skipped" (a plugin at that path that is not ours — left untouched).
function ensureOpenCodePlugin({ dryRun = false, root = cwd, file = null } = {}) {
  const target = file || pluginPath(root);
  const next = pluginSource();
  const existed = fs.existsSync(target);

  if (existed) {
    const current = fs.readFileSync(target, "utf8");

    if (!isOurs(current)) {
      return { status: "skipped", path: target };
    }

    if (current === next) {
      return { status: "unchanged", path: target };
    }
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
  }

  return { status: existed ? "upgraded" : "created", path: target };
}

// The global install owns a plugin too: remove it only when it is still ours.
function removeOpenCodePlugin({ file, dryRun = false }) {
  if (!fs.existsSync(file)) {
    return { status: "absent" };
  }

  if (!isOurs(fs.readFileSync(file, "utf8"))) {
    return { status: "foreign" };
  }

  if (!dryRun) {
    fs.unlinkSync(file);
  }

  return { status: "removed" };
}

// What `doctor` reads back: present + ours + current. "absent" is only a
// problem when OpenCode is in use. `v2` says whether the file carries the
// OpenCode 2.x entry; a plugin written before 0.12.2 does not, and 2.x then
// loads nothing.
function inspectOpenCodePlugin(root = cwd, file = null) {
  const target = file || pluginPath(root);

  if (!fs.existsSync(target)) {
    return { state: "absent", path: target };
  }

  const current = fs.readFileSync(target, "utf8");

  if (!isOurs(current)) {
    return { state: "foreign", path: target };
  }

  return { state: current === pluginSource() ? "current" : "stale", path: target, v2: pluginHasV2Entry(current) };
}

// The stable token of the V2 default export, so callers never re-encode it.
function pluginHasV2Entry(source) {
  return typeof source === "string" && source.includes('id: "coding-flow.guard"');
}

// `2.0.30`, `opencode 2.0.30` and `v2.0.30` all parse; anything else is unknown
// (null), which callers treat as 1.x.
function parseOpenCodeMajor(output) {
  const match = String(output || "").match(/(?:^|\s)v?(\d+)\.\d+(?:\.\d+)?/);

  return match ? Number.parseInt(match[1], 10) : null;
}

// `--version` is the only invocation: 2.x auto-starts a background service for
// some subcommands. Never throws; `{ found: false }` when the binary is absent.
function probeOpenCode() {
  try {
    const out = require("child_process").execFileSync("opencode", ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });

    return { found: true, major: parseOpenCodeMajor(out) };
  } catch {
    return { found: false, major: null };
  }
}

module.exports = {
  ensureOpenCodePlugin,
  removeOpenCodePlugin,
  inspectOpenCodePlugin,
  pluginHasV2Entry,
  parseOpenCodeMajor,
  probeOpenCode,
  usesOpenCode,
  pluginSource,
  PLUGIN_RELATIVE,
  MARKER,
};
