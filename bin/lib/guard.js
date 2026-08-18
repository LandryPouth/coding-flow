"use strict";

// `ai-flow guard`: the deterministic PreToolUse hook. Claude Code passes the tool
// call on stdin BEFORE the write; guard refuses it (exit 2 + "deny" decision) if
// the targeted file matches a blocked path in the harness policy, or if the
// written content contains a secret. This is the move from the *advisory*
// guardrail (harness check, after the fact) to the *in-code* guardrail (at the
// tool boundary, before the write).
//
// SCOPE, stated precisely, because a security control that is described as
// absolute stops being checked:
//
//   - Covered: the editing tools (Write/Edit/MultiEdit/NotebookEdit), and the
//     common shell write forms in a `Bash` call — redirections (`> .env`,
//     heredocs), `tee`, `sed -i`, `cp`/`mv`/`ln`/`install`, `dd of=`.
//   - NOT covered: a write performed inside an interpreter the guard cannot
//     read, e.g. `python -c "open('.env','w')…"`, a compiled binary, or a
//     script fetched and executed. Shell text is parsed, program semantics are
//     not.
//
// So: this makes the common leak paths impossible, not every leak path. The
// harness scan (`ai-flow harness check`) remains the after-the-fact net.
//
// Fail-open by design: empty/unreadable stdin, unrelated tool, or missing config
// ⇒ allow. A hook must never break a legitimate use; it only blocks on a
// deterministic and explicit match.

const fs = require("fs");
const path = require("path");

const {
  defaultHarnessConfig,
  getSecretPatterns,
  findSecretsInContent,
  isHeuristicAllowlisted,
} = require("./harness");
const { matchesPattern, isAllowedEnvExample, normalizePortable } = require("./util");

