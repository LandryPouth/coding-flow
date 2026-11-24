"use strict";

// Provenance: who produced an evidence, on which commit, in which PR. Read-only,
// best-effort, NEVER fatal — outside a git repository we return git:null with a
// reason, gh absent → pr:null. Provenance enriches the evidence (verify/evidence)
// to make it auditable: "asserted != proven; anonymous != auditable".

const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

// Runs a command and returns trimmed stdout, or null on failure. No exception
// propagates: provenance must never break an evidence.
function tryExec(bin, args, cwd, env = undefined) {
  try {
    return execFileSync(bin, args, {
      cwd,
      env,
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
// commit), and moves the moment any source content changes. Untracked files
// (not ignored, outside `.coding-flow/`) are part of the snapshot, so creating or
// editing one moves the token and committing it does not. Outside git -> null.
const EVIDENCE_DIR = ".coding-flow";
// Where stories live (local storage, Spec Kit). Their prose is not the code a
// proof proves: `/flow-run` writes the story's Result and `## Status: done` right
// after its green verify, and counting that edit made every finished story stale.
// The verify cache keys on the story text itself instead (evidence.js).
const STORY_DIRS = ["epics", "specs", ".specify"];
const OUTSIDE_TOKEN = new Set([EVIDENCE_DIR, ...STORY_DIRS]);
const EXCLUDE_PATHSPECS = [...OUTSIDE_TOKEN].map((dir) => `:(exclude)${dir}`);

// The tree of the working tree's tracked content, or null. `stash create` comes
// first so existing tokens keep their value. It refuses a tree holding an
// intent-to-add entry (`git add -N`), and falling back to HEAD there would hide
// every uncommitted change; a throwaway copy of the index takes the same
// snapshot instead, never touching the real index.
function workingTreeTree(cwd, head) {
  // New files this work created are part of what was proven. Left out, the proof
  // went stale the moment they were committed (the tree grew), though nothing
  // had changed. Snapshotting them needs the throwaway index below.
  const untracked = tryExec("git", ["ls-files", "--others", "--exclude-standard", "--", ".", ...EXCLUDE_PATHSPECS], cwd);
  const stash = untracked ? null : tryExec("git", ["stash", "create"], cwd);

  if (stash !== null) {
    return gitField(cwd, ["rev-parse", `${stash.length > 0 ? stash : head}^{tree}`]);
  }

  const index = gitField(cwd, ["rev-parse", "--git-path", "index"]);

  if (!index) {
    return null;
  }

  let dir = null;

  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-flow-index-"));
    const tempIndex = path.join(dir, "index");
    fs.copyFileSync(path.resolve(cwd, index), tempIndex);
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };

    const stage = untracked ? ["add", "-A", "--", ".", ...EXCLUDE_PATHSPECS] : ["add", "-u"];

    if (tryExec("git", stage, cwd, env) === null) {
      return null;
    }

    const tree = tryExec("git", ["write-tree"], cwd, env);
    return tree && tree.length > 0 ? tree : null;
  } catch {
    return null;
  } finally {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

function computeTreeToken(cwd) {
  const head = gitField(cwd, ["rev-parse", "HEAD"]);

  if (!head) {
    return null;
  }

  const tree = workingTreeTree(cwd, head);

  if (!tree) {
    return null;
  }

  const listing = tryExec("git", ["ls-tree", tree], cwd);

  if (listing == null) {
    return null;
  }

  // Each line: "<mode> <type> <objectid>\t<name>". Drop the evidence and story dirs, then
  // hash the rest: any source change flips a subtree object id and the token.
  const source = listing
    .split(/\r?\n/)
    .filter((line) => line && !OUTSIDE_TOKEN.has(line.split("\t")[1]))
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

// The whole work tree as a git tree object, from the repository top (a write
// outside a project below the top is seen too), or null outside git. Ignored
// files are left out — except `.coding-flow/`, read whatever the project
// ignores: its run files, manifest and active story are what a fixer must never
// rewrite unseen. Verify writes its own evidence only after the second
// snapshot. A throwaway copy
// of the index takes it; the real index is never touched. Two snapshots
// compared with `changedPaths` say which files a command rewrote (story 19-05).
function workingTreeSnapshot(cwd) {
  const index = gitField(cwd, ["rev-parse", "--git-path", "index"]);

  if (!index) {
    return null;
  }

  let dir = null;

  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-flow-snapshot-"));
    const tempIndex = path.join(dir, "index");
    const realIndex = path.resolve(cwd, index);

    if (fs.existsSync(realIndex)) {
      fs.copyFileSync(realIndex, tempIndex);
    }

    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };

    if (tryExec("git", ["add", "-A", "--", ":/"], cwd, env) === null) {
      return null;
    }

    if (fs.existsSync(path.join(cwd, EVIDENCE_DIR)) && tryExec("git", ["add", "-A", "-f", "--", EVIDENCE_DIR], cwd, env) === null) {
      return null;
    }

    const tree = tryExec("git", ["write-tree"], cwd, env);
    return tree && tree.length > 0 ? tree : null;
  } catch {
    return null;
  } finally {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// Paths whose content differs between two snapshots, sorted, `/`-separated and
// relative to `cwd` (the project root, which may sit below the repository top:
// a path outside it reads `../…`); null when either snapshot or the diff is
// unavailable. Read untrimmed: a path may start or end with a space.
function changedPaths(cwd, before, after) {
  if (!before || !after) {
    return null;
  }

  if (before === after) {
    return [];
  }

  try {
    const listing = execFileSync("git", ["-c", "core.quotePath=false", "diff", "--no-renames", "--name-only", "-z", before, after], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const toProject = projectPathsFromTop(cwd);
    return listing.split("\0").filter(Boolean).map(toProject).sort();
  } catch {
    return null;
  }
}

// The bytes `file` (project-relative) holds in a snapshot tree; null when absent.
function snapshotBlob(cwd, tree, file) {
  try {
    return execFileSync("git", ["cat-file", "blob", `${tree}:./${file}`], { cwd, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// One digest of what `roots` (project-relative directories) hold in a snapshot
// tree, minus the paths `skip` names: the blob ids git already computed, so it
// costs no file read. Null when the tree cannot be listed.
function snapshotRootsDigest(cwd, tree, roots, skip = () => false) {
  const listing = tree ? tryExecRaw("git", ["ls-tree", "-r", "-z", tree, "--", ...roots], cwd) : null;

  if (listing === null) {
    return null;
  }

  const entries = listing.split("\0").filter((entry) => entry && !skip(entry.slice(entry.indexOf("\t") + 1)));
  return crypto.createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 40);
}

function tryExecRaw(bin, args, cwd) {
  try {
    return execFileSync(bin, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// Maps a path git names from the repository top to the project root's form
// (`../x` outside it): the one form every path verify prints is in.
function projectPathsFromTop(cwd) {
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r?\n$/, "");
  // Both sides resolved natively: /private/var on macOS, long names on Windows.
  return fromTop(fs.realpathSync.native(top), fs.realpathSync.native(cwd));
}

const fromTop = (top, root) => (file) => path.relative(root, path.join(top, file)).split(path.sep).join("/");

module.exports = {
  captureIdentity, currentTreeToken, workingTreeSnapshot, changedPaths, projectPathsFromTop, fromTop, snapshotBlob, snapshotRootsDigest,
};
