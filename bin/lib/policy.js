"use strict";

// Policy "one epic = one branch, never on main". It is a decision recorded in
// .coding-flow/config.json (branchPerEpic), not a hard-coded wall: commands
// surface it (e.g. status), they don't block a repo that legitimately commits on
// main. Same spirit as the ship guardrail.

const { execFileSync } = require("child_process");

const { readConfig } = require("./config");

function gitOut(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function currentBranch(cwd) {
  const branch = gitOut(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? branch : null;
}

function defaultBranch(cwd) {
  const symbolic = gitOut(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic) {
    return symbolic.replace("refs/remotes/origin/", "");
  }
  return "main";
}

// Evaluates the branchPerEpic policy for the current repo. Never touches the
// repo, pure read. Returns enough to show a warning without deciding on the
// user's behalf.
function evaluateBranchPolicy(cwd, config = null) {
  const cfg = config || readConfig(cwd);

  if (!cfg.branchPerEpic) {
    return { enforced: false, branch: null, onBase: false, bases: [] };
  }

  const branch = currentBranch(cwd);

  if (!branch) {
    return { enforced: true, branch: null, onBase: false, bases: [] };
  }

  const bases = [...new Set(["main", "master", defaultBranch(cwd)])];

  return {
    enforced: true,
    branch,
    onBase: bases.includes(branch),
    bases,
  };
}

module.exports = { evaluateBranchPolicy, currentBranch, defaultBranch };
