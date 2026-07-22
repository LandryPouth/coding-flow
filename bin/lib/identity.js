"use strict";

// Provenance : qui a produit une évidence, sur quel commit, dans quelle PR. Pur
// lecture, best-effort, JAMAIS fatal — hors dépôt git on renvoie git:null avec une
// raison, gh absent → pr:null. La provenance enrichit l'évidence (verify/evidence)
// pour la rendre auditable : "asserted ≠ proven ; anonymous ≠ auditable".

const os = require("os");
const { execFileSync } = require("child_process");

// Exécute une commande et renvoie stdout trimmé, ou null en cas d'échec. Aucune
// exception ne remonte : la provenance ne doit jamais casser une évidence.
function tryExec(bin, args, cwd) {
  try {
    return execFileSync(bin, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function gitField(cwd, args) {
  const value = tryExec("git", args, cwd);
  return value && value.length > 0 ? value : null;
}

// Auteur : d'abord la config locale (user.name/email), sinon l'auteur du dernier
// commit — un dépôt fraîchement cloné n'a pas toujours de config locale.
function captureAuthor(cwd) {
  const name = gitField(cwd, ["config", "user.name"]) || gitField(cwd, ["log", "-1", "--format=%an"]);
  const email = gitField(cwd, ["config", "user.email"]) || gitField(cwd, ["log", "-1", "--format=%ae"]);

  if (!name && !email) {
    return null;
  }

  return { name: name || null, email: email || null };
}

// PR courante, best-effort. gh absent, non authentifié, ou pas de PR → null.
function capturePr(cwd) {
  const raw = tryExec("gh", ["pr", "view", "--json", "number,url"], cwd);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed.number === "number") {
      return { number: parsed.number, url: parsed.url || null };
    }
  } catch {
    return null;
  }

  return null;
}

function captureHost() {
  let user = null;

  try {
    user = os.userInfo().username || null;
  } catch {
    user = null;
  }

  return { user, platform: process.platform };
}

// Snapshot de provenance pour le dépôt courant. Renvoie toujours un objet ; les
// sous-parties indisponibles sont null (jamais d'exception, jamais d'exit).
function captureIdentity(cwd) {
  const capturedAt = new Date().toISOString();
  const host = captureHost();
  const commit = gitField(cwd, ["rev-parse", "HEAD"]);

  if (!commit) {
    return {
      capturedAt,
      git: null,
      gitReason: "not a git repository or no commits yet",
      pr: null,
      host,
    };
  }

  const branch = gitField(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = tryExec("git", ["status", "--porcelain"], cwd);

  return {
    capturedAt,
    git: {
      commit,
      shortCommit: commit.slice(0, 7),
      branch: branch && branch !== "HEAD" ? branch : null,
      author: captureAuthor(cwd),
      dirty: porcelain != null && porcelain.length > 0,
      remote: gitField(cwd, ["remote", "get-url", "origin"]),
    },
    pr: capturePr(cwd),
    host,
  };
}

module.exports = { captureIdentity };
