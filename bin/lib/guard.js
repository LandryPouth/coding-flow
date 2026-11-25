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

const { defaultHarnessConfig, harnessMode } = require("./harness-config");
const { getSecretPatterns, findSecretsInContent, isHeuristicAllowlisted } = require("./security-policy");
const { matchesPattern, isAllowedEnvExample, normalizePortable } = require("./util");
const { shellWrites: readShellWrites, splitSegments, tokenize, commandOf, expandHome: expandHomeIn, isShellLimit, SHELLS, ARCHIVE, UNREAD_TREE } = require("./shell-writes");

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
    mode: harnessMode(config) === "strict" ? "strict" : "standard",
    ...destructivePolicy(config),
    unreadable,
  };
}

// Story 29-03. Anything but an explicit "warn" or "off" is "deny": a typo or a
// broken file never disarms the check. The allow list holds exact command
// prefixes, word by word.
const DESTRUCTIVE_MODES = ["deny", "warn", "off"];

// An entry that names no command (`*`) or only a verb (`rm *`) would turn the check
// off for it: ignored, and named in the refusal.
// A trailing `*` needs an operand before it: `rm -rf *`, `git clean *`, `git clean -fdX *`
// are verbs and flags only (a git subcommand counts with the verb).
function TOO_BROAD(entry) {
  const words = entry.trim().split(/\s+/);
  if (words[words.length - 1] !== "*") {
    return false;
  }
  const named = words.slice(0, -1).filter((word) => !word.startsWith("-"));
  return named.length < (named[0] === "git" ? 3 : 2);
}

function destructivePolicy(config) {
  const valid = config && typeof config === "object" && !Array.isArray(config);
  const entries = valid && Array.isArray(config.allowDestructive) ? config.allowDestructive.filter((entry) => typeof entry === "string" && entry.trim()) : [];
  return {
    destructiveCommands: valid && DESTRUCTIVE_MODES.includes(config.destructiveCommands) ? config.destructiveCommands : "deny",
    allowDestructive: entries.filter((entry) => !TOO_BROAD(entry)),
    ignoredAllow: entries.filter(TOO_BROAD),
    primaryLocked: Boolean(valid && config.worktrees && typeof config.worktrees === "object" && config.worktrees.primaryLocked === true),
  };
}

// Whether the primary checkout is locked for a call made under `policy` (the
// policy of the checkout the call runs from). Locked by that policy, or by the
// primary checkout's own (`git -C <primary> switch` from a linked worktree).
// A policy file that cannot be read keeps the lock: `chmod 000` or a broken
// edit must not open the primary checkout. `by` names what decided it.
function primaryLock(policy, primaryRoot) {
  const own = loadPolicy(primaryRoot);
  const unreadable = policy.unreadable || own.unreadable;
  let by = null;
  if (policy.unreadable) by = "unreadable";
  else if (own.unreadable) by = "primary-unreadable";
  else if (policy.primaryLocked) by = "policy";
  else if (own.primaryLocked) by = "primary";
  return { locked: Boolean(by), unreadable, by };
}

// The destructive-command policy as the guard applies it to a call run from
// `root`: its own policy, and the primary checkout's lock combined as above.
// `ai-flow rules` prints this (story 26-06) rather than reading the file itself.
function effectiveDestructivePolicy(root) {
  const policy = loadPolicy(root);
  const { out } = gitNow(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const commonDir = (out || "").trim();
  const primaryRoot = commonDir ? path.dirname(path.resolve(commonDir)) : root;
  const lock = primaryLock(policy, primaryRoot);
  return {
    destructiveCommands: policy.destructiveCommands,
    allowDestructive: policy.allowDestructive,
    ignoredAllow: policy.ignoredAllow,
    primaryLocked: lock.locked,
    lockedBy: lock.by,
    unreadable: policy.unreadable,
    primaryRoot,
  };
}

// --- shell write detection ------------------------------------------------
//
// Reading the shell is `shell-writes.js` (pure: string in, targets out). What it
// asks of the disk is answered here, each answer falling back rather than throwing.

const PATCH_READ_MAX_BYTES = 4 * 1024 * 1024;

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
  // The top of the repository holding `dir`: `git apply` reads patch paths from it.
  gitRoot: (dir) => {
    for (let at = dir; ; at = path.dirname(at)) {
      if (fs.existsSync(path.join(at, ".git"))) {
        return at;
      }
      if (path.dirname(at) === at) {
        return null;
      }
    }
  },
  // A patch `git apply` will read; a large or unreadable one is not guessed at.
  readText: (file) => {
    try {
      return fs.statSync(file).size <= PATCH_READ_MAX_BYTES ? fs.readFileSync(file, "utf8") : null;
    } catch {
      return null;
    }
  },
};

// What a command would write: see `shell-writes.js`.
function shellWrites(command, startCwd = process.cwd(), options = {}) {
  return readShellWrites(command, startCwd, shellHost, options);
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

  // `X/**` names X itself too: writing X replaces everything under it (story 13-09).
  return policy.blockedPaths.find((pattern) => matchesPattern(fold(relative), fold(pattern)) || (blockedDirectory(pattern) !== null && matchesPattern(fold(relative), fold(blockedDirectory(pattern))))) || null;
}

// The directory a `X/**` entry blocks, or null for a file pattern.
function blockedDirectory(pattern) {
  return typeof pattern === "string" && pattern.endsWith("/**") && pattern.length > 3 ? pattern.slice(0, -3) : null;
}

