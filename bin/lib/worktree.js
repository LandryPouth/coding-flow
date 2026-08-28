"use strict";

// Optional Git worktree support for parallel work.
//
// Subcommands, all non-destructive by default:
//   ai-flow worktree add <name> [--from <ref>] [--deps install|link|skip] [--dry-run]
//   ai-flow worktree list
//   ai-flow worktree remove <name> [--force] [--dry-run]
//   ai-flow worktree lock --story <dir>
//   ai-flow worktree unlock [--story <dir>] [--force]
//   ai-flow worktree land <name>|--story <dir>
//
// Project constraints: zero dependencies (only Node's built-in modules and the
// `git` binary), Node >= 18. We shell out to git rather than reimplementing its
// plumbing; git is a prerequisite anyway.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { hasStoryContent } = require("./story");
const { readJson, writeJson } = require("./util");
const { readConfig } = require("./config");
const { getStorage } = require("./storage");
const { latestVerifyByStoryDir, isStale } = require("./audit");
const { currentTreeToken } = require("./identity");
const { verifyStoryOnce, writeVerifyEvidence, printVerify } = require("./harness");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

// Run git in `cwd`. By default captures stdout/stderr and fails cleanly.
// allowFail: returns { code, stdout, stderr } without exiting.
// inherit: lets git write directly to the terminal (installs, progress).
function git(cwd, gitArgs, { allowFail = false, inherit = false } = {}) {
  try {
    const stdout = execFileSync("git", gitArgs, {
      cwd,
      encoding: "utf8",
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout: stdout || "" };
  } catch (err) {
    const stderr = (err.stderr || err.stdout || err.message || "").toString();
    if (allowFail) {
      return { code: err.status ?? 1, stdout: (err.stdout || "").toString(), stderr };
    }
    fail(`git ${gitArgs.join(" ")} failed: ${stderr.trim()}`);
    return { code: 1, stdout: "", stderr };
  }
}

// git present + we are actually inside a repository. Returns the working tree root.
function requireRepo(cwd) {
  if (git(cwd, ["--version"], { allowFail: true }).code !== 0) {
    fail("git was not found in PATH.");
  }
  const root = git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (root.code !== 0) {
    fail("this directory is not a git repository (git rev-parse failed).");
  }
  return root.stdout.trim();
}

function assertName(name) {
  if (!name) {
    fail('missing name. Example: ai-flow worktree add feat/payments');
  }
  if (name.startsWith("-") || name.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(name)) {
    fail(`invalid name: "${name}". Allowed characters: letters, digits, . _ / -`);
  }
}

// Grouped location: ../<repo>-worktrees/<name>, to keep the parent directory
// clean instead of scattering siblings.
function worktreeDest(root, name) {
  const base = path.basename(root);
  return path.join(path.dirname(root), `${base}-worktrees`, name);
}

// Resolves a story path (epics/<epic>/story-...) passed via --story. The
// branch/worktree takes the name of the story directory, which makes the
// worktree<->story mapping deterministic and stateless (see status).
function resolveStory(root, cwd, story) {
  const full = path.resolve(cwd, story);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    fail(`the story must be inside the repository: ${story}`);
  }
  if (!isDir(full)) {
    fail(`story not found (a directory is expected): ${story}`);
  }
  return {
    fullPath: full,
    name: path.basename(full),
    rel: rel.split(path.sep).join("/"),
    hasStoryFile: hasStoryContent(full),
  };
}

