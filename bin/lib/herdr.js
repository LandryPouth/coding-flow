"use strict";

// Optional Herdr integration (https://herdr.dev), a terminal multiplexer for
// coding agents. Herdr's sidebar shows workspaces, not git worktrees: a
// worktree made with plain `git worktree add` stays invisible there until
// something opens it. When `ai-flow` runs inside Herdr, it opens each worktree
// it creates and closes the workspace of each worktree it removes.
//
// Zero dependencies, never required, never fatal: outside Herdr (no
// `HERDR_ENV=1`), with `AI_FLOW_HERDR=0`, or when the `herdr` binary is
// missing, slow or refuses, every function here does nothing and returns null.
// Coding Flow behaves exactly as it does without Herdr.

const { execFileSync } = require("child_process");
const path = require("path");

const { samePath } = require("./util");

const TIMEOUT_MS = 5000;

function herdrActive(env = process.env) {
  return env.HERDR_ENV === "1" && env.AI_FLOW_HERDR !== "0";
}

// One `herdr` call, JSON in and out. Any failure (binary missing, timeout,
// non-zero exit, unparsable output) is null: the caller carries on.
function runHerdr(args, env = process.env) {
  const bin = env.HERDR_BIN_PATH || "herdr";
  try {
    const out = execFileSync(bin, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: TIMEOUT_MS,
      env,
    });
    return out.trim() ? JSON.parse(out) : {};
  } catch {
    return null;
  }
}

// The sidebar label: the story number (`story-02-01`), or the worktree name.
function labelFor(dest) {
  const name = path.basename(dest);
  const story = /^story-\d+-\d+/.exec(name);
  return story ? story[0] : name;
}

// Opens the worktree as a Herdr workspace, linked to its repository, without
// taking the focus. Returns the workspace id, or null.
function herdrOpenWorktree({ root, dest, env = process.env }) {
  if (!herdrActive(env)) return null;
  const res = runHerdr(
    ["worktree", "open", "--cwd", root, "--path", dest, "--label", labelFor(dest), "--no-focus"],
    env,
  );
  return (res && res.result && res.result.workspace && res.result.workspace.workspace_id) || null;
}

// Closes the Herdr workspace open on this worktree, before the directory goes.
// Left open when a pane in it runs an agent, or when this process itself runs
// from that workspace: closing it would kill the agent doing the work.
// Returns { closed: id } | { kept: id, reason } | null (nothing open, or no Herdr).
function herdrCloseWorktree({ root, dest, env = process.env }) {
  if (!herdrActive(env)) return null;
  const list = runHerdr(["worktree", "list", "--cwd", root], env);
  const worktrees = (list && list.result && list.result.worktrees) || [];
  const entry = worktrees.find((w) => w.open_workspace_id && samePath(w.path, dest));
  if (!entry) return null;
  const id = entry.open_workspace_id;

  if (env.HERDR_WORKSPACE_ID === id) return { kept: id, reason: "this command runs from it" };
  const panes = runHerdr(["pane", "list"], env);
  const busy = ((panes && panes.result && panes.result.panes) || []).some((p) => p.workspace_id === id && p.agent);
  if (busy) return { kept: id, reason: "an agent runs in it" };

  return runHerdr(["workspace", "close", id], env) ? { closed: id } : null;
}

module.exports = { herdrActive, herdrOpenWorktree, herdrCloseWorktree, labelFor };
