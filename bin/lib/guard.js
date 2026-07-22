"use strict";

// `ai-flow guard`: the deterministic PreToolUse hook. Claude Code passes the tool
// call on stdin BEFORE the write; guard refuses it (exit 2 + "deny" decision) if
// the targeted file matches a blocked path in the harness policy, or if the
// written content contains a secret. This is the move from the *advisory*
// guardrail (harness check, after the fact) to the *in-code* guardrail (at the
// tool boundary, before the write): a secret CANNOT leak, we no longer merely
// hope it won't.
//
// Fail-open by design: empty/unreadable stdin, non-write tool, or missing config
// ⇒ allow. A hook must never break a legitimate use; it only blocks on a
// deterministic and explicit match.

const fs = require("fs");
const path = require("path");

const { defaultHarnessConfig, getSecretPatterns } = require("./harness");
const { matchesPattern, isAllowedEnvExample, normalizePortable } = require("./util");

// Tools that write to disk. The others (Read, Bash, Grep…) are not our business
// here: immediate allow.
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

  const blockedPaths =
    config && Array.isArray(config.blockedPaths) ? config.blockedPaths : defaults.blockedPaths;

  return { blockedPaths };
}

// Pure decision: from the hook input + root, returns allow/deny + reason.
function decide(hook, root) {
  if (!hook || typeof hook !== "object") {
    return { decision: "allow", reason: "no parseable hook input" };
  }

  const toolName = hook.tool_name;

  if (!WRITE_TOOLS.has(toolName)) {
    return { decision: "allow", reason: `tool ${toolName || "?"} is not a write tool` };
  }

  const toolInput = hook.tool_input;
  const filePath = targetPath(toolInput);

  // Check 1 — path blocked by the policy.
  if (filePath) {
    const relative = normalizePortable(path.relative(root, path.resolve(root, filePath)));

    if (!isAllowedEnvExample(relative)) {
      const { blockedPaths } = loadPolicy(root);
      const hit = blockedPaths.find((pattern) => matchesPattern(relative, pattern));

      if (hit) {
        return {
          decision: "deny",
          reason: `${relative} matches a blocked harness path (${hit}). Writing secrets or protected files at the tool boundary is refused by policy.`,
          path: relative,
        };
      }
    }
  }

  // Check 2 — secret in the written content.
  const content = writtenContent(toolName, toolInput);

  if (content) {
    const patterns = getSecretPatterns();
    const line = content.split(/\r?\n/).find((row) => patterns.some((p) => p.regex.test(row)));

    if (line) {
      const match = patterns.find((p) => p.regex.test(line));
      return {
        decision: "deny",
        reason: `Potential secret detected in written content (${match.name}). Refused before it can reach the disk.`,
        path: filePath ? normalizePortable(path.relative(root, path.resolve(root, filePath))) : null,
      };
    }
  }

  return { decision: "allow", reason: "no blocked path or secret detected" };
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

module.exports = { guardCommand, decide };