const ENV_FILES = [".env", ".env.local"];
// Links this command creates itself in a worktree. We exclude them from the
// "dirty working tree" check (they are not uncommitted work) and we remove them
// before `git worktree remove` so the deletion is not blocked when those paths
// are not gitignored.
const MANAGED_LINKS = [...ENV_FILES, "node_modules"];

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// lstatSync that does not throw (also detects broken links).
function lstatSafe(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// Creates an idempotent link from srcAbs to linkAbs (no copy).
// - already exists: we touch nothing.
// - directory on Windows: junction (more reliable than a private symlink).
// - otherwise: relative symlink, which survives a move of the parent.
function makeLink(srcAbs, linkAbs) {
  if (fs.existsSync(linkAbs) || lstatSafe(linkAbs)) {
    return "kept";
  }
  fs.mkdirSync(path.dirname(linkAbs), { recursive: true });
  const directory = isDir(srcAbs);
  if (process.platform === "win32" && directory) {
    fs.symlinkSync(srcAbs, linkAbs, "junction");
  } else {
    const target = path.relative(path.dirname(linkAbs), srcAbs);
    fs.symlinkSync(target, linkAbs, directory ? "dir" : "file");
  }
  return "linked";
}

function detectPackageManager(root) {
  const has = (f) => fs.existsSync(path.join(root, f));
  let pm = null;
  if (has("pnpm-lock.yaml")) pm = "pnpm";
  else if (has("yarn.lock")) pm = "yarn";
  else if (has("package-lock.json")) pm = "npm";
  else if (has("package.json")) pm = "npm";

  let workspace = has("pnpm-workspace.yaml");
  if (!workspace && has("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      workspace = Boolean(pkg.workspaces);
    } catch {
      // unreadable package.json: ignore, workspace stays false.
    }
  }
  return { pm, workspace };
}

// Decides what to do with node_modules. Symlinking node_modules is safe for a
// simple project (npm) but BREAKS a pnpm/yarn monorepo (virtual store tied to
// the workspace root): in that case we install instead.
//
// `pm === null` means detectPackageManager found no JS signal at all (no
// package.json, no lockfile) — a Go/Rust/Python project opened with this tool.
// That used to fall through to "recommend-install" and print "npm install" as
// if this were a JS repo with no node_modules yet. `unknown` names what we
// actually know: nothing, so we say nothing prescriptive.
function resolveDepsStrategy(explicit, { pm, workspace }, hasNodeModules) {
  if (explicit) {
    if (!["install", "link", "skip"].includes(explicit)) {
      fail(`invalid --deps: "${explicit}". Values: install, link, skip.`);
    }
    return explicit;
  }
  if (pm === null) return "unknown";
  if (workspace || pm === "pnpm" || pm === "yarn") return "recommend-install";
  if (hasNodeModules) return "link";
  return "recommend-install";
}

// null when no JS package manager was detected — the caller must not default
// to npm just because it needs to print something.
function installCommand(pm) {
  if (pm === "pnpm") return "pnpm install";
  if (pm === "yarn") return "yarn install";
  if (pm === "npm") return "npm install";
  return null;
}

// quiet: suppresses every progress line this function (and applyDeps) would
// otherwise print — for a caller that presents its own summary instead (e.g.
// worktree-plan.js's decidePlacement, whose CLI wrapper prints a consolidated
// placement summary, and whose --json output must be the only thing on
// stdout). git errors and deps-install failures still surface via `fail`/
// stderr regardless of `quiet`.
function worktreeAdd(name, { from, deps, dryRun, cwd, story, quiet }) {
  const root = requireRepo(cwd);
  let linkedStory = null;

  if (story) {
    linkedStory = resolveStory(root, cwd, story);
    if (name && name !== linkedStory.name) {
      fail(
        `name conflict: "${name}" vs story "${linkedStory.name}". ` +
          "Give either <name> or --story, but not both with different names.",
      );
    }
    name = linkedStory.name;
  }

  assertName(name);
  const dest = worktreeDest(root, name);

  if (fs.existsSync(dest)) {
    fail(`target already exists: ${dest}`);
  }

  const branchExists =
    git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { allowFail: true }).code === 0;

  const addArgs = ["worktree", "add"];
  if (branchExists) {
    addArgs.push(dest, name);
  } else {
    addArgs.push(dest, "-b", name);
    if (from) addArgs.push(from);
  }

  const { pm, workspace } = detectPackageManager(root);
  const hasNodeModules = isDir(path.join(root, "node_modules"));
  const strategy = resolveDepsStrategy(deps, { pm, workspace }, hasNodeModules);
  const envToLink = ENV_FILES.filter((f) => fs.existsSync(path.join(root, f)));

  if (dryRun) {
    if (!quiet) {
      log("Dry run — nothing is written.");
      log(`  worktree : git ${addArgs.join(" ")}`);
      log(`  branch   : ${branchExists ? `${name} (existing)` : `${name} (new, from ${from || "HEAD"})`}`);
      if (linkedStory) log(`  story    : ${linkedStory.rel}${linkedStory.hasStoryFile ? "" : " (no story content)"}`);
      for (const f of envToLink) log(`  link     : ${f}`);
      log(`  deps     : ${describeStrategy(strategy, pm, hasNodeModules)}`);
    }
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  git(root, addArgs);
  if (!quiet) {
    log(`Worktree created: ${dest}`);
    log(`Branch: ${name}${branchExists ? " (existing)" : ""}`);
    if (linkedStory) {
      log(`Story linked: ${linkedStory.rel}${linkedStory.hasStoryFile ? "" : " (no story content)"}`);
    }
  }

  for (const f of envToLink) {
    const status = makeLink(path.join(root, f), path.join(dest, f));
    if (!quiet) log(`  ${status} ${f}`);
  }

  applyDeps(strategy, { pm, root, dest, hasNodeModules, quiet });

  if (!quiet) {
    log("");
    log("Next step:");
    log(`  cd ${path.relative(cwd, dest) || dest}`);
    if (linkedStory) {
      log(`  ai-flow harness preflight --story ${linkedStory.rel}`);
    }
  }

  return { path: dest, branch: name, root };
}

function describeStrategy(strategy, pm, hasNodeModules) {
  if (strategy === "link") return "symlink node_modules";
  if (strategy === "install") return `${installCommand(pm) || `${pm || "npm"} install`} in the worktree`;
  if (strategy === "skip") return "skipped (--deps skip)";
  if (strategy === "unknown") return "no known JS package manager detected — install this project's dependencies manually";
  return `to install (${installCommand(pm)}) — monorepo/pnpm, symlink not advised`;
}

function applyDeps(strategy, { pm, root, dest, hasNodeModules, quiet }) {
  if (strategy === "skip" || strategy === "unknown") return;

  if (strategy === "link") {
    if (!hasNodeModules) {
      if (!quiet) {
        log(`  node_modules absent at the root — nothing to link, run: ${installCommand(pm) || `${pm || "npm"} install`}`);
      }
      return;
    }
    const status = makeLink(path.join(root, "node_modules"), path.join(dest, "node_modules"));
    if (!quiet) log(`  ${status} node_modules`);
    return;
  }

  if (strategy === "install") {
    const bin = pm || "npm";
    if (!quiet) log(`  ${installCommand(pm) || `${bin} install`} ...`);
    try {
      // quiet: still surfaces on stderr (errors stay visible) but keeps
      // stdout free for a caller whose own output must be machine-parseable
      // (e.g. `ai-flow worktree place --json`).
      execFileSync(bin, ["install"], { cwd: dest, stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit" });
    } catch {
      if (!quiet) log(`  "${installCommand(pm) || `${bin} install`}" failed — rerun it manually in the worktree.`);
    }
    return;
  }

  // recommend-install
  if (!quiet) log(`  deps : run "${installCommand(pm)}" in the worktree (symlink not advised for this project).`);
}

function parseWorktrees(root) {
  return parseWorktreesFrom(git(root, ["worktree", "list", "--porcelain"]).stdout);
}

// Pure parser of `git worktree list --porcelain` output (no I/O).
function parseWorktreesFrom(out) {
  const blocks = out.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const entry = { path: null, head: null, branch: null, detached: false, bare: false };
    for (const line of block.split(/\n/)) {
      if (line.startsWith("worktree ")) entry.path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) entry.head = line.slice("HEAD ".length, "HEAD ".length + 7);
      else if (line.startsWith("branch ")) entry.branch = line.slice("branch ".length).replace("refs/heads/", "");
      else if (line === "detached") entry.detached = true;
      else if (line === "bare") entry.bare = true;
    }
    return entry;
  });
}

