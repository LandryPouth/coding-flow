"use strict";

// Optional Git worktree support for parallel work.
//
// Three subcommands, all non-destructive by default:
//   ai-flow worktree add <name> [--from <ref>] [--deps install|link|skip] [--dry-run]
//   ai-flow worktree list
//   ai-flow worktree remove <name> [--force] [--dry-run]
//
// Project constraints: zero dependencies (only Node's built-in modules and the
// `git` binary), Node >= 18. We shell out to git rather than reimplementing its
// plumbing; git is a prerequisite anyway.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

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
    hasStoryFile: fs.existsSync(path.join(full, "spec.md")),
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
function resolveDepsStrategy(explicit, { pm, workspace }, hasNodeModules) {
  if (explicit) {
    if (!["install", "link", "skip"].includes(explicit)) {
      fail(`invalid --deps: "${explicit}". Values: install, link, skip.`);
    }
    return explicit;
  }
  if (workspace || pm === "pnpm" || pm === "yarn") return "recommend-install";
  if (hasNodeModules) return "link";
  return "recommend-install";
}

function installCommand(pm) {
  if (pm === "pnpm") return "pnpm install";
  if (pm === "yarn") return "yarn install";
  return "npm install";
}

function worktreeAdd(name, { from, deps, dryRun, cwd, story }) {
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
    log("Dry run — nothing is written.");
    log(`  worktree : git ${addArgs.join(" ")}`);
    log(`  branch   : ${branchExists ? `${name} (existing)` : `${name} (new, from ${from || "HEAD"})`}`);
    if (linkedStory) log(`  story    : ${linkedStory.rel}${linkedStory.hasStoryFile ? "" : " (no spec.md)"}`);
    for (const f of envToLink) log(`  link     : ${f}`);
    log(`  deps     : ${describeStrategy(strategy, pm, hasNodeModules)}`);
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  git(root, addArgs);
  log(`Worktree created: ${dest}`);
  log(`Branch: ${name}${branchExists ? " (existing)" : ""}`);
  if (linkedStory) {
    log(`Story linked: ${linkedStory.rel}${linkedStory.hasStoryFile ? "" : " (no spec.md)"}`);
  }

  for (const f of envToLink) {
    const status = makeLink(path.join(root, f), path.join(dest, f));
    log(`  ${status} ${f}`);
  }

  applyDeps(strategy, { pm, root, dest, hasNodeModules });

  log("");
  log("Next step:");
  log(`  cd ${path.relative(cwd, dest) || dest}`);
  if (linkedStory) {
    log(`  ai-flow harness preflight --story ${linkedStory.rel}`);
  }
}

function describeStrategy(strategy, pm, hasNodeModules) {
  if (strategy === "link") return "symlink node_modules";
  if (strategy === "install") return `${installCommand(pm)} in the worktree`;
  if (strategy === "skip") return "skipped (--deps skip)";
  return `to install (${installCommand(pm)}) — monorepo/pnpm, symlink not advised`;
}

function applyDeps(strategy, { pm, root, dest, hasNodeModules }) {
  if (strategy === "skip") return;

  if (strategy === "link") {
    if (!hasNodeModules) {
      log(`  node_modules absent at the root — nothing to link, run: ${installCommand(pm)}`);
      return;
    }
    const status = makeLink(path.join(root, "node_modules"), path.join(dest, "node_modules"));
    log(`  ${status} node_modules`);
    return;
  }

  if (strategy === "install") {
    log(`  ${installCommand(pm)} ...`);
    const bin = pm || "npm";
    try {
      execFileSync(bin, ["install"], { cwd: dest, stdio: "inherit" });
    } catch {
      log(`  "${installCommand(pm)}" failed — rerun it manually in the worktree.`);
    }
    return;
  }

  // recommend-install
  log(`  deps : run "${installCommand(pm)}" in the worktree (symlink not advised for this project).`);
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
  } else {
    fail(`unknown worktree subcommand: "${sub || ""}". Use add, list or remove.`);
  }
}

module.exports = { worktreeCommand, collectWorktrees };
