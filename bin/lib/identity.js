"use strict";

// Provenance: who produced an evidence, on which commit, in which PR. Read-only,
// best-effort, NEVER fatal — outside a git repository we return git:null with a
// reason, gh absent → pr:null. Provenance enriches the evidence (verify/evidence)
// to make it auditable: "asserted != proven; anonymous != auditable".

const os = require("os");
const { execFileSync } = require("child_process");

// Runs a command and returns trimmed stdout, or null on failure. No exception
// propagates: provenance must never break an evidence.
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

// Author: first the local config (user.name/email), otherwise the author of the
// last commit — a freshly cloned repo does not always have a local config.
function captureAuthor(cwd) {
  const name = gitField(cwd, ["config", "user.name"]) || gitField(cwd, ["log", "-1", "--format=%an"]);
  const email = gitField(cwd, ["config", "user.email"]) || gitField(cwd, ["log", "-1", "--format=%ae"]);

  if (!name && !email) {
    return null;
  }

  return { name: name || null, email: email || null };
}

// Current PR, best-effort. gh absent, not authenticated, or no PR → null.
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

// Provenance snapshot for the current repository. Always returns an object; the
// unavailable sub-parts are null (never an exception, never an exit).
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