function worktreeList({ cwd }) {
  const root = requireRepo(cwd);
  const entries = parseWorktrees(root);
  if (entries.length === 0) {
    log("No worktrees.");
    return;
  }
  for (const e of entries) {
    const label = e.bare ? "(bare)" : e.detached ? `(detached @${e.head})` : e.branch || "(?)";
    const links = ENV_FILES.filter((f) => lstatSafe(path.join(e.path, f))).join(", ");
    const suffix = links ? `  links: ${links}` : "";
    log(`${label.padEnd(24)} ${e.path}${suffix}`);
  }
}

// `git status --porcelain` lines excluding our managed links: what remains is
// real work (modified tracked files, or unmanaged files).
function realDirtyLines(wtPath) {
  return git(wtPath, ["status", "--porcelain"], { allowFail: true })
    .stdout.split("\n")
    .filter(Boolean)
    .filter((line) => {
      const p = line.slice(3).replace(/\/$/, "").replace(/^"|"$/g, "");
      return !MANAGED_LINKS.includes(p);
    });
}

// Removes only the symlinks we laid down ourselves (never a real file).
function removeManagedLinks(wtPath) {
  for (const name of MANAGED_LINKS) {
    const p = path.join(wtPath, name);
    const st = lstatSafe(p);
    if (st && st.isSymbolicLink()) {
      fs.unlinkSync(p);
    }
  }
}

