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

const { defaultHarnessConfig } = require("./harness-config");
const { getSecretPatterns, findSecretsInContent, isHeuristicAllowlisted } = require("./security-policy");
const { matchesPattern, isAllowedEnvExample, normalizePortable } = require("./util");
const { shellWrites: readShellWrites, splitSegments, tokenize, expandHome: expandHomeIn, isShellLimit, SHELLS } = require("./shell-writes");

// Tools that write to disk through a structured file_path. The others (Read,
// Grep…) are not our business here: immediate allow.
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// Tools known to leave the disk alone, in Claude Code and OpenCode spellings. Any
// OTHER tool that carries a path is a write tool we have not met yet: the guard
// cannot judge it, and says so (`unchecked`) instead of waving it through.
// Keep in step with the read-only regex in the OpenCode plugin body (opencode.js).
const READ_ONLY_TOOLS = new Set(
  [
    "Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "TodoRead",
    "Skill", "SlashCommand", "AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "BashOutput",
    "KillShell", "KillBash", "EnterWorktree", "ExitWorktree", "ListMcpResourcesTool", "ReadMcpResourceTool", "ToolSearch", "Monitor",
    "read", "glob", "grep", "list", "ls", "webfetch", "websearch", "todowrite", "todoread", "skill",
    "task", "question", "lsp", "codesearch",
    "Artifact", "ArtifactData", "ArtifactComments", "ArtifactCheck",
  ].map((name) => name.toLowerCase()),
);
// MCP tools named `mcp__server__tool` (Claude Code's spelling) are the server's own,
// not a write tool the guard could learn. Claude Code never sends them (the hook
// matcher names its write tools). OpenCode spells them `<server>_<tool>`, which no
// name test can tell from a built-in: those are judged like any unknown tool.
const isMcpTool = (name) => /^mcp__/i.test(String(name || ""));
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
// module's cwd (the hook provides its own cwd). Missing config ⇒ defaults, so a
// project that never ran `harness init` is still guarded. A config that exists but
// cannot be read or parsed also falls back to defaults, flagged `unreadable` so the
// decision says it was not judged against the user's policy.
function loadPolicy(root) {
  const defaults = defaultHarnessConfig();
  const configFile = path.join(root, ".coding-flow", "harness.json");

  let config = null;
  let unreadable = false;
  try {
    if (fs.existsSync(configFile)) {
      config = JSON.parse(fs.readFileSync(configFile, "utf8").replace(/^﻿/, ""));
    }
  } catch {
    config = null;
    unreadable = true;
  }

  const pick = (key) =>
    config && Array.isArray(config[key]) ? config[key] : defaults[key];

  return {
    blockedPaths: pick("blockedPaths"),
    secretPatterns: pick("secretPatterns"),
    secretScanAllowlist: pick("secretScanAllowlist"),
    // Only an explicit "strict" tightens the guard; anything else (absent, unreadable,
    // a typo) is the standard posture, so a broken file never locks anyone out.
    mode: config && config.mode === "strict" ? "strict" : "standard",
    unreadable,
  };
}

// --- shell write detection ------------------------------------------------
//
// Reading the shell is `shell-writes.js` (pure: string in, targets out). What it
// asks of the disk is answered here, each answer falling back rather than throwing.

const shellHost = {
  realpath: (dir) => {
    try {
      return fs.realpathSync(dir);
    } catch {
      return dir;
    }
  },
  isDirectory: (file) => {
    try {
      return fs.statSync(file).isDirectory();
    } catch {
      return false;
    }
  },
  realPathOf: (file) => realPathOf(file),
  home: () => os.homedir(),
};

// What a command would write: see `shell-writes.js`.
function shellWrites(command, startCwd = process.cwd()) {
  return readShellWrites(command, startCwd, shellHost);
}

// Compatibility: the plain list of paths a command writes.
function shellWriteTargets(command) {
  return [...new Set(shellWrites(command).filter((e) => e.kind === "write" && !e.unchecked).map((e) => e.target))];
}

// --- path resolution --------------------------------------------------------
//
// A write is judged on the file it will REACH, not on the string it was given:
// through a symlink, a `..`, a `~`, or an absolute path into the primary checkout.

const gitMemo = new Map();

