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
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

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

// Tools known to leave the disk alone, in Claude Code and OpenCode spellings. Any
// OTHER tool that carries a path is a write tool we have not met yet: the guard
// cannot judge it, and says so (`unchecked`) instead of waving it through.
const READ_ONLY_TOOLS = new Set(
  [
    "Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "TodoRead",
    "Skill", "SlashCommand", "AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "BashOutput",
    "KillShell", "KillBash", "ListMcpResourcesTool", "ReadMcpResourceTool", "ToolSearch", "Monitor",
    "read", "glob", "grep", "list", "ls", "webfetch", "websearch", "todowrite", "todoread", "skill",
    "task", "question", "lsp", "codesearch",
  ].map((name) => name.toLowerCase()),
);
const PATH_FIELDS = ["file_path", "path", "filePath", "notebook_path"];

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

const HOME_PREFIX = /^(?:\$HOME|\$\{HOME\})(?=\/|$)/;

// Not a file: flags, fd duplications, and the null sink.
function isCandidatePath(token) {
  if (!token || token.startsWith("-") || token.startsWith("&")) {
    return false;
  }

  // `$HOME/…` is a path; any other variable is not something we can resolve.
  if (token.startsWith("$") && !HOME_PREFIX.test(token)) {
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

// --- path resolution --------------------------------------------------------
//
// A write is judged on the file it will REACH, not on the string it was given:
// through a symlink, a `..`, a `~`, or an absolute path into the primary checkout.

const gitMemo = new Map();

function git(cwd, args) {
  const key = `${cwd}\0${args.join(" ")}`;
  if (!gitMemo.has(key)) {
    let out = null;
    try {
      out = execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      }).trim();
    } catch {
      out = null;
    }
    gitMemo.set(key, out || null);
  }
  return gitMemo.get(key);
}

// The OUTERMOST `.coding-flow/` between `cwd` and the git toplevel (so a nested
// one cannot swap in a weaker policy), else the git toplevel, else `cwd` itself.
function projectRoot(cwd) {
  const start = path.resolve(cwd);
  const top = git(start, ["rev-parse", "--show-toplevel"]);
  let found = null;

  for (let dir = start; ; dir = path.dirname(dir)) {
    try {
      if (fs.statSync(path.join(dir, ".coding-flow")).isDirectory()) {
        found = dir;
        if (!top) {
          break; // no repo to bound the search: nearest wins
        }
      }
    } catch {
      // not here
    }
    if (dir === top || path.dirname(dir) === dir) {
      break;
    }
  }

  return found || top || start;
}