function worktreeRemove(name, { force, dryRun, cwd }) {
  assertName(name);
  const root = requireRepo(cwd);
  const dest = worktreeDest(root, name);

  const entries = parseWorktrees(root);
  const match =
    entries.find((e) => e.path === dest) ||
    entries.find((e) => path.basename(e.path) === name) ||
    entries.find((e) => e.branch === name);

  if (!match) {
    fail(`worktree not found for "${name}". See: ai-flow worktree list`);
  }

  // git worktree remove KEEPS the branch: no commit is lost. The only real risk
  // is uncommitted work (dirty working tree) — excluding our own links.
  const dirty = realDirtyLines(match.path);
  if (dirty.length && !force) {
    fail(
      `worktree "${name}" has uncommitted changes. ` +
        "Commit/stash first, or force with --force (uncommitted changes will be lost).",
    );
  }

  if (dryRun) {
    log("Dry run — nothing is removed.");
    log(`  managed links removed: ${MANAGED_LINKS.join(", ")}`);
    log(`  git worktree remove ${force ? "--force " : ""}${match.path}`);
    log("  git worktree prune");
    log(`  branch ${match.branch || name}: kept`);
    return;
  }

  // We remove our symlinks first, otherwise git worktree remove may refuse
  // because of untracked files when those paths are not gitignored.
  removeManagedLinks(match.path);

  const removeArgs = ["worktree", "remove"];
  if (force) removeArgs.push("--force");
  removeArgs.push(match.path);
  git(root, removeArgs);
  git(root, ["worktree", "prune"]);

  log(`Worktree removed: ${match.path}`);
  if (match.branch) {
    log(`Branch kept: ${match.branch} (git branch -D ${match.branch} to delete it).`);
  }
}

// Non-fatal worktree listing, usable outside the worktree context (e.g.
// `status`). Never exits: returns { isRepo:false, entries:[] } if git is absent
// or we are not inside a repository, instead of killing the process.
function collectWorktrees(cwd) {
  if (git(cwd, ["--version"], { allowFail: true }).code !== 0) {
    return { isRepo: false, root: null, entries: [] };
  }
  const root = git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (root.code !== 0) {
    return { isRepo: false, root: null, entries: [] };
  }
  const repoRoot = root.stdout.trim();
  const list = git(repoRoot, ["worktree", "list", "--porcelain"], { allowFail: true });
  if (list.code !== 0) {
    return { isRepo: true, root: repoRoot, entries: [] };
  }
  return { isRepo: true, root: repoRoot, entries: parseWorktreesFrom(list.stdout) };
}

// The lock is scoped to the checkout it is written in: a worktree created by
// `worktreeAdd` gets its own `.coding-flow/`, so this is naturally per-checkout
// with no extra plumbing.
const LOCK_GITIGNORE_LINE = ".coding-flow/active-story.json";

function activeStoryLockPath(root) {
  return path.join(root, ".coding-flow", "active-story.json");
}

// Whether an existing .gitignore line already covers the lock file — the exact
// line, or a directory pattern for `.coding-flow` broad enough to include it.
// Not a general gitignore engine: just the shapes this one file can plausibly
// already be covered by.
function gitignoreCoversLockFile(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => {
      if (!line || line.startsWith("#")) return false;
      const pattern = line.replace(/\/$/, "");
      return pattern === LOCK_GITIGNORE_LINE || pattern === ".coding-flow" || pattern === ".coding-flow/*";
    });
}