// Tools that write to disk through a structured file_path. The others (Read,
// Grep…) are not our business here: immediate allow.
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function readHookInput({ inputFile = null } = {}) {
  try {
    if (inputFile) {
      return fs.readFileSync(inputFile, "utf8");
    }
    // fd 0 = stdin. In a hook context, the input is always piped.
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseHookInput(raw) {
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Path targeted by the tool call, depending on the shape of tool_input.
function targetPath(toolInput) {
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  return toolInput.notebook_path || toolInput.file_path || null;
}

// Content that would be written, aggregated per tool (for the secret scan).
function writtenContent(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== "object") {
    return "";
  }

  if (toolName === "Write") {
    return typeof toolInput.content === "string" ? toolInput.content : "";
  }
  if (toolName === "Edit") {
    return typeof toolInput.new_string === "string" ? toolInput.new_string : "";
  }
  if (toolName === "NotebookEdit") {
    return typeof toolInput.new_source === "string" ? toolInput.new_source : "";
  }
  if (toolName === "MultiEdit" && Array.isArray(toolInput.edits)) {
    return toolInput.edits
      .map((edit) => (edit && typeof edit.new_string === "string" ? edit.new_string : ""))
      .join("\n");
  }
  return "";
}

// Loads the harness policy from the resolved root, without depending on the
// module's cwd (the hook provides its own cwd). Missing/corrupt config ⇒ defaults.
// A project that never ran `harness init` is still guarded.
function loadPolicy(root) {
  const defaults = defaultHarnessConfig();
  const configFile = path.join(root, ".coding-flow", "harness.json");

  let config = null;
  try {
    if (fs.existsSync(configFile)) {
      config = JSON.parse(fs.readFileSync(configFile, "utf8").replace(/^﻿/, ""));
    }
  } catch {
    config = null;
  }

  const pick = (key) =>
    config && Array.isArray(config[key]) ? config[key] : defaults[key];

  return {
    blockedPaths: pick("blockedPaths"),
    secretPatterns: pick("secretPatterns"),
    secretScanAllowlist: pick("secretScanAllowlist"),
  };
}

// --- shell write detection ------------------------------------------------
//
// Extracts the paths a shell command would WRITE to. Conservative: a target we
// fail to recognise is simply not checked (fail-open), never guessed at.

// Commands whose last non-flag argument is the destination.
const DESTINATION_LAST = new Set(["cp", "mv", "ln", "install", "rsync"]);

function unquote(token) {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

function tokenize(segment) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;

  while ((match = pattern.exec(segment)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3]);
  }

  return tokens;
}

// Not a file: flags, fd duplications, and the null sink.
function isCandidatePath(token) {
  if (!token || token.startsWith("-") || token.startsWith("&") || token.startsWith("$")) {
    return false;
  }

  return token !== "/dev/null" && !token.startsWith("/dev/");
}

function shellWriteTargets(command) {
  if (typeof command !== "string" || !command.trim()) {
    return [];
  }

  const targets = new Set();

  // Redirections: `> file`, `>> file`, `2> file`. `2>&1` and `>&2` duplicate a
  // descriptor and write to no path — the (?!&) drops them.
  const redirection = /(?:^|[\s;&|(])\d?>{1,2}\s*(?!&)("[^"]+"|'[^']+'|[^\s;&|<>()]+)/g;
  let match;

  while ((match = redirection.exec(command)) !== null) {
    const value = unquote(match[1]);
    if (isCandidatePath(value)) {
      targets.add(value);
    }
  }

  // Command-specific destinations, per pipeline segment.
  for (const segment of command.split(/\|\||&&|[;|\n]/)) {
    const tokens = tokenize(segment.trim());

    if (tokens.length === 0) {
      continue;
    }

    // `sudo cp …`, `env FOO=1 tee …`: step over the wrapper to reach the verb.
    let index = 0;
    while (index < tokens.length && (tokens[index] === "sudo" || tokens[index].includes("="))) {
      index += 1;
    }

    const name = path.basename(tokens[index] || "");
    const args = tokens.slice(index + 1);
    const files = args.filter(isCandidatePath);

    if (name === "tee") {
      for (const file of files) {
        targets.add(file);
      }
    } else if (name === "sed" && args.some((arg) => arg === "-i" || arg.startsWith("-i"))) {
      // sed -i '<script>' <files…>: the script is the first non-flag argument.
      for (const file of files.slice(1)) {
        targets.add(file);
      }
    } else if (DESTINATION_LAST.has(name) && files.length >= 2) {
      targets.add(files[files.length - 1]);
    } else if (name === "dd") {
      for (const arg of args) {
        if (arg.startsWith("of=")) {
          targets.add(arg.slice(3));
        }
      }
    }
  }

  return [...targets];
}

// Whether writing to this path is refused by policy. Returns the matched pattern,
// or null.
function blockedPathHit(relative, policy) {
  if (isAllowedEnvExample(relative)) {
    return null;
  }

  return policy.blockedPaths.find((pattern) => matchesPattern(relative, pattern)) || null;
}

function toRelative(root, filePath) {
  return normalizePortable(path.relative(root, path.resolve(root, filePath)));
}

// Pure decision: from the hook input + root, returns allow/deny + reason.
function decide(hook, root) {
  if (!hook || typeof hook !== "object") {
    return { decision: "allow", reason: "no parseable hook input" };
  }

  const toolName = hook.tool_name;
  const toolInput = hook.tool_input;

  if (toolName === "Bash") {
    return decideBash(toolInput, root);
  }

  if (!WRITE_TOOLS.has(toolName)) {
    return { decision: "allow", reason: `tool ${toolName || "?"} is not a write tool` };
  }

  const policy = loadPolicy(root);
  const filePath = targetPath(toolInput);
  const relative = filePath ? toRelative(root, filePath) : null;

  // Check 1 — path blocked by the policy.
  if (relative) {
    const hit = blockedPathHit(relative, policy);

    if (hit) {
      return {
        decision: "deny",
        reason: `${relative} matches a blocked harness path (${hit}). Writing secrets or protected files at the tool boundary is refused by policy.`,
        path: relative,
      };
    }
  }

  // Check 2 — secret in the written content. On an allowlisted path (docs,
  // fixtures, story files) only the exact credential formats apply: a
  // placeholder in an example is not a leak, an AWS key in one still is.
  const content = writtenContent(toolName, toolInput);

  if (content) {
    const found = findSecretsInContent(content, getSecretPatterns(policy), {
      skipHeuristics: relative ? isHeuristicAllowlisted(relative, policy) : false,
      first: true,
    })[0];

    if (found) {
      return {
        decision: "deny",
        reason: `Potential secret detected in written content (${found.name}). Refused before it can reach the disk.`,
        path: relative,
      };
    }
  }

  return { decision: "allow", reason: "no blocked path or secret detected" };
}

// A shell call is checked on what it would WRITE, and on the credential formats
// visible in the command text. Heuristic patterns are not applied to a command
// line: `psql "password=…"` and `export TOKEN=$(…)` are normal, and a guard that
// cries wolf on them is a guard people route around.
function decideBash(toolInput, root) {
  const command = toolInput && typeof toolInput.command === "string" ? toolInput.command : "";

  if (!command.trim()) {
    return { decision: "allow", reason: "no command to inspect" };
  }

  const policy = loadPolicy(root);

  for (const target of shellWriteTargets(command)) {
    const relative = toRelative(root, target);
    const hit = blockedPathHit(relative, policy);

    if (hit) {
      return {
        decision: "deny",
        reason:
          `this command writes to ${relative}, which matches a blocked harness path (${hit}). ` +
          "Shell redirection is not a way around the policy.",
        path: relative,
      };
    }
  }

  const found = findSecretsInContent(command, getSecretPatterns(policy), {
    skipHeuristics: true,
    first: true,
  })[0];

  if (found) {
    return {
      decision: "deny",
      reason: `Potential secret detected in the command itself (${found.name}). Refused before it can reach the disk.`,
      path: null,
    };
  }

  return { decision: "allow", reason: "no blocked write target or secret detected" };
}

// A denial used to be exit 2 and a line on stderr, and then nothing. That is
// the one event most worth keeping: when the guard is *wrong*, the person it
// blocked has no artifact to send and no way to show what happened — and a gate
// nobody can argue with is a gate they turn off. One JSONL line per denial, read
// back by `ai-flow report`.
//
// Three properties this must never lose, because it runs inside the hot path of
// a security check: it never throws (a full disk must not turn a deny into a
// crash), it never delays the decision (the write already happened by the time
// we exit), and it never records the secret itself — `decide` reports the
// pattern's name, never the matched text.
const DENIAL_LOG_MAX_BYTES = 256 * 1024;

function recordDenial({ root, hook, result }) {
  try {
    const dir = path.join(root, ".coding-flow");

    if (!fs.existsSync(dir)) {
      return;
    }

    const logPath = path.join(dir, "denials.jsonl");

    // Bounded on purpose: this is a diagnostic tail, not an audit ledger. The
    // audit ledger is `ai-flow audit`, and it is opt-in.
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > DENIAL_LOG_MAX_BYTES) {
      const kept = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).slice(-200);
      fs.writeFileSync(logPath, kept.length ? `${kept.join("\n")}\n` : "");
    }

    const target = result.path || (hook && hook.tool_input && hook.tool_input.file_path) || null;

    fs.appendFileSync(
      logPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        tool: (hook && hook.tool_name) || null,
        // Relative when it is inside the project, so the log carries no home
        // directory and no username. `report` redacts anything left over.
        path: target ? normalizePortable(path.isAbsolute(target) ? path.relative(root, target) : target) : null,
        reason: result.reason,
      })}\n`,
    );
  } catch {
    // Diagnostics are never worth failing a security decision over.
  }
}

function guardCommand({ getFlagValue, flags }) {
  const inputFile = getFlagValue("--input", null);
  const raw = readHookInput({ inputFile });
  const hook = parseHookInput(raw);
  // Root: cwd provided by the hook if present, otherwise the process cwd.
  const root = hook && typeof hook.cwd === "string" && hook.cwd ? hook.cwd : process.cwd();

  const result = decide(hook, root);

  if (result.decision === "deny") {
    // Hook decision (stdout) + blocking message (stderr) + exit 2: we cover both
    // documented paths to stay robust across Claude Code versions.
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
        },
        systemMessage: result.reason,
      })}\n`,
    );
    process.stderr.write(`coding-flow guard: ${result.reason}\n`);
    recordDenial({ root, hook, result });
    process.exit(2);
  }

  if (flags.has("--json")) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
        reason: result.reason,
      })}\n`,
    );
  }

  process.exit(0);
}

module.exports = { guardCommand, decide, shellWriteTargets };