// When `root` is a linked worktree (its `.git` is a file), the primary checkout.
function primaryCheckout(root) {
  try {
    if (!fs.statSync(path.join(root, ".git")).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

  return common && path.basename(common) === ".git" ? path.dirname(path.resolve(common)) : null;
}

// realpath of the target, or of its nearest existing ancestor plus the segments
// that do not exist yet (a file about to be created). A dangling link is followed
// to where it WOULD create the file — `alias -> .env` with no `.env` yet is `.env`.
// A loop falls back to the lexical path: never throws.
function realPathOf(file, depth = 0, issues = null) {
  const rest = [];
  let dir = file;

  for (;;) {
    try {
      return path.join(fs.realpathSync.native(dir), ...rest);
    } catch (err) {
      if (!err || (err.code !== "ENOENT" && err.code !== "ENOTDIR")) {
        if (issues) {
          issues.push(`could not resolve a path (${(err && err.code) || "error"})`);
        }
        return file;
      }

      try {
        if (fs.lstatSync(dir).isSymbolicLink()) {
          if (depth > 16) {
            if (issues) {
              issues.push("could not resolve a path (too many links)");
            }
            return file;
          }
          const target = path.resolve(path.dirname(dir), fs.readlinkSync(dir));
          return path.join(realPathOf(target, depth + 1, issues), ...rest);
        }
      } catch {
        // not a link either: keep walking up
      }

      const parent = path.dirname(dir);
      if (parent === dir) {
        return file;
      }
      rest.unshift(path.basename(dir));
      dir = parent;
    }
  }
}

function expandHome(target) {
  const home = os.homedir();
  if (target === "~" || target.startsWith("~/")) {
    return path.join(home, target.slice(1));
  }
  const match = HOME_PREFIX.exec(target);
  return match ? path.join(home, target.slice(match[0].length)) : target;
}

function within(base, file) {
  const rel = path.relative(base, file);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) ? rel : null;
}

// The policy-relative names a target answers to: lexical and real, each made
// relative to the project root, else to the primary checkout, else to $HOME.
function resolveTargets(ctx, target) {
  const lexical = path.resolve(ctx.cwd, expandHome(target));
  const real = realPathOf(lexical, 0, ctx.issues);
  const bases = [ctx.root, ctx.realRoot, ctx.primary, ctx.primary && realPathOf(ctx.primary), os.homedir()].filter(Boolean);
  const found = [];

  for (const file of [lexical, real]) {
    for (const base of bases) {
      const rel = within(base, file);
      if (rel !== null) {
        const relative = normalizePortable(rel);
        if (!found.some((entry) => entry.relative === relative)) {
          found.push({ relative });
        }
        break;
      }
    }
  }

  return found;
}

function hookCwd(hook, fallback) {
  return hook && typeof hook.cwd === "string" && hook.cwd ? hook.cwd : fallback;
}

function context(hook, root) {
  const cwd = hookCwd(hook, root);
  const top = projectRoot(cwd);
  return { cwd: path.resolve(cwd), root: top, realRoot: realPathOf(top), primary: primaryCheckout(top), issues: [] };
}

// Whether writing to this path is refused by policy. Returns the matched pattern,
// or null. On a case-insensitive filesystem `.ENV` is `.env`.
function blockedPathHit(relative, policy, caseInsensitive = false) {
  if (isAllowedEnvExample(relative)) {
    return null;
  }

  const fold = (value) => (caseInsensitive ? value.toLowerCase() : value);

  return policy.blockedPaths.find((pattern) => matchesPattern(fold(relative), fold(pattern))) || null;
}

// First blocked name among everything this target resolves to.
function firstHit(ctx, target, policy, caseInsensitive) {
  for (const entry of resolveTargets(ctx, target)) {
    const hit = blockedPathHit(entry.relative, policy, caseInsensitive);
    if (hit) {
      return { hit, relative: entry.relative };
    }
  }
  return null;
}

function viaNote(found, given) {
  const lexical = normalizePortable(given);
  return lexical && lexical !== found.relative ? ` (via ${lexical})` : "";
}

const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

// Pure decision: from the hook input + root, returns allow/deny + reason.
function decide(hook, root, { caseInsensitive = CASE_INSENSITIVE } = {}) {
  if (!hook || typeof hook !== "object") {
    return { decision: "unchecked", reason: "no parseable hook input" };
  }

  const toolName = hook.tool_name;
  const toolInput = hook.tool_input;

  if (toolName === "Bash") {
    return decideBash(toolInput, hook, root, caseInsensitive);
  }

  if (!WRITE_TOOLS.has(toolName)) {
    const input = toolInput && typeof toolInput === "object" ? toolInput : {};

    if (!READ_ONLY_TOOLS.has(String(toolName || "").toLowerCase()) && PATH_FIELDS.some((field) => input[field])) {
      return { decision: "unchecked", reason: `tool ${toolName || "?"} is unknown to the guard and carries a path` };
    }

    return { decision: "allow", reason: `tool ${toolName || "?"} is not a write tool` };
  }

  const ctx = context(hook, root);
  const policy = loadPolicy(ctx.root);
  const filePath = targetPath(toolInput);
  const found = filePath ? firstHit(ctx, filePath, policy, caseInsensitive) : null;
  const relative = filePath ? normalizePortable(path.relative(ctx.root, path.resolve(ctx.cwd, filePath))) : null;

  // Check 1 — path blocked by the policy.
  if (found) {
    return {
      decision: "deny",
      reason: `${found.relative}${viaNote(found, relative)} matches a blocked harness path (${found.hit}). Writing secrets or protected files at the tool boundary is refused by policy.`,
      path: found.relative,
    };
  }

  if (!filePath) {
    return { decision: "unchecked", reason: `${toolName} carried no target path` };
  }

  // Check 2 — secret in the written content. On an allowlisted path (docs,
  // fixtures, story files) only the exact credential formats apply: a
  // placeholder in an example is not a leak, an AWS key in one still is.
  const content = writtenContent(toolName, toolInput);

  if (content) {
    const secret = findSecretsInContent(content, getSecretPatterns(policy), {
      skipHeuristics: relative ? isHeuristicAllowlisted(relative, policy) : false,
      first: true,
    })[0];

    if (secret) {
      return {
        decision: "deny",
        reason: `Potential secret detected in written content (${secret.name}). Refused before it can reach the disk.`,
        path: relative,
      };
    }
  }

  if (ctx.issues.length) {
    return { decision: "unchecked", reason: ctx.issues[0] };
  }

  return { decision: "allow", reason: "no blocked path or secret detected" };
}

// A shell call is checked on what it would WRITE, and on the credential formats
// visible in the command text. Heuristic patterns are not applied to a command
// line: `psql "password=…"` and `export TOKEN=$(…)` are normal, and a guard that
// cries wolf on them is a guard people route around.
function decideBash(toolInput, hook, root, caseInsensitive) {
  const command = toolInput && typeof toolInput.command === "string" ? toolInput.command : "";

  if (toolInput && typeof toolInput === "object" && "command" in toolInput && typeof toolInput.command !== "string") {
    return { decision: "unchecked", reason: "Bash carried no readable command" };
  }

  if (!command.trim()) {
    return { decision: "allow", reason: "no command to inspect" };
  }

  const ctx = context(hook, root);
  const policy = loadPolicy(ctx.root);

  for (const target of shellWriteTargets(command)) {
    const found = firstHit(ctx, target, policy, caseInsensitive);

    if (found) {
      return {
        decision: "deny",
        reason:
          `this command writes to ${found.relative}${viaNote(found, target)}, which matches a blocked harness path (${found.hit}). ` +
          "Shell redirection is not a way around the policy.",
        path: found.relative,
      };
    }
  }

  const secret = findSecretsInContent(command, getSecretPatterns(policy), {
    skipHeuristics: true,
    first: true,
  })[0];

  if (secret) {
    return {
      decision: "deny",
      reason: `Potential secret detected in the command itself (${secret.name}). Refused before it can reach the disk.`,
      path: null,
    };
  }

  if (ctx.issues.length) {
    return { decision: "unchecked", reason: ctx.issues[0] };
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

function recordEvent(file, { root, hook, result }) {
  try {
    const dir = path.join(root, ".coding-flow");

    if (!fs.existsSync(dir)) {
      return;
    }

    const logPath = path.join(dir, file);

    // Bounded on purpose: this is a diagnostic tail, not an audit ledger. The
    // audit ledger is `ai-flow audit`, and it is opt-in.
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > DENIAL_LOG_MAX_BYTES) {
      const kept = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).slice(-200);
      fs.writeFileSync(logPath, kept.length ? `${kept.join("\n")}\n` : "");
    }

    // A hook that made the decision throw can throw here too: read it defensively.
    const field = (read) => {
      try {
        return read() || null;
      } catch {
        return null;
      }
    };
    const target = result.path || field(() => hook.tool_input.file_path);

    fs.appendFileSync(
      logPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        tool: field(() => hook.tool_name),
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

function recordDenial(event) {
  recordEvent("denials.jsonl", event);
}

// The guard could not judge this call. Not a refusal, so not in `denials.jsonl`
// (whose readers mean "the guard refused this"); a separate file `report` and
// `doctor` read, so silence is never mistaken for protection.
function recordUnchecked(event) {
  recordEvent("guard-unchecked.jsonl", event);
}

// Appended to what the agent reads (never to the denial log). Observed on
// OpenCode: refused `.env`, a model wrote the same content to `env` instead. The
// guard cannot see intent, so it says it plainly to the one that can.
const AGENT_ADVICE =
  "Do not retry this under another name, path or tool to get around the guard: tell the user what was refused and why.";

function forAgent(reason) {
  return `${reason} ${AGENT_ADVICE}`;
}

function guardCommand({ getFlagValue, flags }) {
  const inputFile = getFlagValue("--input", null);
  const raw = readHookInput({ inputFile });
  const hook = parseHookInput(raw);
  // Root: cwd provided by the hook if present, otherwise the process cwd.
  const root = projectRoot(hookCwd(hook, process.cwd()));

  let result;
  try {
    result = decide(hook, root);
  } catch (err) {
    result = { decision: "unchecked", reason: `guard error: ${err && err.message}` };
  }

  if (result.decision === "unchecked") {
    recordUnchecked({ root, hook, result });
  }

  if (result.decision === "deny") {
    // Hook decision (stdout) + blocking message (stderr) + exit 2: we cover both
    // documented paths to stay robust across Claude Code versions.
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: forAgent(result.reason),
        },
        systemMessage: result.reason,
      })}\n`,
    );
    process.stderr.write(`coding-flow guard: ${forAgent(result.reason)}\n`);
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

// The same decision for a host that loads this module in its own process (the
// OpenCode plugin) instead of spawning `ai-flow guard`: decide, record a denial,
// return the result. Never throws — a guard that crashes its host gets removed.
function evaluate(hook, root) {
  try {
    const result = decide(hook, root);

    if (result.decision === "deny") {
      recordDenial({ root: projectRoot(hookCwd(hook, root)), hook, result });
      return { ...result, reason: forAgent(result.reason) };
    }

    if (result.decision === "unchecked") {
      recordUnchecked({ root: projectRoot(hookCwd(hook, root)), hook, result });
    }

    return result;
  } catch (err) {
    const result = { decision: "unchecked", reason: `guard error: ${err && err.message}` };
    recordUnchecked({ root, hook, result });
    return result;
  }
}

module.exports = { guardCommand, decide, evaluate, recordUnchecked, shellWriteTargets, loadPolicy };
