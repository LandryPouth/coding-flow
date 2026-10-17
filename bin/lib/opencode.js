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
const { spawnSync } = require("child_process");
const path = require("path");

const { cwd, packageJson } = require("./context");
const { guardBinaryPath, isSelfInstall } = require("./settings");

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
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

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
    return [{ tool_name: "Bash", tool_input: { command: typeof a.command === "string" ? a.command : null } }];
  }
  if (tool === "apply_patch" || tool === "patch") {
    const payloads = patchPayloads(a.patchText);
    // A patch we could not read a single file out of is not "nothing to check".
    return payloads.length ? payloads : [{ tool_name: "Write", tool_input: { content: "" } }];
  }
  // Anything else goes to the guard under its own name: a tool with a path that
  // the guard does not know is reported as unchecked. Read tools stay out (no
  // process spawned per read when the guard runs as a fallback); the list is
  // the guard's own read-only set.
  if (/^(read|glob|grep|list|ls|webfetch|websearch|todowrite|todoread|skill|task|question|lsp|codesearch)$/i.test(tool)) {
    return [];
  }
  if (!["file_path", "path", "filePath", "notebook_path"].some((field) => a[field])) {
    return [];
  }
  return [{ tool_name: tool, tool_input: a }];
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

// "NOT checked" has to be visible: on stderr now, and in the project's
// \`guard-unchecked.jsonl\` (which \`ai-flow report\` and \`doctor\` read) when it is a
// Coding Flow project. Never throws.
function noteUnchecked(hook, reason) {
  process.stderr.write(\`coding-flow guard: \${reason}; this write was NOT checked\\n\`);
  try {
    if (local && typeof local.recordUnchecked === "function") {
      local.recordUnchecked({ root: hook.cwd, hook, result: { reason } });
    } else if (existsSync(hook.cwd + "/.coding-flow")) {
      // Bounded like the guard's own writer: a guard that stays broken must not grow the log forever.
      const log = hook.cwd + "/.coding-flow/guard-unchecked.jsonl";
      if (existsSync(log) && statSync(log).size > 256 * 1024) {
        const kept = readFileSync(log, "utf8").split("\\n").filter(Boolean).slice(-200);
        writeFileSync(log, kept.length ? kept.join("\\n") + "\\n" : "");
      }
      appendFileSync(
        log,
        JSON.stringify({ at: new Date().toISOString(), tool: hook.tool_name || null, path: null, reason }) + "\\n",
      );
    }
  } catch {}
}

// \`mode: strict\` in harness.json makes "not checked" a refusal. Read here, not asked
// of the guard: the case that matters is the guard failing to load or run. An
// unreadable file is the standard posture, and says so. OpenCode's \`directory\` is
// where it was started, which can be below the project root: every enclosing
// harness.json is read (the guard's own roots climb too), and any strict one wins.
function isStrict(directory) {
  for (let dir = resolve(directory); ; dir = dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(join(dir, ".coding-flow", "harness.json"), "utf8").replace(/^\\uFEFF/, "")).mode === "strict") {
        return true;
      }
    } catch (err) {
      if (err && err.code !== "ENOENT" && err.code !== "ENOTDIR") {
        process.stderr.write("coding-flow guard: harness.json could not be read; standard mode applies\\n");
      }
    }
    if (dirname(dir) === dir) {
      return false;
    }
  }
}

// Strictness alone never refuses a write to the policy file itself: the user must
// be able to switch back. Blocked-path rules still apply (the guard judges those).
function isPolicyWrite(hook) {
  const file = hook.tool_input && (hook.tool_input.file_path || hook.tool_input.path);
  return (hook.tool_name === "Write" || hook.tool_name === "Edit") &&
    typeof file === "string" && /(^|[\\\\/])\\.coding-flow[\\\\/]harness\\.json$/.test(file);
}

function spawnGuard(payload) {
  const [cmd, args] =
    BINARY && existsSync(BINARY) ? ["node", [BINARY, "guard"]] : ["npx", ["--yes", FALLBACK, "guard"]];
  const res = spawnSync(cmd, args, { input: JSON.stringify(payload), encoding: "utf8", timeout: 60000 });

  if (res.error) {
    // Cannot enforce: say so where it can be seen instead of allowing silently.
    noteUnchecked(payload, \`could not run (\${res.error.code || res.error.message})\`);
    return { decision: "unchecked", reason: \`could not run (\${res.error.code || res.error.message})\` };
  }

  if (res.status === 0 && /this write was NOT checked/.test(res.stderr || "")) {
    process.stderr.write(res.stderr);
  }

  if (res.status === 2) {
    return { decision: "deny", reason: (res.stderr || "").replace(/^coding-flow guard: /, "").trim() };
  }

  if (res.status === 0) {
    return null;
  }

  // Neither a clean allow nor a refusal (a crash, a signal, an npx that could not
  // fetch the package): no decision, and the guard logged nothing — say so here.
  const reason = \`the guard gave no decision (\${res.signal ? "signal " + res.signal : "exit " + res.status})\`;
  noteUnchecked(payload, reason);
  return { decision: "unchecked", reason };
}

// Not a named export: 1.x loads \`default.server\` (checked on 1.19.0), and a
// module exporting the same plugin twice would be registered twice.
const CodingFlowGuard = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    for (const payload of toPayloads(input.tool, output.args)) {
      const hook = { ...payload, cwd: directory };
      // Defensive: a generated plugin always carries FALLBACK; a hand-edited one may not.
      if (!local && !(BINARY && existsSync(BINARY)) && !FALLBACK) {
        noteUnchecked(hook, "no guard module to run");
        if (!isPolicyWrite(hook) && isStrict(directory)) {
          throw new Error("coding-flow guard: not checked, refused in strict mode: no guard module to run");
        }
        continue;
      }
      const result = local && typeof local.evaluate === "function" ? local.evaluate(hook, directory) : spawnGuard(hook);

      // Only an explicit deny blocks. A crash, a timeout or a missing binary is
      // fail-open (the write proceeds, the harness scan is the net) but never
      // silent: it is reported as unchecked.
      if (result && result.decision === "unchecked" && local) {
        process.stderr.write(\`coding-flow guard: \${result.reason}; this write was NOT checked\\n\`);
      }
      if (result && result.decision === "deny") {
        throw new Error(\`coding-flow guard: \${result.reason}\`);
      }
      // Strict: no decision is a refusal. (The in-process guard has already turned
      // its own unchecked into a deny; this covers the spawn that could not run.)
      if (result && result.decision === "unchecked" && !isPolicyWrite(hook) && isStrict(directory)) {
        throw new Error(\`coding-flow guard: not checked, refused in strict mode: \${result.reason}\`);
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

// In this package's own checkout the binary is found relative to the plugin file
// (`<root>/.opencode/plugins/` -> `<root>/bin/`), so no home path is written.
const SELF_BINARY = 'fileURLToPath(new URL("../../bin/ai-flow.js", import.meta.url))';
const SELF_IMPORT = 'import { createRequire } from "node:module";\nimport { fileURLToPath } from "node:url";';

function pluginSource({ self = false } = {}) {
  const binary = guardBinaryPath();
  const fallback = `${packageJson.name}@${packageJson.version}`;

  return (
    `${MARKER} v${packageJson.version} — generated by \`ai-flow init\`/\`upgrade\`; edit freely by removing this line\n` +
    (self ? PLUGIN_BODY.replace('import { createRequire } from "node:module";', () => SELF_IMPORT) : PLUGIN_BODY)
      .replace("__BINARY__", () => (self ? SELF_BINARY : JSON.stringify(binary)))
      .replace("__FALLBACK__", () => JSON.stringify(fallback))
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
  const next = pluginSource({ self: !file && isSelfInstall(root) });
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

  return { state: current === pluginSource({ self: !file && isSelfInstall(root) }) ? "current" : "stale", path: target, v2: pluginHasV2Entry(current) };
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
// some subcommands. Never throws. `found: false` only when the binary is absent
// (ENOENT); a binary that exits non-zero, hangs or prints nothing parseable is
// still found, with `major: null`. The version is read from stdout, then stderr.
function probeOpenCode() {
  const res = spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });

  if (res.error && res.error.code === "ENOENT") {
    return { found: false, major: null };
  }

  return { found: true, major: parseOpenCodeMajor(`${res.stdout || ""}\n${res.stderr || ""}`) };
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
