"use strict";

// FROZEN: how 29-03's guard judged what its destructive reader found, exactly as
// shipped at 3c90919 (story 29-04, series 2 review round 2). The findings of
// destructive-29-03.js are settled here and nowhere else, so nothing this story
// adds — a pathspec rule, a fast path, a budget — touches 29-03's side from the
// reading to the decision. Do not edit between the markers: each block is
// 3c90919's bin/lib/guard.js lines, pinned by a hash in test/guard-evasion.test.js.
// What is not 3c90919's: the requires, `use` and the export below.

const path = require("path");
const { execFileSync } = require("child_process");

// The policy loader is guard.js's own (it reads harness.json): handed in, not required,
// so this module does not load the guard.
let loadPolicy = null;
const use = (loader) => {
  loadPolicy = loader;
};

// --- 3c90919 bin/lib/guard.js:789 ---
const POLICY_FILE = ".coding-flow/harness.json";
// --- 3c90919 bin/lib/guard.js:792-793 ---
const DESTRUCTIVE_EXPANSION = "a destructive-command check depends on shell expansion";
const DESTRUCTIVE_UNKNOWN_CWD = "a destructive-command check depends on a working directory set by shell expansion";
// --- 3c90919 bin/lib/guard.js:1129-1275 ---
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
    // Locked by the policy the call runs under, or by the primary checkout's own
    // (`git -C <primary> switch` from a linked worktree).
    // A policy file that cannot be read keeps the lock: `chmod 000` or a broken
    // edit must not open the primary checkout.
    const own = loadPolicy(path.dirname(path.resolve(commonDir)));
    const unreadable = policy.unreadable || own.unreadable;
    return { applies: policy.primaryLocked || own.primaryLocked || unreadable, detail: unreadable ? ` (${POLICY_FILE} cannot be read, so the lock is kept)` : "" };
  }
  if (check.kind === "dirty") {
    if (check.paths.some((word) => EXPANDS.test(word))) {
      return { unchecked: DESTRUCTIVE_EXPANSION };
    }
    const { out, issue } = gitNow(finding.cwd, ["status", "--porcelain", "--untracked-files=no", "--", ...check.paths]);
    if (issue) {
      return { unchecked: issue };
    }
    const files = porcelainFiles(out);
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
function judgeDestructive(ctx, { findings, unchecked }) {
  const policy = ctx.scopes[0].policy;
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
    const settled = settle(finding, policy);
    if (settled.unchecked) {
      if (!ctx.issues.includes(settled.unchecked)) {
        ctx.issues.push(settled.unchecked);
      }
      continue;
    }
    if (!settled.applies) {
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
// --- end of 3c90919 ---

module.exports = { use, judgeDestructive, gitBudget };