// A timed-out or killed git is not an answer: it is not memoised, so one slow
// call under load does not make a long-lived process (the OpenCode plugin) treat
// the repository as "no repo" for the rest of the session. Nor is it a silent
// "no repo" for the call that timed out: it is recorded in `issues`, so a
// decision made without the repository bound is `unchecked`, not `allow`.
const GIT_TIMEOUT = "git did not answer in time (the project root was not checked)";
// Same for a git that refuses the repository (`safe.directory`, common on mounted
// volumes): it is not saying "no repo", so the bound it would give is not dropped silently.
const GIT_REFUSED = "git refused the repository (safe.directory: the project root was not checked)";

function git(cwd, args, issues = null) {
  const key = `${cwd}\0${args.join(" ")}`;
  if (gitMemo.has(key)) {
    return gitMemo.get(key);
  }

  let out = null;
  try {
    out = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2000,
    }).trim();
  } catch (err) {
    const reason = err && (err.signal || err.code === "ETIMEDOUT") ? GIT_TIMEOUT : /dubious ownership|safe\.directory/.test(String((err && err.stderr) || "")) ? GIT_REFUSED : null;
    if (reason) {
      if (issues && !issues.includes(reason)) {
        issues.push(reason);
      }
      return null;
    }
  }
  gitMemo.set(key, out || null);
  return out || null;
}

// Every root a write from `cwd` answers to, the governing one first: the OUTERMOST
// `.coding-flow/` between `cwd` and the outermost enclosing git toplevel (so a
// nested one cannot swap in a weaker policy), else the nearest git toplevel, else
// `cwd` itself. A submodule or a vendored repo inside the project is part of it:
// from `vendor/lib`, the project's `.coding-flow/` still governs.
//
// The nearest `.coding-flow/` and the nearest git toplevel follow as roots of
// their own: a nested project's `.env` is `.env` to its own policy even when the
// outer one sees it as `proj/.env`. A nested policy only ADDS refusals.
//
// The bound is checked on real paths: git prints the toplevel resolved (and with
// `/` on Windows), so comparing it to a cwd reached through a symlink, or to a
// `C:\…` path, never matches and the walk would climb past the repository.
function projectRoots(cwd, issues = null) {
  const start = path.resolve(cwd);
  const gitTop = git(start, ["rev-parse", "--show-toplevel"], issues);
  const top = gitTop ? path.resolve(gitTop) : null;
  let outer = top;
  for (let at = top && path.dirname(top); at && at !== outer; at = path.dirname(outer)) {
    const enclosing = git(at, ["rev-parse", "--show-toplevel"], issues);
    const next = enclosing ? path.resolve(enclosing) : null;
    // Climb only to a STRICT ancestor: a git pinned to one work tree (GIT_DIR and
    // GIT_WORK_TREE set, `core.worktree`) answers the same toplevel from anywhere.
    if (!next || next === outer || within(next, outer) === null) {
      break;
    }
    outer = next;
  }
  const realTop = outer ? realPathOf(outer) : null;
  let nearest = null;
  let found = null;

  for (let dir = start; ; dir = path.dirname(dir)) {
    if (realTop && within(realTop, realPathOf(dir)) === null) {
      break; // left the repository
    }
    try {
      if (fs.statSync(path.join(dir, ".coding-flow")).isDirectory()) {
        nearest = nearest || dir;
        found = dir;
        if (!top) {
          break; // no repo to bound the search: nearest wins
        }
      }
    } catch {
      // not here
    }
    if (path.dirname(dir) === dir) {
      break;
    }
  }

  const roots = [];
  for (const dir of [found || top || start, nearest, top]) {
    if (dir && !roots.some((seen) => realPathOf(seen) === realPathOf(dir))) {
      roots.push(dir);
    }
  }
  return roots;
}

function projectRoot(cwd, issues = null) {
  return projectRoots(cwd, issues)[0];
}

// When `root` is a linked worktree (its `.git` is a file), the primary checkout.
function primaryCheckout(root, issues = null) {
  try {
    if (!fs.statSync(path.join(root, ".git")).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], issues);

  return common && path.basename(common) === ".git" ? path.dirname(path.resolve(common)) : null;
}

// realpath of the target, or of its nearest existing ancestor plus the segments
// that do not exist yet (a file about to be created). A dangling link is followed
// to where it WOULD create the file — `alias -> .env` with no `.env` yet is `.env`.
// The link's text is read from the link's REAL directory, as the kernel does: under
// `a -> sub/deep`, `a/x -> ../../.env` is `<root>/.env`, not `<root>/../.env`.
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
          const target = path.resolve(realPathOf(path.dirname(dir), depth + 1, issues), fs.readlinkSync(dir));
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
  return expandHomeIn(target, os.homedir());
}

