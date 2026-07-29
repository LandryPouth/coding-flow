"use strict";

// Provenance: who produced an evidence, on which commit, in which PR. Read-only,
// best-effort, NEVER fatal — outside a git repository we return git:null with a
// reason, gh absent → pr:null. Provenance enriches the evidence (verify/evidence)
// to make it auditable: "asserted != proven; anonymous != auditable".

const os = require("os");
const crypto = require("crypto");
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

// Content token of the current *working tree* source, independent of whether the
// changes are committed yet. `git stash create` builds a commit of the dirty
// working tree WITHOUT touching refs, the index, or the working tree (it only
// writes loose objects); empty output means a clean tree, so we peel HEAD.
//
// We then hash the top-level tree listing MINUS `.coding-flow/` — the evidence
// home. That directory holds the outputs of verification (runs, ledger); letting
// it into the token would be absurd, since capturing or committing a proof would
// invalidate the very proof it records. Excluding it also makes the token immune
// to whether the run files are tracked or not.
//
// The key property: the token is content-addressed, so it is stable across the
// commit that materializes exactly what was verified (no false "stale" on
// commit), and moves the moment any source content changes. Untracked new files
// are not part of `stash create`, so they do not move the token (documented
// limitation). Outside git -> null.
const EVIDENCE_DIR = ".coding-flow";

function computeTreeToken(cwd) {
  const head = gitField(cwd, ["rev-parse", "HEAD"]);

  if (!head) {
    return null;
  }

  const stash = tryExec("git", ["stash", "create"], cwd);
  const ref = stash && stash.length > 0 ? stash : head;
  const tree = gitField(cwd, ["rev-parse", `${ref}^{tree}`]);

  if (!tree) {
    return null;
  }

  const listing = tryExec("git", ["ls-tree", tree], cwd);

  if (listing == null) {
    return null;
  }

  // Each line: "<mode> <type> <objectid>\t<name>". Drop the evidence dir, then
  // hash the rest: any source change flips a subtree object id and the token.
  const source = listing
    .split(/\r?\n/)
    .filter((line) => line && line.split("\t")[1] !== EVIDENCE_DIR)
    .join("\n");

  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 40);
}

// Recomputes the working-tree token for the current state, for freshness checks
// (status / audit --check). Same primitive stored in an evidence's provenance.
function currentTreeToken(cwd) {
  return computeTreeToken(cwd);
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
      // Content token of the working tree — binds a verify to the code it proved
      // so a later edit makes the proof "stale" instead of silently current.
      treeToken: computeTreeToken(cwd),
    },
    pr: capturePr(cwd),
    host,
  };
}

module.exports = { captureIdentity, currentTreeToken };