// Idempotently ensures the lock file is gitignored. It is runtime state, not
// proof — unlike everything else already living under the tracked
// `.coding-flow/` (runs/*.json, config.json) — so it must never be committed.
// Mirrors harness.js's non-fatal spirit for a missing .gitignore: create one
// rather than failing the lock over it.
function ensureLockIgnored(root) {
  const gitignorePath = path.join(root, ".gitignore");
  const content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";

  if (gitignoreCoversLockFile(content)) {
    return;
  }

  const withNewline = content.length && !content.endsWith("\n") ? `${content}\n` : content;
  fs.writeFileSync(gitignorePath, `${withNewline}${LOCK_GITIGNORE_LINE}\n`);
}

function worktreeLock(story, { cwd }) {
  const root = requireRepo(cwd);
  if (!story) {
    fail("missing --story. Example: ai-flow worktree lock --story epics/epic-01-x/story-01-01-y");
  }
  const resolved = resolveStory(root, cwd, story);
  ensureLockIgnored(root);

  const lockPath = activeStoryLockPath(root);
  const existing = readJson(lockPath, null);

  if (existing && existing.story === resolved.rel) {
    log(`Already locked: ${resolved.rel}`);
    return;
  }

  if (existing && existing.story) {
    fail(
      `checkout is occupied by "${existing.story}". Finish or isolate that story first, ` +
        `or start this one in its own worktree: ai-flow worktree add --story ${resolved.rel}`,
    );
  }

  writeJson(lockPath, { story: resolved.rel, startedAt: new Date().toISOString() });
  log(`Locked: ${resolved.rel}`);
}

function worktreeUnlock({ cwd, story, force }) {
  const root = requireRepo(cwd);
  const lockPath = activeStoryLockPath(root);
  const existing = readJson(lockPath, null);

  if (!existing) {
    log("No active lock.");
    return;
  }

  if (story && !force) {
    const resolved = resolveStory(root, cwd, story);
    if (existing.story !== resolved.rel) {
      fail(
        `lock belongs to "${existing.story}", not "${resolved.rel}". ` +
          "Use --force to clear it anyway.",
      );
    }
  }

  fs.unlinkSync(lockPath);
  log(`Unlocked: ${existing.story}`);
}

// Maps a worktree/story branch name to its story + epic, the same way
// `ship.js`'s `findStoryAndEpic` does (worktrees are named after their story
// dir — see `resolveStory`). Best effort: a branch with no matching story
// (custom name, no epics/ at all) simply isn't linked to one.
function findStoryForBranch(root, branch) {
  try {
    const config = readConfig(root);
    for (const epic of getStorage(root, config).listEpics()) {
      const story = epic.stories.find((s) => s.name === branch);
      if (story) {
        return { epic, story };
      }
    }
  } catch {
    // best-effort only — never block land on a storage read failure beyond
    // the "not linked to a known story" refusal that follows.
  }
  return null;
}

// `git status --porcelain` unmerged codes (mid-rebase/mid-merge conflict).
const UNMERGED_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function conflictingFiles(wtPath) {
  return git(wtPath, ["status", "--porcelain"], { allowFail: true })
    .stdout.split("\n")
    .filter(Boolean)
    .filter((line) => UNMERGED_STATUSES.has(line.slice(0, 2)))
    .map((line) => line.slice(3).replace(/^"|"$/g, ""));
}

// Clears the story's lock (if any), removes the worktree, and deletes its
// branch — mirrors `worktreeRemove`'s cleanup sequence, plus the lock. The
// lock lives inside the story worktree's own checkout, so it must be cleared
// BEFORE the worktree directory disappears.
function landCleanup(root, match, branch) {
  worktreeUnlock({ cwd: match.path, force: true });
  removeManagedLinks(match.path);
  git(root, ["worktree", "remove", match.path]);
  git(root, ["worktree", "prune"]);
  if (branch) {
    git(root, ["branch", "-D", branch], { allowFail: true });
  }
}