function within(base, file) {
  const rel = path.relative(base, file);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) ? rel : null;
}

// The policy-relative names a target answers to: lexical and real, each made
// relative to the scope's root, else to its primary checkout, else to $HOME.
// `inside` says the name came from the scope itself, not from $HOME.
//
// A relative target is also read from the REAL cwd, as the kernel does: from a cwd
// `<root>/a` with `a -> sub/deep`, `../../.env` is `<root>/.env`, not `<root>/../.env`.
function resolveTargets(ctx, scope, target) {
  const expanded = expandHome(target);
  const lexical = path.resolve(ctx.cwd, expanded);
  const physical = ctx.realCwd && ctx.realCwd !== ctx.cwd ? path.resolve(ctx.realCwd, expanded) : null;
  const files = [lexical, realPathOf(lexical, 0, ctx.issues)];
  if (physical && physical !== lexical) {
    files.push(physical, realPathOf(physical, 0, ctx.issues));
  }
  const home = os.homedir();
  const bases = [scope.root, scope.realRoot, scope.primary, scope.primary && realPathOf(scope.primary), home].filter(Boolean);
  const found = [];

  for (const file of files) {
    for (const base of bases) {
      const rel = within(base, file);
      if (rel !== null) {
        const relative = normalizePortable(rel);
        if (!found.some((entry) => entry.relative === relative)) {
          found.push({ relative, inside: base !== home });
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

const UNREADABLE = "harness.json could not be read (default policy applied)";

function context(hook, root) {
  const cwd = hookCwd(hook, root);
  const issues = [];
  const resolved = path.resolve(cwd);
  const scopes = projectRoots(cwd, issues).map((dir) => {
    const policy = loadPolicy(dir);
    if (policy.unreadable && !issues.includes(UNREADABLE)) {
      issues.push(UNREADABLE);
    }
    return { root: dir, realRoot: realPathOf(dir), primary: primaryCheckout(dir, issues), policy };
  });
  return { cwd: resolved, realCwd: realPathOf(resolved), root: scopes[0].root, scopes, issues };
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
function firstHit(entries, policy, caseInsensitive) {
  for (const entry of entries) {
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
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) {
    return { decision: "unchecked", reason: "no parseable hook input" };
  }

  // `{}` or a renamed field: nothing says which tool this is, so nothing was judged.
  if (typeof hook.tool_name !== "string" || !hook.tool_name) {
    return { decision: "unchecked", reason: "hook input names no tool" };
  }

  const toolName = hook.tool_name;
  const toolInput = hook.tool_input;

  if (toolName === "Bash") {
    return decideBash(toolInput, hook, root, caseInsensitive);
  }

  if (!WRITE_TOOLS.has(toolName)) {
    const input = toolInput && typeof toolInput === "object" ? toolInput : {};

    if (!isMcpTool(toolName) && !READ_ONLY_TOOLS.has(String(toolName || "").toLowerCase()) && PATH_FIELDS.some((field) => input[field])) {
      return { decision: "unchecked", reason: `tool ${String(toolName || "?").slice(0, 64)} is unknown to the guard and carries a path` };
    }

    return { decision: "allow", reason: `tool ${toolName || "?"} is not a write tool` };
  }

  const ctx = context(hook, root);
  const filePath = targetPath(toolInput);
  const relative = filePath ? normalizePortable(path.relative(ctx.root, path.resolve(ctx.cwd, filePath))) : null;
  const named = ctx.scopes.map((scope) => ({ scope, names: filePath ? resolveTargets(ctx, scope, filePath) : [] }));

  // Check 1 — path blocked by the policy of any root the target answers to.
  for (const { scope, names } of named) {
    const found = firstHit(names, scope.policy, caseInsensitive);
    if (found) {
      const given = path.isAbsolute(filePath) ? normalizePortable(path.relative(scope.root, filePath)) : filePath;
      return {
        decision: "deny",
        reason: `${found.relative}${viaNote(found, given)} matches a blocked harness path (${found.hit}). Writing secrets or protected files at the tool boundary is refused by policy.`,
        path: found.relative,
      };
    }
  }

  // Check 2 — secret in the written content. On an allowlisted path (docs,
  // fixtures, story files) only the exact credential formats apply: a
  // placeholder in an example is not a leak, an AWS key in one still is.
  const content = writtenContent(toolName, toolInput);

  // A nested root's policy applies only to a target inside it (its allowlist
  // cannot judge a `$HOME`-relative name); the governing one always applies.
  const secret = !content
    ? null
    : named
        .filter(({ names }, index) => index === 0 || names.some((entry) => entry.inside))
        .map(({ scope, names }) =>
          findSecretsInContent(content, getSecretPatterns(scope.policy), {
            // Every name must be allowlisted: `docs/notes.md -> ../src/app.js` writes
            // into src/, and the docs allowance does not travel through the link.
            skipHeuristics: names.length > 0 && names.every((entry) => isHeuristicAllowlisted(entry.relative, scope.policy)),
            first: true,
          })[0],
        )
        .find(Boolean);

  if (secret) {
    return {
      decision: "deny",
      reason: `Potential secret detected in written content (${secret.name}). Refused before it can reach the disk. A fixture that needs a key-shaped string builds it at run time ('AKIA' + '…'), so no literal is written.`,
      path: relative,
    };
  }

  // Nothing refused: what could not be judged (a missing path) is said, not allowed silently.
  if (!filePath) {
    return { decision: "unchecked", reason: `${toolName} carried no target path` };
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
// `verify` refuses a plan.md command list nobody is watching; the way past that is a
// person's call. An agent that types `--allow-plan-commands` (or fakes a TTY) itself
// turns the gate into a formality, so the guard refuses the grant. The person
// grants it from their own terminal (`! ai-flow verify --allow-plan-commands`).
const PLAN_COMMANDS_GRANT =
  "granting `--allow-plan-commands` (or `AI_FLOW_FORCE_TTY`) is the user's decision, not the agent's. " +
  "Move the commands to .coding-flow/config.json with the user's agreement, or ask the user to run the verify " +
  "themselves from their own terminal";

function grantsPlanCommands(command, depth = 0) {
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment.text);

    if (tokens.some((token) => /^AI_FLOW_FORCE_TTY=/.test(token))) {
      return true;
    }

    if (tokens.includes("--allow-plan-commands") && tokens.includes("verify")) {
      return true;
    }

    // `bash -c "ai-flow verify --allow-plan-commands"`: the program is one quoted word.
    const shell = tokens.findIndex((token) => SHELLS.has(path.basename(token)));
    const flag = shell >= 0 ? tokens.findIndex((token, index) => index > shell && /^-[A-Za-z]*c$/.test(token)) : -1;

    if (depth < 3 && flag >= 0 && tokens[flag + 1] && grantsPlanCommands(tokens[flag + 1], depth + 1)) {
      return true;
    }
  }

  return false;
}

function decideBash(toolInput, hook, root, caseInsensitive) {
  // A missing or renamed `command` is not an empty one: only `""` has nothing to check.
  if (!toolInput || typeof toolInput !== "object" || typeof toolInput.command !== "string") {
    return { decision: "unchecked", reason: "Bash carried no readable command" };
  }

  const command = toolInput.command;

  if (!command.trim()) {
    return { decision: "allow", reason: "no command to inspect" };
  }

  if (grantsPlanCommands(command)) {
    return { decision: "deny", reason: PLAN_COMMANDS_GRANT, path: null };
  }

  const ctx = context(hook, root);

  for (const entry of shellWrites(command, ctx.cwd)) {
    if (entry.unchecked) {
      ctx.issues.push(entry.unchecked);
      continue;
    }

    const target = entry.target;
    let found = null;
    for (const scope of ctx.scopes) {
      found = found || firstHit(resolveTargets(ctx, scope, target), scope.policy, caseInsensitive);
    }

    if (found) {
      const what =
        entry.kind === "alias"
          ? `this command aliases ${found.relative}${viaNote(found, target)} (a link to it would be a way around the policy), which matches a blocked harness path (${found.hit}).`
          : entry.kind === "inline"
            ? `this inline code names ${found.relative}${viaNote(found, target)}, which matches a blocked harness path (${found.hit}). An interpreter is not a way around the policy.`
            : `this command writes to ${found.relative}${viaNote(found, target)}, which matches a blocked harness path (${found.hit}). Shell redirection is not a way around the policy.`;

      return { decision: "deny", reason: what, path: found.relative };
    }
  }

  const secret = ctx.scopes
    .map((scope) => findSecretsInContent(command, getSecretPatterns(scope.policy), { skipHeuristics: true, first: true })[0])
    .find(Boolean);

  if (secret) {
    return {
      decision: "deny",
      reason: `Potential secret detected in the command itself (${secret.name}). Refused before it can reach the disk. A fixture that needs a key-shaped string builds it at run time ('AKIA' + '…'), so no literal is written.`,
      path: null,
    };
  }

  // A real failure (ELOOP, a git timeout) is named before a shell-reading limit:
  // `doctor` skips the limits, and `> "$X"; > loop/x` must not hide the ELOOP.
  if (ctx.issues.length) {
    return { decision: "unchecked", reason: ctx.issues.find((reason) => !isShellLimit(reason)) || ctx.issues[0] };
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

// Inside the project: relative. Outside it: a marker, not a `../..` chain that
// spells out where the project sits.
function loggedPath(root, target) {
  const relative = path.isAbsolute(target) ? path.relative(root, target) : path.normalize(target);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? "(outside project)" : normalizePortable(relative);
}

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
    // A non-string path (a number, an array) is what made the decision throw: log the line without it.
    const given = result.path || field(() => hook.tool_input.file_path);
    const target = typeof given === "string" ? given : null;

    fs.appendFileSync(
      logPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        tool: field(() => hook.tool_name),
        // Relative when it is inside the project, so the log carries no home
        // directory and no username. `report` redacts anything left over.
        path: target ? loggedPath(root, target) : null,
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

// In `strict`, "the guard could not check this" is a refusal: a hard boundary has
// no third outcome. The one exemption is the policy file itself through a write tool,
// so strictness alone can never lock the user out of switching back.
const STRICT_PREFIX = "not checked, refused in strict mode:";

function strictOutcome(result, hook, roots) {
  if (!result || result.decision !== "unchecked") {
    return result;
  }

  let strict = false;
  try {
    strict = [].concat(roots).some((root) => loadPolicy(root).mode === "strict");
  } catch {
    strict = false;
  }

  const input = hook && hook.tool_input;
  const file = input && typeof (input.file_path || input.path) === "string" ? String(input.file_path || input.path) : "";
  if (!strict || (WRITE_TOOLS.has(hook && hook.tool_name) && /(^|[\\/])\.coding-flow[\\/]harness\.json$/.test(file))) {
    return result;
  }

  return { decision: "deny", reason: `${STRICT_PREFIX} ${result.reason}`, path: null };
}

function guardCommand({ getFlagValue, flags }) {
  const inputFile = getFlagValue("--input", null);
  const raw = readHookInput({ inputFile });
  const hook = parseHookInput(raw);
  // Root: cwd provided by the hook if present, otherwise the process cwd.
  const roots = projectRoots(hookCwd(hook, process.cwd()));
  const root = roots[0];

  let result;
  try {
    result = decide(hook, root);
  } catch (err) {
    result = { decision: "unchecked", reason: `guard error: ${(err && (err.code || err.name)) || "unknown"}` };
  }

  result = strictOutcome(result, hook, roots);

  if (result.decision === "unchecked") {
    recordUnchecked({ root, hook, result });
    // Hosts that spawn the guard (OpenCode fallback) forward this line.
    process.stderr.write(`coding-flow guard: ${result.reason}; this write was NOT checked\n`);
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
    const roots = projectRoots(hookCwd(hook, root));
    const result = strictOutcome(decide(hook, root), hook, roots);

    if (result.decision === "deny") {
      recordDenial({ root: roots[0], hook, result });
      return { ...result, reason: forAgent(result.reason) };
    }

    if (result.decision === "unchecked") {
      recordUnchecked({ root: roots[0], hook, result });
    }

    return result;
  } catch (err) {
    // The roots the policy comes from, as in the try: the host's directory can sit
    // below the project, and a strict project must still refuse a crash.
    let roots = [root];
    try {
      roots = projectRoots(hookCwd(hook, root)).concat(root);
    } catch {
      // the climb itself failed: the host's directory is all there is
    }
    const result = strictOutcome({ decision: "unchecked", reason: `guard error: ${(err && (err.code || err.name)) || "unknown"}` }, hook, roots);
    // Logged where the try logs: the project, not a subdirectory with no .coding-flow/.
    if (result.decision === "deny") {
      recordDenial({ root: roots[0], hook, result });
      return { ...result, reason: forAgent(result.reason) };
    }
    recordUnchecked({ root: roots[0], hook, result });
    return result;
  }
}

module.exports = { guardCommand, decide, evaluate, recordUnchecked, isShellLimit, shellWriteTargets, shellWrites, loadPolicy };
