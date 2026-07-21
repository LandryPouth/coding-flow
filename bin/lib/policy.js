"use strict";

// Policy "une epic = une branche, jamais sur main". C'est une decision retenue
// dans .coding-flow/config.json (branchPerEpic), pas un mur code en dur : les
// commandes la font remonter (ex. status), elles ne bloquent pas un repo qui
// committe legitimement sur main. Meme esprit que le garde-fou de ship.

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

// Evalue la policy branchPerEpic pour le repo courant. Ne touche jamais au repo,
// pure lecture. Renvoie de quoi afficher un avertissement sans decider a la
// place de l'utilisateur.
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