// Reconciles a finished, verified story worktree onto the branch `land` runs
// from: ff-only merge when possible, a rebase replay when the target moved,
// a hard stop (never an auto-resolve) on a real conflict. See spec.md /
// plan.md under story-02-02 for the full contract.
function worktreeLand(name, { cwd, story }) {
  const root = requireRepo(cwd);
  let lookupName = name;

  if (story) {
    const resolved = resolveStory(root, cwd, story);
    if (lookupName && lookupName !== resolved.name) {
      fail(
        `name conflict: "${lookupName}" vs story "${resolved.name}". ` +
          "Give either <name> or --story, but not both with different names.",
      );
    }
    lookupName = resolved.name;
  }

  assertName(lookupName);

  const entries = parseWorktrees(root);
  const dest = worktreeDest(root, lookupName);
  const match =
    entries.find((e) => e.path === dest) ||
    entries.find((e) => path.basename(e.path) === lookupName) ||
    entries.find((e) => e.branch === lookupName);

  if (!match) {
    fail(`worktree not found for "${lookupName}". See: ai-flow worktree list`);
  }

  if (path.resolve(match.path) === path.resolve(root)) {
    // entries[0] (git's primary worktree) is not reliably "the target" once
    // worktrees nest more than one level (e.g. a story worktree inside an
    // epic worktree inside the main checkout) — naming it here would point
    // at the wrong branch. Name it only when there is exactly one other
    // worktree to choose from; otherwise list every candidate instead of
    // guessing.
    const others = entries.filter((e) => path.resolve(e.path) !== path.resolve(match.path));
    const hint =
      others.length === 1
        ? `Run it from the target checkout instead (${others[0].path}).`
        : "Run it from the checkout that has the branch you want to merge into checked out — candidates:\n" +
          others.map((e) => `  ${e.path}${e.branch ? ` [${e.branch}]` : ""}`).join("\n");
    fail(
      `land must be run from the checkout you want to merge into, not from the story's own worktree ` +
        `"${lookupName}". ${hint}`,
    );
  }

  const branch = match.branch || lookupName;

  const dirty = realDirtyLines(match.path);
  if (dirty.length) {
    fail(
      `worktree "${lookupName}" has uncommitted changes, refusing to land:\n` +
        dirty.map((line) => `  ${line}`).join("\n"),
    );
  }

  // Already landed: the target has nothing new from this story. Skip
  // straight to cleanup rather than erroring — this is not a failure.
  const alreadyLanded =
    git(root, ["merge-base", "--is-ancestor", branch, "HEAD"], { allowFail: true }).code === 0;

  if (alreadyLanded) {
    landCleanup(root, match, branch);
    log(`Already landed: "${branch}" had nothing new for this branch. Worktree and branch cleaned up.`);
    return;
  }

  const found = findStoryForBranch(root, branch);
  if (!found) {
    fail(
      `worktree "${lookupName}" is not linked to a known story (no matching epics/*/story-* directory). ` +
        "land requires a story with a recorded verify.",
    );
  }

  const verifyByDir = latestVerifyByStoryDir(match.path);
  const verifyEntry = verifyByDir.get(found.story.path);

  if (!verifyEntry || verifyEntry.ok !== true) {
    fail(
      `no green verify recorded for story "${found.story.path}". ` +
        `Run "ai-flow verify --story ${found.story.path}" in the worktree first.`,
    );
  }

  const currentToken = currentTreeToken(match.path);
  if (isStale(verifyEntry, currentToken)) {
    fail(
      `the verify recorded for story "${found.story.path}" is stale (the tree changed since). ` +
        `Run "ai-flow verify --story ${found.story.path}" again in the worktree.`,
    );
  }

  // Captured before any merge is attempted: a fast-forward moves the branch
  // pointer with no merge commit of its own, so on a failed re-verify below
  // this is the only thing to restore, not something to "revert".
  const preMergeSha = git(root, ["rev-parse", "HEAD"]).stdout.trim();

  // Cheapest option first: ff-only either succeeds cleanly or fails fast with
  // no side effects.
  const ffOnly = git(root, ["merge", "--ff-only", branch], { allowFail: true });

  if (ffOnly.code !== 0) {
    // The target moved since the story branched: replay the story's commits
    // onto its current tip, INSIDE the story's own worktree — the target
    // checkout is not touched until the retried ff-only merge below. A failed
    // ff-only has no side effects, so the tip to rebase onto is still preMergeSha.
    const rebase = git(match.path, ["rebase", preMergeSha], { allowFail: true });

    if (rebase.code !== 0) {
      const conflicts = conflictingFiles(match.path);
      fail(
        `rebasing "${branch}" onto the current tip hit a conflict. Nothing was merged; the target branch ` +
          "is untouched. The story worktree is left mid-rebase for manual resolution:\n" +
          `  cd ${match.path}\n` +
          "  # resolve, then: git rebase --continue (or git rebase --abort)\n" +
          `Conflicting files:\n${conflicts.map((f) => `  ${f}`).join("\n")}`,
      );
    }

    const retryFf = git(root, ["merge", "--ff-only", branch], { allowFail: true });
    if (retryFf.code !== 0) {
      fail(
        `fast-forward merge still failed after rebasing "${branch}": ${retryFf.stderr.trim()}. ` +
          `The story worktree at ${match.path} has already been rebased onto the new tip — nothing was ` +
          "merged, but its state changed; inspect it before retrying.",
      );
    }
  }

  // Two independently-green stories can still combine into something broken
  // (the concrete worry: two migrations that never conflict as text but are
  // incompatible once applied together) — no single story's own verify can see
  // that, since it never ran against the merged result. Re-run the project's
  // validation commands against the target checkout, unconditional on the
  // story's own risk tier: the risk lives in the combination, not in either
  // story alone. Uses the same evidence path `ai-flow verify` writes to, so a
  // failed land is not just a terminal message — it shows up wherever a
  // captured verify already does.
  //
  // skipCoverage: true — the coverage gate reads the diff from the default
  // branch to HEAD, which after this merge is every story's accumulated diff
  // since main, not just the one just landed, and it cannot see a story-scoped
  // test exemption a landed story already earned. Judging the merged result on
  // whether its commands pass, not on a heuristic scoped to the wrong diff, is
  // what this re-verify is for; coverage stays a per-story concern.
  const evidence = verifyStoryOnce({ story: null, skipCoverage: true });
  const evidencePath = writeVerifyEvidence(evidence);
  printVerify(evidence, evidencePath);

  if (!evidence.ok) {
    // Bounded and reversible by construction: only the merge commit `land` just
    // created is undone. The story's own worktree, branch, and lock are never
    // touched, so the fix happens where the story's commits already live and
    // `land` can be retried once it is fixed.
    git(root, ["reset", "--hard", preMergeSha]);
    fail(
      `post-land validation failed on the merged result. The target branch was reset to its pre-merge ` +
        `commit (${preMergeSha.slice(0, 12)}). The story worktree, branch, and lock at ${match.path} are ` +
        "untouched — fix it there and land again.",
    );
  }

  landCleanup(root, match, branch);
  log(`Landed: "${branch}" merged. Worktree removed and branch deleted.`);
}