// The blocked directory (a literal `X/**` entry) that `relative` holds, the
// project root holding them all.
function holdsBlocked(relative, policy, caseInsensitive = false) {
  const fold = (value) => (caseInsensitive ? value.toLowerCase() : value);
  return policy.blockedPaths.find((pattern) => {
    const directory = blockedDirectory(pattern);
    return directory !== null && !/[*?[]/.test(directory) && (relative === "" || fold(directory).startsWith(`${fold(relative)}/`));
  }) || null;
}

// Moving a path away takes everything under it: refused when it is a blocked
// directory itself or holds one. Moving a file out from under one is a deletion,
// which the guard does not judge.
function movedAwayHit(relative, policy, caseInsensitive = false) {
  const fold = (value) => (caseInsensitive ? value.toLowerCase() : value);
  const ancestors = relative.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
  const isDirectory = (pattern) => {
    const directory = blockedDirectory(pattern);
    return directory !== null && matchesPattern(fold(relative), fold(directory)) && !ancestors.some((ancestor) => matchesPattern(fold(ancestor), fold(directory)));
  };
  return holdsBlocked(relative, policy, caseInsensitive) || policy.blockedPaths.find(isDirectory) || null;
}

// A whole tree written at `relative` (a recursive copy, an extraction, a checked-out
// directory) replaces what it holds. The project root holds everything, and
// `git restore .` or `cp -r /tmp/x/. .` are everyday commands: there, a copy is
// judged on what its source holds on disk (`sourceHit`).
function treeHit(relative, policy, caseInsensitive = false) {
  return relative === "" ? null : blockedPathHit(relative, policy, caseInsensitive) || holdsBlocked(relative, policy, caseInsensitive);
}

// The literal blocked path (`.coding-flow/runs`, `.coding-flow/ledger.jsonl`) a
// tree copied onto the project root would bring in from `source`.
function sourceHit(source, policy) {
  for (const pattern of policy.blockedPaths) {
    const name = blockedDirectory(pattern) ?? pattern;
    if (typeof name === "string" && !/[*?[]/.test(name) && fs.existsSync(path.join(source, name))) {
      return { hit: pattern, relative: name };
    }
  }
  return null;
}

// First blocked name among everything this target resolves to.
function firstHit(entries, policy, caseInsensitive, judge = blockedPathHit) {
  for (const entry of entries) {
    const hit = judge(entry.relative, policy, caseInsensitive);
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
// A nested root's policy applies only to a target inside it (its allowlist
// cannot judge a `$HOME`-relative name); the governing one always applies.
function secretInWrite(named, content) {
  return named
    .filter(({ names }, index) => index === 0 || names.some((entry) => entry.inside))
    .map(({ scope, names }) =>
      findSecretsInContent(content, getSecretPatterns(scope.policy), {
        // Every name must be allowlisted: `docs/notes.md -> ../src/app.js` writes
        // into src/, and the docs allowance does not travel through the link.
        skipHeuristics: names.length > 0 && names.every((entry) => {
          return isHeuristicAllowlisted(entry.relative, scope.policy);
        }),
        first: true,
      })[0],
    )
    .find(Boolean);
}

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

  // Check 0 — the agent does not loosen what it may destroy (story 29-03).
  const loosened = named.map(({ scope, names }) => policyLoosening(scope, names, toolName, toolInput, caseInsensitive)).find(Boolean);
  if (loosened) {
    return { decision: "deny", reason: loosened, path: POLICY_FILE };
  }

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

  const secret = content ? secretInWrite(named, content) : null;

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

// The blocked path one shell target reaches, or null. A move is judged on what it
// takes away; an extraction on where it lands — and, inside the project, its
// unreadable contents make the call unchecked.
const JUDGES = { move: movedAwayHit, tree: treeHit, extract: treeHit };

function judgeShellEntry(ctx, entry, caseInsensitive) {
  const judge = JUDGES[entry.kind] || blockedPathHit;
  let found = null;
  let issue = null;
  for (const scope of ctx.scopes) {
    const targets = resolveTargets(ctx, scope, entry.target);
    found = found || firstHit(targets, scope.policy, caseInsensitive, judge);
    if (!found && JUDGES[entry.kind] === treeHit) {
      const landing = rootLanding(ctx, scope, entry);
      found = landing.found || null;
      issue = issue || landing.issue || (entry.kind === "extract" && targets.some((target) => target.inside) ? ARCHIVE : null);
    }
  }
  if (!found && issue === ARCHIVE && entry.archive && !entry.chained) {
    const judged = judgeMembers(ctx, entry, caseInsensitive);
    if (judged) {
      found = judged.found;
      issue = null;
    }
  }
  // Heuristic reading: refused when the target is known to touch a blocked path,
  // logged when it cannot be read — never a silent allow.
  if (!found && issue && !ctx.issues.includes(issue)) {
    ctx.issues.push(issue);
  }
  return found;
}

// An extraction whose archive is on disk and listable is judged by where each
// member lands (story 13-13). null when the members cannot be read.
function judgeMembers(ctx, entry, caseInsensitive) {
  // Required here, not at the top: the guard's module graph stays small on the
  // calls that extract nothing.
  const members = require("./archive-members").archiveMembers(entry.archive, entry.format);
  if (!members) {
    return null;
  }
  const landing = path.resolve(ctx.cwd, expandHome(entry.target));
  for (const member of members) {
    const where = path.join(landing, member.name);
    for (const scope of ctx.scopes) {
      const found = firstHit(resolveTargets(ctx, scope, where), scope.policy, caseInsensitive, member.directory ? treeHit : blockedPathHit);
      if (found) {
        return { found };
      }
    }
  }
  return { found: null };
}

// A tree or an extraction landing on the project root or one of its ancestors
// (`-C ..`, `rsync -a X/ ..`) lands on everything the project holds. An
// extraction there is unchecked. A copy is unchecked when its source is a glob or
// when an earlier segment of the command ran first (it may have made or filled
// the source); otherwise it is judged on what the source holds at the project's
// place (`X/<project>/…` for an ancestor) — a missing one fails, nothing lands. A
// pathspec has no source (`git restore .`): committed content, allowed.
function rootLanding(ctx, scope, entry) {
  const landing = path.resolve(ctx.cwd, expandHome(entry.target));
  const lands = [landing, realPathOf(landing)].filter(Boolean);
  for (const root of [scope.root, scope.realRoot].filter(Boolean)) {
    const at = lands.find((where) => where === root || root.startsWith(where.endsWith(path.sep) ? where : where + path.sep));
    if (at === undefined) {
      continue;
    }
    if (entry.kind === "extract") {
      return { issue: ARCHIVE };
    }
    if (entry.unread || entry.chained) {
      return { issue: UNREAD_TREE };
    }
    if (!entry.source || !fs.existsSync(entry.source)) {
      return {};
    }
    return { found: sourceHit(path.join(entry.source, path.relative(at, root)), scope.policy) };
  }
  return {};
}

function denialFor(entry, found) {
  const where = `${found.relative}${viaNote(found, entry.target)}`;
  switch (entry.kind) {
    case "alias":
      return `this command aliases ${where} (a link to it would be a way around the policy), which matches a blocked harness path (${found.hit}).`;
    case "inline":
      return `this inline code names ${where}, which matches a blocked harness path (${found.hit}). An interpreter is not a way around the policy.`;
    case "move":
      return `this command moves ${where} away, which is or holds a blocked harness path (${found.hit}); putting it back would replace what it protects. Moving a directory is not a way around the policy.`;
    case "tree":
      return `this command writes the whole directory ${where}, which is or holds a blocked harness path (${found.hit}). A recursive copy is not a way around the policy.`;
    case "extract":
      return `this command extracts an archive into ${where}, which matches a blocked harness path (${found.hit}). An archive is not a way around the policy.`;
    default:
      return `this command writes to ${where}, which matches a blocked harness path (${found.hit}). Shell redirection is not a way around the policy.`;
  }
}

// --- destructive commands (story 29-03) ------------------------------------------
//
// `destructive.js` reads which commands of the line destroy work or history;
// here the disk settles what it cannot (is the path modified, is this the
// primary checkout), and the governing policy says deny, warn or off.

const POLICY_FILE = ".coding-flow/harness.json";
// The same words as `destructive.js`, which is required only on the Bash path
// (the guard's module graph stays small on a Write).
const DESTRUCTIVE_EXPANSION = "a destructive-command check depends on shell expansion";
const DESTRUCTIVE_UNKNOWN_CWD = "a destructive-command check depends on a working directory set by shell expansion";
const MODE_RANK = { off: 0, warn: 1, deny: 2 };

// The destructive policy a harness.json text would give, as `loadPolicy` reads it.
function destructivePolicyOf(text) {
  let config = null;
  try {
    config = text === null ? null : JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    config = null;
  }
  return destructivePolicy(config);
}

function loosens(before, after) {
  return (
    MODE_RANK[after.destructiveCommands] < MODE_RANK[before.destructiveCommands] ||
    after.allowDestructive.some((entry) => !before.allowDestructive.includes(entry)) ||
    (before.primaryLocked && !after.primaryLocked)
  );
}

function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// The file a write tool leaves, or undefined when it cannot be told (an Edit
// whose old text is not there fails on its own).
function afterWrite(toolName, input, before) {
  if (toolName === "Write") {
    return typeof input.content === "string" ? input.content : undefined;
  }
  const edits = toolName === "MultiEdit" ? (Array.isArray(input.edits) ? input.edits : []) : [input];
  let text = before;
  for (const edit of edits) {
    if (text === null || !edit || typeof edit.old_string !== "string" || typeof edit.new_string !== "string" || !text.includes(edit.old_string)) {
      return undefined;
    }
    text = edit.replace_all ? text.split(edit.old_string).join(edit.new_string) : text.replace(edit.old_string, () => edit.new_string);
  }
  return text;
}

// A write tool may edit the policy file — the user repairs it through their
// agent, strict or not — but not to loosen what the agent may destroy: that
// is the human's edit.
function isPolicyName(entry, caseInsensitive) {
  return entry.inside && (caseInsensitive ? entry.relative.toLowerCase() === POLICY_FILE : entry.relative === POLICY_FILE);
}

function policyLoosening(scope, names, toolName, input, caseInsensitive) {
  if (!names.some((entry) => isPolicyName(entry, caseInsensitive))) {
    return null;
  }
  // A notebook edit can only break the file: nothing a repair needs.
  if (toolName === "NotebookEdit") {
    return `a notebook edit of ${POLICY_FILE} is refused: the policy file is edited with Write or Edit, or by the human.`;
  }
  const file = path.join(scope.root, POLICY_FILE);
  const before = readTextOrNull(file);
  const after = afterWrite(toolName, input || {}, before);
  if (after === undefined || !loosens(destructivePolicyOf(before), destructivePolicyOf(after))) {
    return null;
  }
  return `this edit loosens the destructive-command policy in ${POLICY_FILE} (destructiveCommands, allowDestructive, worktrees.primaryLocked). What the agent may destroy is the human's decision: ask them to make this edit.`;
}

// A shell command that removes, moves or overwrites the policy file (or a
// directory holding it) brings the defaults back, and a project's
// primaryLocked goes with them. Read through `cd`, `bash -c`, `xargs` as the
// destructive commands are. A glob is matched against the file and its
// directories; a path built by an expansion that may name it is unchecked.
const GLOB = /[*?[{]/;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

const POSIX_CLASSES = { alpha: "a-zA-Z", digit: "0-9", alnum: "a-zA-Z0-9", upper: "A-Z", lower: "a-z", space: "\\s", blank: " \\t", xdigit: "0-9A-Fa-f", word: "\\w" };

// `[…]` at `i`: `{ source, end }`; `{ literal: true }` when it does not close (a
// plain `[`); null when it cannot be modelled (`[z-a]`, `[[:punct:]]`, `[[=a=]]`).
function bracketAt(pattern, i) {
  let j = i + 1;
  const negate = pattern[j] === "!" || pattern[j] === "^";
  j += negate ? 1 : 0;
  let body = "";
  for (const first = j; j < pattern.length; j += 1) {
    const ch = pattern[j];
    if (ch === "]" && j > first) {
      const source = `[${negate ? "^" : ""}${body}]`;
      try {
        new RegExp(source);
      } catch {
        return null;
      }
      return { source, end: j };
    }
    if (ch === "[" && /[:=.]/.test(pattern[j + 1] || "")) {
      const close = pattern.indexOf(`${pattern[j + 1]}]`, j + 2);
      const named = close === -1 || pattern[j + 1] !== ":" ? undefined : POSIX_CLASSES[pattern.slice(j + 2, close)];
      if (named === undefined) {
        return null;
      }
      body += named;
      j = close + 1;
    } else if (ch === "\\") {
      body += `\\${pattern[j + 1] || "\\"}`;
      j += 1;
    } else {
      body += /[\]\\^[]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return { literal: true };
}

// `{a,b}` at `i`: its alternatives and end; null when it is not a brace
// expansion (no comma, no close).
function braceAt(pattern, i) {
  let depth = 0;
  let start = i + 1;
  const parts = [];
  for (let j = i; j < pattern.length; j += 1) {
    const ch = pattern[j];
    if (ch === "\\") {
      j += 1;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "," && depth === 1) {
      parts.push(pattern.slice(start, j));
      start = j + 1;
    } else if (ch === "}" && (depth -= 1) === 0) {
      parts.push(pattern.slice(start, j));
      return parts.length > 1 ? { parts, end: j } : null;
    }
  }
  return null;
}

// A shell glob as a regex source, or null when it cannot be modelled: the
// caller reads that as matching. `find -path` lets `*` and `?` cross a `/`.
function globSource(pattern, crosses) {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      out += crosses ? ".*" : "[^/]*";
    } else if (ch === "?") {
      out += crosses ? "." : "[^/]";
    } else if (ch === "\\") {
      out += escapeRegex(pattern[i + 1] || "\\");
      i += 1;
    } else if (ch === "[") {
      const bracket = bracketAt(pattern, i);
      if (bracket === null) {
        return null;
      }
      out += bracket.literal ? "\\[" : bracket.source;
      i = bracket.literal ? i : bracket.end;
    } else if (ch === "{" && braceAt(pattern, i)) {
      const brace = braceAt(pattern, i);
      const alternatives = brace.parts.map((part) => globSource(part, crosses));
      if (alternatives.includes(null)) {
        return null;
      }
      out += `(?:${alternatives.join("|")})`;
      i = brace.end;
    } else if (ch === "{" && /^\{[^{}]*\.\.[^{}]*\}/.test(pattern.slice(i))) {
      return null; // a sequence, `{a..z}`
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

// The glob as a RegExp, or null (matches anything) when it cannot be modelled.
function globRegex(pattern, caseInsensitive, crosses = false) {
  const source = globSource(pattern, crosses);
  try {
    return source === null ? null : new RegExp(`^${source}$`, caseInsensitive ? "i" : "");
  } catch {
    return null;
  }
}

const globMatches = (regex, text) => regex === null || regex.test(text);

// An operand glob made absolute: its directory escaped, so a `[` in the
// directory's name is not a class; leading `..` resolved.
function absoluteGlob(cwd, operand) {
  const parts = path.posix.normalize(slashed(operand)).split("/");
  let lead = 0;
  while (parts[lead] === "..") {
    lead += 1;
  }
  const base = path.isAbsolute(operand) ? "" : `${slashed(path.resolve(cwd, ...parts.slice(0, lead))).replace(/[*?[{\\]/g, "\\$&")}/`;
  return base + parts.slice(lead).join("/");
}

function slashed(file) {
  return file.split(path.sep).join("/");
}

// The policy file of each scope — and of its primary checkout, which a linked
// worktree's write tools may not loosen either — and the directories that hold it.
function policyPaths(ctx) {
  const files = new Set();
  for (const scope of ctx.scopes) {
    for (const root of [scope.root, scope.realRoot, scope.primary].filter(Boolean)) {
      files.add(path.join(root, POLICY_FILE));
    }
  }
  return [...files].map((file) => ({ file, holders: [path.dirname(file), path.dirname(path.dirname(file))] }));
}

// "write" reaches the file itself; "remove" and "link" (a link to it, through
// which a later step cannot be followed) also reach a directory holding it.
function reaches(cwd, operand, mode, policies, caseInsensitive) {
  const fold = (text) => (caseInsensitive ? text.toLowerCase() : text);
  const holds = mode === "remove" || mode === "link";
  if (GLOB.test(operand)) {
    const pattern = globRegex(absoluteGlob(cwd, expandHome(operand)), caseInsensitive);
    return policies.some(({ file, holders }) => globMatches(pattern, slashed(file)) || (holds && holders.some((holder) => globMatches(pattern, slashed(holder)))));
  }
  const target = path.resolve(cwd, expandHome(operand));
  const real = realPathOf(target);
  return policies.some(({ file }) => [target, real].filter(Boolean).some((at) => fold(at) === fold(file) || (holds && fold(file).startsWith(fold(at).replace(/[\\/]?$/, path.sep)))));
}

// `find START… -delete` reaches the file when a start holds it and its name
// tests (none, or one that matches) let it through.
function findReaches(cwd, { starts, tests }, policies, caseInsensitive) {
  return starts.some((start) => {
    const from = path.resolve(cwd, expandHome(start));
    return policies.some(({ file }) => {
      const inside = path.relative(from, file);
      if (inside.startsWith("..") || path.isAbsolute(inside)) {
        return false;
      }
      // As find prints it: the start as typed, then the path under it (`./.coding-flow/…`).
      const shown = inside ? `${start.replace(/\/+$/, "")}/${slashed(inside)}` : start;
      return (
        tests.length === 0 ||
        tests.some(({ test, pattern }) => {
          const folded = caseInsensitive || test.startsWith("i");
          if (/regex/.test(test)) {
            return true; // not modelled: read as matching
          }
          return /name$/.test(test) && !/wholename/.test(test) ? globMatches(globRegex(pattern, folded), path.basename(file)) : globMatches(globRegex(pattern, folded, true), shown);
        })
      );
    });
  });
}

const MAY_NAME_POLICY = /harness|coding|[*?[{]|^[$`]|\/[$`]/;
const POLICY_UNSEEN = `a command removes or overwrites paths the guard cannot see (handed by xargs); one may be ${POLICY_FILE}`;
const POLICY_MAYBE = `a command the guard does not read may remove or overwrite ${POLICY_FILE}`;

// Whether one entry of `touched` reaches the policy file. An operand built by an
// expansion that may name it joins the issues instead.
// `answers`: one call's memo, so a word repeated by both readers (or 40 000 times) is
// resolved on disk once (series 2 round 2: the hook's worst case).
function entryReaches(ctx, entry, policies, caseInsensitive, answers = new Map()) {
  const unsure = (reason) => !ctx.issues.includes(reason) && ctx.issues.push(reason);
  if (entry.find) {
    if (entry.cwd === null || entry.find.starts.some((start) => EXPANDS.test(start))) {
      unsure(DESTRUCTIVE_EXPANSION);
      return false;
    }
    return findReaches(entry.cwd, entry.find, policies, caseInsensitive);
  }
  return entry.paths.some((operand) => {
    if (EXPANDS.test(operand) || (entry.cwd === null && !path.isAbsolute(operand))) {
      if (MAY_NAME_POLICY.test(operand)) {
        unsure(DESTRUCTIVE_EXPANSION);
      }
      return false;
    }
    const key = `${entry.cwd}\0${entry.mode}\0${operand}`;
    if (!answers.has(key)) {
      answers.set(key, reaches(entry.cwd, operand, entry.mode, policies, caseInsensitive));
    }
    return answers.get(key);
  });
}

// The refusal when a command removes, moves, overwrites or links to the policy
// file; null otherwise. What may reach it unseen (xargs' paths, a command the
// guard does not read) is unchecked, never allowed.
function touchesPolicyFile(ctx, touched, caseInsensitive) {
  const policies = policyPaths(ctx);
  const unsure = (reason) => !ctx.issues.includes(reason) && ctx.issues.push(reason);
  const answers = new Map();
  for (const entry of touched) {
    if (entry.unseen) {
      unsure(POLICY_UNSEEN);
    } else if (entryReaches(ctx, entry, policies, caseInsensitive, answers)) {
      if (!entry.maybe) {
        return `this command removes, moves, overwrites or links to ${POLICY_FILE} (or a directory holding it), which holds the destructive-command policy; without it the defaults apply and a locked primary checkout is unlocked. Ask the human.`;
      }
      unsure(POLICY_MAYBE);
    }
  }
  return null;
}

// What an `onPath("trash")` is worth: the alternative `rm -r` names.
function onPath(program) {
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  return (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => extensions.some((ext) => fs.existsSync(path.join(dir, program + ext))));
}

const destructiveHost = {
  exists: (file) => file !== null && fs.existsSync(file),
  // A regular file of at most 64 KB (a script copied, an SQL file): its text, else null.
  readSmall: (file) => {
    try {
      const stat = fs.statSync(file);
      return stat.isFile() && stat.size <= 65536 ? fs.readFileSync(file, "utf8") : null;
    } catch {
      return null;
    }
  },
  home: () => os.homedir(),
  onPath,
  // `{ value }`: the alias' expansion, null when `name` is none; `{ issue }` when git did not answer.
  // Only exit 1 means "no such alias"; any other failure is no answer.
  gitAlias: (cwd, name, { local = false } = {}) => {
    const { out, issue, status } = gitNow(cwd, ["config", ...(local ? ["--local"] : []), "--get", `alias.${name}`]);
    if (issue || (out === null && status !== 1)) {
      return { issue: issue || "git did not answer for the alias" };
    }
    return { value: out === null ? null : out.replace(/\r?\n$/, "") };
  },
  // Where git runs a `!` alias: the work tree's top; null when git does not say.
  gitTop: (cwd) => {
    const { out } = gitNow(cwd, ["rev-parse", "--show-toplevel"]);
    return out ? out.trim() : null;
  },
};

// git, fresh: the work tree changes between two calls of a long-lived host, so
// the memo `git()` keeps for roots is not used. `{ out }`, with `issue` when git
// did not answer (a timeout, a refused repository): the check is then unchecked.
// One git timeout spends the decision's budget: the lookups after it are skipped
// (unchecked) rather than each waiting 2 s. Reset by `decideBash`.
const GIT_MISSING = "git is not on the guard's PATH (the destructive-command check was not run)";
// The destructive checks' own wording: GIT_TIMEOUT and GIT_REFUSED speak of the project root.
const DESTRUCTIVE_GIT_TIMEOUT = "git did not answer in time (the destructive-command check was not run)";
const DESTRUCTIVE_GIT_REFUSED = "git refused the repository (safe.directory: the destructive-command check was not run)";
const GIT_TOO_LONG = "git's answer was larger than the guard reads (the destructive-command check was not run)";
const gitBudget = { spent: false };

function gitNow(cwd, args) {
  if (gitBudget.spent) {
    return { out: null, issue: DESTRUCTIVE_GIT_TIMEOUT };
  }
  try {
    return { out: execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 2000, maxBuffer: 64 * 1024 * 1024 }) };
  } catch (err) {
    if (err && err.code === "ENOBUFS") {
      return { out: null, issue: GIT_TOO_LONG }; // killed for its output, not for time
    }
    if (err && (err.signal || err.code === "ETIMEDOUT")) {
      gitBudget.spent = true;
      return { out: null, issue: DESTRUCTIVE_GIT_TIMEOUT };
    }
    if (err && typeof err.code === "string") {
      return { out: null, issue: GIT_MISSING }; // ENOENT, EACCES: git never ran
    }
    if (/dubious ownership|safe\.directory/.test(String((err && err.stderr) || ""))) {
      return { out: null, issue: DESTRUCTIVE_GIT_REFUSED };
    }
    return { out: null, status: err && err.status };
  }
}

function fileList(lines) {
  const shown = lines.slice(0, 5).join(", ");
  return lines.length > 5 ? `${shown} and ${lines.length - 5} more` : shown;
}

const porcelainFiles = (out) => (out || "").split(/\r?\n/).filter(Boolean).map((line) => line.slice(3));
const EXPANDS = /[$`]/;

// `rm FILE` without a `git status` spawn (story 29-04): true when every path is
// missing, untracked, or tracked with the size and mtime the index recorded, older
// than the index itself (git's own racy rule). Anything else — a bigger or newer
// index format, a conflict, a directory — is null, and `git status` decides.
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const GLOB_WORD = /[*?[]/;
const GIT_STATUS_FAILED = "git status failed on the paths a destructive command names (the check was not run)";

// What the new reader's dirty check hands `git status` (series 2 round 2), as
// `[{ top, specs }]`: one `git status` per repository. A shell `rm` word is checked
// in the repository that holds it (series 2 round 3: `rm ../locked/sub/c.txt` from a
// linked worktree is the primary's file to lose), found from its directory resolved
// on disk, symlinks included; a path in no repository is no repository's to lose.
// `rm`'s words are quoted for git — a glob as `:(glob)` (`*` stops at `/`, as in bash),
// any other word `:(literal)`, so `:!a.txt` cannot exclude what bash removes. Any other
// command's words (git's own pathspecs) go to the cwd's repository as written, those
// inside it only: git fails on the others, and does not remove them.
function pathspecsIn(cwd, check) {
  const fileOf = (word) => path.resolve(cwd, word.replace(/^~(?=\/|$)/, os.homedir()));
  if (check.removal !== "shell") {
    const repo = gitDirOf(cwd);
    if (!repo) {
      return [];
    }
    const inside = (word) => {
      const rel = path.relative(repo.top, fileOf(word));
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    };
    const specs = check.paths.filter((word) => word.startsWith(":") || inside(word));
    return specs.length ? [{ top: cwd, specs }] : [];
  }
  const groups = new Map();
  const real = new Map(); // one realpath and one repository lookup per directory
  const repoOf = (dir) => {
    if (!real.has(`repo:${dir}`)) {
      const repo = gitDirOf(dir);
      real.set(`repo:${dir}`, repo && realOrSame(repo.top));
    }
    return real.get(`repo:${dir}`);
  };
  for (const word of check.paths) {
    const file = onDisk(cwd, word.replace(/^~(?=\/|$)/, os.homedir()), real);
    const top = repoOf(path.dirname(file));
    if (!top) {
      continue;
    }
    const rel = path.relative(top, file).split(path.sep).join("/") || ".";
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      continue;
    }
    if (!groups.has(top)) {
      groups.set(top, []);
    }
    groups.get(top).push(`${GLOB_WORD.test(word) ? ":(glob)" : ":(literal)"}${rel}`);
  }
  return [...groups].map(([top, specs]) => ({ top, specs }));
}

const realOrSame = (dir) => {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return path.resolve(dir);
  }
};

// Where the shell finds `word` from `cwd`: its directory resolved by the kernel
// (`link/..` is the link target's parent, not `.`) up to the first glob component;
// the rest as written. A directory that does not exist is resolved by its words.
function onDisk(cwd, word, memo = null) {
  const parts = word.split("/");
  const name = parts.pop();
  const globAt = parts.findIndex((part) => GLOB_WORD.test(part));
  const dirParts = globAt === -1 ? parts : parts.slice(0, globAt);
  const rest = globAt === -1 ? [name] : [...parts.slice(globAt), name];
  const joined = word.startsWith("/") ? dirParts.join("/") || "/" : [cwd, ...dirParts].join("/");
  if (!memo) {
    return path.join(realOrSame(joined), ...rest);
  }
  if (!memo.has(`dir:${joined}`)) {
    memo.set(`dir:${joined}`, realOrSame(joined));
  }
  return path.join(memo.get(`dir:${joined}`), ...rest);
}

function gitDirOf(cwd) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const dotGit = path.join(dir, ".git");
    try {
      const stat = fs.statSync(dotGit);
      if (stat.isDirectory()) {
        return { top: dir, gitDir: dotGit };
      }
      const pointer = /^gitdir: (.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
      return pointer ? { top: dir, gitDir: path.resolve(dir, pointer[1].trim()) } : null;
    } catch {
      if (path.dirname(dir) === dir) {
        return null;
      }
    }
  }
}

function indexEntries(file) {
  const stat = fs.statSync(file, { bigint: true });
  const data = stat.size <= MAX_INDEX_BYTES ? fs.readFileSync(file) : null;
  if (!data || data.toString("latin1", 0, 4) !== "DIRC" || ![2, 3].includes(data.readUInt32BE(4))) {
    return null;
  }
  const entries = new Map();
  let at = 12;
  for (let n = data.readUInt32BE(8); n > 0; n -= 1) {
    const flags = data.readUInt16BE(at + 60);
    const extended = flags & 0x4000 ? 2 : 0;
    const nameAt = at + 62 + extended;
    const end = data.indexOf(0, nameAt);
    entries.set(data.toString("utf8", nameAt, end), { sec: data.readUInt32BE(at + 8), nsec: data.readUInt32BE(at + 12), size: data.readUInt32BE(at + 36), stage: (flags >> 12) & 3 });
    at += Math.ceil((end - at + 1) / 8) * 8;
  }
  // A split index (`link`) or a sparse one (`sdir`) keeps entries elsewhere: not read.
  for (; at + 8 <= data.length - 20; at += 8 + data.readUInt32BE(at + 4)) {
    if (["link", "sdir"].includes(data.toString("latin1", at, at + 4))) {
      return null;
    }
  }
  return { entries, mtime: stat.mtimeNs };
}

function indexHolds(cwd, paths) {
  if (paths.some((word) => GLOB_WORD.test(word))) {
    return false; // a glob is the shell's: git reads it as a pathspec
  }
  if (paths.some((word) => word.startsWith("~"))) {
    return false; // the shell's home, not a directory named `~`
  }
  try {
    const base = realOrSame(cwd);
    const repo = gitDirOf(base);
    const index = repo && indexEntries(path.join(repo.gitDir, "index"));
    if (!index) {
      return false;
    }
    return paths.every((word) => {
      const file = path.resolve(base, word);
      if (onDisk(cwd, word) !== file) {
        return false; // through a symlinked directory (series 2 round 3): `git status` decides
      }
      const rel = path.relative(repo.top, file).split(path.sep).join("/");
      const stat = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
      if (!stat || rel.startsWith("..")) {
        return Boolean(!stat && !rel.startsWith(".."));
      }
      const entry = index.entries.get(rel);
      if (!entry) {
        return stat.isFile() || stat.isSymbolicLink();
      }
      const sec = Number(stat.mtimeNs / 1000000000n);
      const nsec = Number(stat.mtimeNs % 1000000000n);
      return entry.stage === 0 && stat.isFile() && entry.size === Number(stat.size) && entry.sec === sec && entry.nsec === nsec && stat.mtimeNs < index.mtime;
    });
  } catch {
    return false;
  }
}

// Whether a finding applies here, and what it would destroy now:
// `{ applies, detail }`, or `{ unchecked }` when the disk could not say.
function settle(finding, policy) {
  const check = finding.check;
  if (!check) {
    return { applies: true, detail: "" };
  }
  if (finding.cwd === null) {
    // Discarding all changes or cleaning destroys wherever it runs; a named path needs the directory.
    return check.kind === "changes" || check.kind === "clean" ? { applies: true, detail: "" } : { unchecked: DESTRUCTIVE_UNKNOWN_CWD };
  }
  if (check.kind === "primary") {
    const { out, issue } = gitNow(finding.cwd, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
    if (issue) {
      return { unchecked: issue };
    }
    const [gitDir, commonDir] = (out || "").split(/\r?\n/).filter(Boolean);
    if (!gitDir || !commonDir || path.resolve(gitDir) !== path.resolve(commonDir)) {
      return { applies: false };
    }
    const lock = primaryLock(policy, path.dirname(path.resolve(commonDir)));
    return { applies: lock.locked, detail: lock.unreadable ? ` (${POLICY_FILE} cannot be read, so the lock is kept)` : "" };
  }
  if (check.kind === "dirty") {
    if (check.paths.some((word) => EXPANDS.test(word))) {
      return { unchecked: DESTRUCTIVE_EXPANSION };
    }
    if (check.worktree && indexHolds(finding.cwd, check.paths)) {
      return { applies: false }; // a plain `rm` of files the index holds as they are: no spawn
    }
    const files = [];
    for (const { top, specs } of pathspecsIn(finding.cwd, check)) {
      const { out, issue } = gitNow(top, ["status", "--porcelain", "--untracked-files=no", "--", ...specs]);
      if (issue || out === null) {
        return { unchecked: issue || GIT_STATUS_FAILED }; // a git error is no answer, never "clean"
      }
      // `worktree`: only a change the index does not hold is lost (`rm` of a staged file).
      const lost = porcelainFiles(check.worktree ? out.split("\n").filter((line) => line[1] !== " ").join("\n") : out);
      // A shell removal's files are named from the cwd: one may be another repository's.
      const from = check.removal === "shell" ? realOrSame(finding.cwd) : null;
      files.push(...lost.map((file) => (from ? path.relative(from, path.join(top, file)) || file : file)));
    }
    // None: outside any repository, or nothing tracked and changed among the paths.
    return { applies: files.length > 0, detail: fileList(files) };
  }
  if (check.kind === "changes") {
    return { applies: true, detail: fileList(porcelainFiles(gitNow(finding.cwd, ["status", "--porcelain", "--untracked-files=no"]).out)) };
  }
  // clean: what `git clean -n` with the same flags lists.
  const flags = check.flags.map((letter) => `-${letter}`);
  const { out } = gitNow(finding.cwd, ["clean", "-n", ...flags, "--", ...check.paths.filter((word) => !EXPANDS.test(word))]);
  const files = (out || "").split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^Would remove /, ""));
  return { applies: true, detail: fileList(files) };
}

// A command line in a refusal is logged: no credential in a URL, no long word.
function shown(command) {
  const text = command.replace(/\/\/[^/\s@]+@/g, "//***@").split(" ").map((word) => (word.length > 60 ? `${word.slice(0, 57)}...` : word)).join(" ");
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

// A destructive command read inside code, an alias value or a file the line wrote
// (story 29-04): named whole, with where it was read. Unchecked, not refused —
// `standard` lets it run and says so, `strict` refuses it (UNPROVEN_NEXT, STRICT_NEXT).
const UNPROVEN_LEAD = "the line runs a destructive command the guard read inside code";
const UNPROVEN_NEXT = "ask the human before running it";
const isUnproven = (reason) => typeof reason === "string" && reason.startsWith(UNPROVEN_LEAD);

function unprovenReason(finding) {
  return `${UNPROVEN_LEAD} (${finding.form || finding.unproven}: \`${shown(finding.inner || finding.command)}\`, ${finding.rule})`;
}

function destructiveReason(finding, detail) {
  const now = detail ? ` (here: ${detail})` : "";
  return `\`${shown(finding.command)}\` is a destructive command (${finding.rule}): it destroys ${finding.destroys}${now}. Instead: ${finding.alternative}. A destructive step waits for the human: say what it would destroy and how to undo it, then ask. Only they can allow it (destructiveCommands, allowDestructive in ${POLICY_FILE}).`;
}

// An entry is the exact command, word by word; a last word `*` lets any more words
// follow, `~` included (`git clean -fdX -- build *`). `rm -rf node_modules` does not allow `rm -rf node_modules ~`.
function allowedByPolicy(entries, words) {
  return entries.some((entry) => {
    const expected = entry.trim().split(/\s+/);
    const open = expected[expected.length - 1] === "*";
    const fixed = open ? expected.slice(0, -1) : expected;
    return (open ? fixed.length <= words.length : fixed.length === words.length) && fixed.every((word, i) => word === words[i]);
  });
}

// `{ deny }` with the refusal, or `{ warnings }` (warn mode). An unsettled check
// joins `ctx.issues`: the call is unchecked unless something else refuses it.
// `deadline` (the 29-04 reader only): past it, what is left is unchecked — a line
// built to cost thousands of git probes fails closed. The same check on the same
// paths is answered once per call.
function judgeDestructive(ctx, { findings, unchecked }, deadline = Infinity) {
  const policy = ctx.scopes[0].policy;
  const answers = new Map();
  if (policy.destructiveCommands === "off") {
    return { warnings: [] };
  }
  for (const entry of unchecked) {
    if (!ctx.issues.includes(entry.reason)) {
      ctx.issues.push(entry.reason);
    }
  }
  const warnings = [];
  for (const finding of findings) {
    if (allowedByPolicy(policy.allowDestructive, finding.words)) {
      continue;
    }
    if (Date.now() > deadline) {
      if (!ctx.issues.includes(OUT_OF_TIME)) {
        ctx.issues.push(OUT_OF_TIME);
      }
      break;
    }
    const key = finding.check ? JSON.stringify([finding.cwd, finding.check]) : null;
    const settled = key !== null && answers.has(key) ? answers.get(key) : settle(finding, policy);
    if (key !== null) {
      answers.set(key, settled);
    }
    if (settled.unchecked) {
      if (!ctx.issues.includes(settled.unchecked)) {
        ctx.issues.push(settled.unchecked);
      }
      continue;
    }
    if (!settled.applies) {
      continue;
    }
    if (finding.unproven) {
      // Read in code or in a file run later (story 29-04): unchecked, not refused.
      const issue = unprovenReason(finding);
      if (!ctx.issues.includes(issue)) {
        ctx.issues.push(issue);
      }
      continue;
    }
    const ignored = policy.ignoredAllow.length ? ` (ignored allowDestructive entries, too broad: ${policy.ignoredAllow.map((entry) => JSON.stringify(entry)).join(", ")})` : "";
    const reason = destructiveReason(finding, settled.detail) + ignored;
    if (policy.destructiveCommands === "warn") {
      warnings.push(reason);
    } else {
      return { deny: { decision: "deny", reason, path: null } };
    }
  }
  return { warnings };
}

// The readers' cost is linear in the line (story 29-04, series 2 round 1): past
// 256 KB (UTF-8 bytes) the guard does not read it at all, so the hook cannot reach its
// 60 s timeout and fail open. Worst case measured at the cap, both readers: 6.4 s
// (plan.md, series 2 round 2). Refused, not unchecked: `standard` lets an unchecked call run, and a
// padded `rm -rf .git; # …` would then pass where 29-03 refused it.
const MAX_COMMAND_LENGTH = 256 * 1024;
const TOO_LONG = "this command is longer than the 256 KB the guard reads, so it is refused unread. Write the content with a write tool, or the script to a file, and run that.";

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

  if (command.length > MAX_COMMAND_LENGTH / 4 && Buffer.byteLength(command, "utf8") > MAX_COMMAND_LENGTH) {
    return { decision: "deny", reason: TOO_LONG, path: null };
  }

  const ctx = context(hook, root);
  gitBudget.spent = false;
  frozenJudge().gitBudget.spent = false;
  // The destructive check is settled first, and nothing after it can lose its
  // refusal: a later check that throws still returns it (review round 2).
  const destructiveIssues = [];
  const { reading, destructive } = strictestReading(command, ctx, destructiveIssues);
  try {
    return decideBashWrites(command, ctx, { reading, destructive, destructiveIssues }, caseInsensitive);
  } catch (error) {
    if (destructive.deny) {
      return destructive.deny;
    }
    throw error;
  }
}

// Story 29-04 (plan.md R4): two readers, the strictest wins. `destructive-29-03` is
// 29-03's reader frozen as it shipped; `destructive` adds what 29-04 reads. A refusal
// from either is a refusal, an unchecked from either is unchecked, and what either
// says the line touches is checked — so no later reader can weaken a 29-03 decision.
const OUT_OF_TIME = "the line costs the destructive-command reader more than its time budget";
const NEW_READER_BUDGET_MS = 3000;

function strictestReading(command, ctx, issues) {
  const started = Date.now();
  const frozen = readDestructiveSafely("frozen", command, ctx, issues, {});
  const judged = frozenJudge().judgeDestructive({ ...ctx, issues }, frozen);
  if (judged.deny) {
    return { reading: frozen, destructive: judged }; // refused as 29-03 refused it: the new reader adds nothing
  }
  const added = readDestructiveSafely("added", command, ctx, issues, { deadline: started + NEW_READER_BUDGET_MS });
  const extra = judgeDestructive({ ...ctx, issues }, added, started + NEW_READER_BUDGET_MS);
  keepCauses(issues);
  return {
    reading: { touched: [...frozen.touched, ...added.touched], substituted: [...frozen.substituted, ...added.substituted] },
    destructive: { deny: extra.deny, warnings: [...new Set([...(judged.warnings || []), ...(extra.warnings || [])])] },
  };
}

// The frozen reader words some unchecked reasons bare ("a git alias the guard could
// not resolve") where the new one adds the host's cause ("…: git did not answer in
// time"). The reason given is the first issue: a bare one gives way to its caused
// form, which says what to fix.
function keepCauses(issues) {
  const kept = [];
  for (const issue of issues) {
    const reason = issues.find((other) => other.startsWith(`${issue}: `)) || issue;
    if (!kept.includes(reason)) {
      kept.push(reason);
    }
  }
  issues.splice(0, issues.length, ...kept);
}

// 29-03's judging, frozen with its reader (series 2 round 2): its findings are settled
// by 3c90919's own code, so a rule added for the new reader cannot move them.
function frozenJudge() {
  const judge = require("./destructive-judge-29-03");
  judge.use(loadPolicy);
  return judge;
}

// What one destructive reader makes of the command; a reader that throws makes the call unchecked.
function readDestructiveSafely(which, command, ctx, issues, options) {
  try {
    const reader = which === "frozen" ? require("./destructive-29-03") : require("./destructive");
    return reader.readDestructive(command, { cwd: ctx.cwd, host: destructiveHost, ...options });
  } catch {
    issues.push("the destructive-command reader could not read this command");
    return { findings: [], unchecked: [], touched: [], substituted: [] };
  }
}

// A shell command writes the policy file blind: the guard cannot read what it
// changes, so it is refused like a blocked path (story 29-03). The scripts of
// `"$(…)"` and backticks are read too; after a `cd` their directory is unknown.
function shellBlockedPaths(policy) {
  return [...policy.blockedPaths, POLICY_FILE];
}

function shellWriteDenial(ctx, command, caseInsensitive, substituted) {
  const shellCtx = { ...ctx, scopes: ctx.scopes.map((scope) => ({ ...scope, policy: { ...scope.policy, blockedPaths: shellBlockedPaths(scope.policy) } })) };
  for (const { script, cwd } of [{ script: command, cwd: ctx.cwd }, ...substituted]) {
    const entries = readShellWrites(script, cwd || ctx.cwd, shellHost, { trees: true });
    if (cwd === null && entries.length) {
      ctx.issues.push("a write inside a command substitution after a cd: its directory is unknown");
      continue;
    }
    for (const entry of entries) {
      if (entry.unchecked) {
        ctx.issues.push(entry.unchecked);
        continue;
      }
      const found = judgeShellEntry(shellCtx, entry, caseInsensitive);
      if (found) {
        const policyFile = found.hit === POLICY_FILE && !ctx.scopes.some((scope) => scope.policy.blockedPaths.includes(POLICY_FILE));
        const reason = policyFile
          ? `this command writes ${found.relative}${viaNote(found, entry.target)}, the policy file: from a shell the guard cannot read what it changes in what the agent may destroy. Edit it with a write tool, or ask the human.`
          : denialFor(entry, found);
        return { decision: "deny", reason, path: found.relative };
      }
    }
  }
  return null;
}

function decideBashWrites(command, ctx, { reading, destructive, destructiveIssues }, caseInsensitive) {
  const written = shellWriteDenial(ctx, command, caseInsensitive, reading.substituted);
  if (written) {
    return written;
  }
  if (destructive.deny) {
    return destructive.deny;
  }

  const removal = touchesPolicyFile(ctx, reading.touched, caseInsensitive);
  if (removal) {
    return { decision: "deny", reason: removal, path: POLICY_FILE };
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

  for (const reason of destructiveIssues) {
    if (!ctx.issues.includes(reason)) {
      ctx.issues.push(reason);
    }
  }
  if (destructive.deny) {
    return destructive.deny;
  }
  const warned = destructive.warnings.length ? { warnings: destructive.warnings } : {};

  // A real failure (ELOOP, a git timeout) is named before a shell-reading limit:
  // `doctor` skips the limits, and `> "$X"; > loop/x` must not hide the ELOOP.
  if (ctx.issues.length) {
    return { decision: "unchecked", reason: ctx.issues.find((reason) => !isShellLimit(reason)) || ctx.issues[0], ...warned };
  }

  return { decision: "allow", reason: "no blocked write target or secret detected", ...warned };
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

// `destructiveCommands: "warn"`: the call goes ahead, and each destructive command
// it runs is said and kept — in its own file, since `denials.jsonl` means refused.
function recordWarnings({ root, hook, result }) {
  for (const warning of (result && result.warnings) || []) {
    recordEvent("guard-warnings.jsonl", { root, hook, result: { reason: warning, path: null } });
  }
}

// Appended to what the agent reads (never to the denial log). Observed on
// OpenCode: refused `.env`, a model wrote the same content to `env` instead. The
// guard cannot see intent, so it says it plainly to the one that can.
const AGENT_ADVICE =
  "Do not retry this under another name, path or tool to get around the guard: tell the user what was refused and why.";

function forAgent(reason) {
  return `${reason}${/[.!?]$/.test(reason) ? "" : "."} ${AGENT_ADVICE}`;
}

// What a refusal adds when the command was read inside code: as a destructive
// refusal does, what to do and who can lift it.
const STRICT_NEXT = `A destructive step waits for the human: say what it would destroy and how to undo it, then ask. Only they can allow it (destructiveCommands, allowDestructive in ${POLICY_FILE}).`;

// The line an unchecked call writes on stderr; the hosts that spawn the guard forward it.
function uncheckedLine(reason) {
  return `coding-flow guard: ${reason}; this write was NOT checked${isUnproven(reason) ? ` — ${UNPROVEN_NEXT}` : ""}\n`;
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

  const next = isUnproven(result.reason) ? `. ${STRICT_NEXT}` : "";
  return { decision: "deny", reason: `${STRICT_PREFIX} ${result.reason}${next}`, path: null };
}

// An allowed call: its warnings (warn mode) are said and kept; `--json` prints
// the decision. A warning carries no permission decision of its own, so the
// user's permission rules still apply.
function writeAllowed(result, { root, hook, json }) {
  const warnings = result.warnings || [];
  if (warnings.length) {
    recordWarnings({ root, hook, result });
    for (const warning of warnings) {
      process.stderr.write(`coding-flow guard: warning: ${warning}\n`);
    }
  }
  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
        reason: result.reason,
        ...(warnings.length ? { warnings, systemMessage: warnings.join("\n") } : {}),
      })}\n`,
    );
  } else if (warnings.length) {
    process.stdout.write(`${JSON.stringify({ systemMessage: warnings.map((warning) => `coding-flow guard: warning: ${warning}`).join("\n") })}\n`);
  }
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
    process.stderr.write(uncheckedLine(result.reason));
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

  writeAllowed(result, { root, hook, json: flags.has("--json") });
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
    recordWarnings({ root: roots[0], hook, result });

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

module.exports = { guardCommand, decide, evaluate, recordUnchecked, isShellLimit, shellWriteTargets, shellWrites, loadPolicy, destructivePolicy, effectiveDestructivePolicy, shellBlockedPaths };