// Extracts positional arguments, ignoring flags and the value of flags that take
// one (--from/--deps/--story). Without this, `add --story x` would take
// "--story" as the positional name.
function positionalArgs(args) {
  const valueFlags = new Set(["--from", "--deps", "--story"]);
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith("-")) {
      if (!token.includes("=") && valueFlags.has(token)) {
        i += 1;
      }
      continue;
    }
    out.push(token);
  }
  return out;
}

function worktreeCommand({ commandArgs, from, deps, dryRun, force, cwd, story }) {
  const sub = commandArgs[0];
  const name = positionalArgs(commandArgs.slice(1))[0];

  if (sub === "add") {
    worktreeAdd(name, { from, deps, dryRun, cwd, story });
  } else if (sub === "list" || sub === "ls") {
    worktreeList({ cwd });
  } else if (sub === "remove" || sub === "rm") {
    worktreeRemove(name, { force, dryRun, cwd });
  } else if (sub === "lock") {
    worktreeLock(story, { cwd });
  } else if (sub === "unlock") {
    worktreeUnlock({ cwd, story, force });
  } else if (sub === "land") {
    worktreeLand(name, { cwd, story });
  } else {
    fail(`unknown worktree subcommand: "${sub || ""}". Use add, list, remove, lock, unlock or land.`);
  }
}

module.exports = {
  worktreeCommand,
  collectWorktrees,
  realDirtyLines,
  worktreeAdd,
  worktreeDest,
  requireRepo,
  resolveStory,
};
