"use strict";

// `ai-flow archive <epic-dir | NN>` (story 17-01): a finished, merged epic
// leaves the checkout. The gate is "finished and merged", not "proven" (epic 17,
// Decisions): every story done, verified or stale, no linked worktree, a clean
// directory identical on the default branch. The proof state each story had is
// copied into `epics/INDEX.md` as it stands — never upgraded — next to the
// default branch's commit, where the text still exists, and the `git checkout`
// that brings it back. The deletion is staged with `git rm`, never committed:
// the user commits.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { cwd } = require("./context");
const { log, toPortable } = require("./util");
const { readConfig } = require("./config");
const { defaultBranch } = require("./policy");
const { buildStatusModel } = require("./status");
const { INDEX_FILE, indexPath, readIndex, archivedEpics, withArchivedEntry, parseEpicName, sameEpic } = require("./epic-index");

// The only states that mean "finished". `## Status:` accepts any written word,
// so anything else — planned, in-progress, blocked, but also todo, draft, wip —
// refuses.
const FINISHED = new Set(["done", "verified", "stale"]);
const NAMED_UNFINISHED = new Set(["planned", "in-progress", "blocked"]);

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function epicDirsOnDisk() {
  const root = path.join(cwd, "epics");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// The argument, read as a number (`08`, `8`) or a directory directly under
// `epics/` (`epics/epic-08-x`, `epic-08-x`). Anything else — `..`, an absolute
// path, a deeper path — is refused before a single file is read.
function readArgument(arg) {
  const portable = toPortable(String(arg || "").trim()).replace(/\/+$/, "");

  if (/^\d+$/.test(portable)) {
    return { number: portable };
  }

  const parts = portable.split("/");
  if (!portable || path.isAbsolute(portable) || parts.includes("..") || parts.includes(".")) {
    return { refused: `"${arg}" is not an epic directory under epics/` };
  }

  const name = parts.length === 2 && parts[0] === "epics" ? parts[1] : parts.length === 1 ? parts[0] : null;
  return name ? { name } : { refused: `"${arg}" is not an epic directory under epics/` };
}

function displayName(entry) {
  return entry.number === "-" ? entry.slug : `epic-${entry.number}-${entry.slug}`;
}

// { name } for an epic on disk, { alreadyArchived } for one only the index
// remembers, or { refused }.
function resolveEpic(arg) {
  const read = readArgument(arg);
  if (read.refused) return read;

  const onDisk = epicDirsOnDisk();
  const archived = archivedEpics(cwd);

  if (read.number) {
    const wanted = Number(read.number);
    const matches = onDisk.filter((name) => Number(parseEpicName(name).number) === wanted && parseEpicName(name).number !== null);
    if (matches.length > 1) {
      return { refused: `epic number ${read.number} names ${matches.length} directories: ${matches.map((m) => `epics/${m}`).join(", ")} — pass the directory` };
    }
    if (matches.length === 1) return { name: matches[0] };
    const entry = archived.find((item) => item.number !== "-" && Number(item.number) === wanted);
    return entry ? { alreadyArchived: displayName(entry) } : { refused: `no epic numbered ${read.number} under epics/` };
  }

  if (onDisk.includes(read.name)) return { name: read.name };

  const epic = parseEpicName(read.name);
  const entry = archived.find((item) => sameEpic(item, epic));
  return entry ? { alreadyArchived: displayName(entry) } : { refused: `no epic directory epics/${read.name}` };
}

function storyRefusals(epic) {
  const reasons = [];
  for (const story of epic ? epic.stories : []) {
    if (NAMED_UNFINISHED.has(story.status)) {
      reasons.push(`${story.name} is ${story.status}`);
    } else if (!FINISHED.has(story.status)) {
      reasons.push(`${story.name} has an unrecognised status "${story.status}" (only done, verified or stale can be archived)`);
    }
    if (story.worktree) {
      reasons.push(`${story.name} has a linked worktree at ${story.worktree} (land or remove it first)`);
    }
  }
  return reasons;
}

// A subdirectory that is not a story is content the gate cannot read the state
// of: it refuses rather than deleting work nobody judged.
function strayDirectories(name) {
  const dir = path.join(cwd, "epics", name);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("story-"))
    .map((entry) => `epics/${name}/${entry.name} is not a story directory (story-*): move it out or make it a story`);
}

// Every reason the epic cannot leave the checkout, named one by one, and the
// default branch commit the recovery line will name.
function refusals(name, epic) {
  const rel = `epics/${name}`;
  const reasons = [...storyRefusals(epic), ...strayDirectories(name)];

  const dirty = git(["status", "--porcelain", "--untracked-files=all", "--ignored", "--", rel]).trim();
  if (dirty) {
    const files = dirty.split("\n").map((line) => line.slice(3));
    reasons.push(`${rel} has uncommitted, untracked or ignored files: ${files.join(", ")}`);
  }

  if (git(["check-ignore", "-q", "--", INDEX_FILE], { allowFail: true }) !== null) {
    reasons.push(`${toPortable(INDEX_FILE)} is ignored by git: the archive entry could never be committed`);
  }

  const merge = mergeCheck(rel);
  return { reasons: [...reasons, ...merge.reasons], baseSha: merge.baseSha };
}

// The first base that exists, locally or as last fetched: the configured
// remote default, then main, master, develop.
function baseRef() {
  const names = [...new Set([defaultBranch(cwd), "main", "master", "develop"])];
  for (const name of names) {
    for (const ref of [name, `origin/${name}`]) {
      if (git(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { allowFail: true })) return { name, ref };
    }
  }
  return null;
}

// The directory's tree at HEAD must be the one on the default branch: archive
// what is merged, never a branch-only state. The recovery line then names the
// default branch's commit, which a squash merge or a deleted branch cannot lose.
function mergeCheck(rel) {
  const base = baseRef();
  const headTree = git(["rev-parse", "-q", "--verify", `HEAD:./${rel}`], { allowFail: true });

  if (!base) {
    return { reasons: ["no default branch found (origin's default, main, master, develop): nothing to compare with"] };
  }
  const baseTree = git(["rev-parse", "-q", "--verify", `${base.ref}:./${rel}`], { allowFail: true });
  const baseSha = git(["rev-parse", `${base.ref}^{commit}`]).trim();

  if (!headTree) {
    return { reasons: [`${rel} is not committed at HEAD`] };
  }
  if (!baseTree) {
    return { reasons: [`${rel} is absent from ${base.name}: merge it into ${base.name} first`] };
  }
  if (headTree.trim() !== baseTree.trim()) {
    return { reasons: [`${rel} differs from ${base.name}: merge it into ${base.name} first`] };
  }
  return { reasons: [], baseSha };
}

function epicTitle(name) {
  const file = path.join(cwd, "epics", name, "index.md");
  const heading = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).find((line) => line.startsWith("# ")) : null;
  const text = heading ? heading.replace(/^#\s+/, "").trim() : "";
  const after = text.split(/\s+[—–]\s+|:\s+/).slice(1).join(" — ");
  return after || text || parseEpicName(name).slug;
}

function storyRow(story) {
  const number = (story.name.match(/^story-(\d+-\d+)/) || [])[1] || story.name;
  const title = String(story.title || "").replace(/^Story\s+[\d-]+\s*[—–:-]\s*/i, "") || story.name;
  return {
    name: story.name,
    number,
    title,
    status: story.status,
    ...(story.contradicted ? { contradicted: story.contradicted } : {}),
  };
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|");
}

function buildEntry({ name, sha, stories, date }) {
  const { number, slug } = parseEpicName(name);
  const rel = `epics/${name}`;
  const lines = [
    `### ${number ? `Epic ${number}` : name} — ${cell(epicTitle(name))} <!-- coding-flow:archived ${number || "-"} ${slug} -->`,
    "",
    `- Archived ${date}; the text is at \`${sha.slice(0, 7)}\` (\`${rel}\`).`,
    `- Recover: \`git checkout ${sha} -- ${rel}\``,
    "",
    "| Story | Title | Status when archived |",
    "| --- | --- | --- |",
    ...stories.map((s) => `| ${s.number} | ${cell(s.title)} | ${s.status}${s.contradicted ? ` (${s.contradicted})` : ""} |`),
    "",
  ];
  return lines.join("\n");
}

// Tracked files outside the epic that still name it. Listed, never edited.
function linksInto(rel) {
  const out = git(["grep", "-l", "-F", "-e", rel, "--", "."], { allowFail: true }) || "";
  return out
    .split("\n")
    .filter(Boolean)
    .map(toPortable)
    .filter((file) => !file.startsWith(`${rel}/`))
    .sort();
}

function plan(name) {
  const config = readConfig(cwd);
  if (config.storage && config.storage !== "local") {
    return { name, rel: `epics/${name}`, reasons: [`the storage backend is "${config.storage}": archive only knows local epics`], stories: [] };
  }
  const model = buildStatusModel(config);
  const epic = model.epics.find((item) => item.path === `epics/${name}` || item.name === name) || null;
  const { reasons, baseSha } = refusals(name, epic);
  const stories = (epic ? epic.stories : []).map(storyRow);
  return { name, rel: `epics/${name}`, reasons, stories, sha: baseSha };
}

// `git rm`, then the entry, then staging the entry. Any failure puts the
// directory, the index and INDEX.md back as they were.
function writeArchive(state) {
  const existing = readIndex(cwd);
  const indexWasClean = existing === null || !git(["status", "--porcelain", "--", INDEX_FILE]).trim();

  try {
    git(["rm", "-r", "-q", "--", state.rel]);
    fs.mkdirSync(path.dirname(indexPath(cwd)), { recursive: true });
    fs.writeFileSync(indexPath(cwd), withArchivedEntry(existing, state.entry));
    // An INDEX.md holding the user's own uncommitted edits is left unstaged:
    // staging it would sweep their edits into the archive commit.
    if (indexWasClean) git(["add", "--", INDEX_FILE]);
  } catch (error) {
    git(["checkout", "HEAD", "--", state.rel], { allowFail: true });
    if (indexWasClean) git(["reset", "-q", "--", INDEX_FILE], { allowFail: true });
    try {
      if (existing === null) {
        if (fs.existsSync(indexPath(cwd))) fs.unlinkSync(indexPath(cwd));
      } else if (fs.readFileSync(indexPath(cwd), "utf8") !== existing) {
        fs.writeFileSync(indexPath(cwd), existing);
      }
    } catch {
      // the entry was never written (the write itself failed)
    }
    throw error;
  }
  return indexWasClean;
}

function report(state, { json, dryRun }) {
  if (json) {
    log(JSON.stringify(state, null, 2));
    return;
  }
  if (state.alreadyArchived) {
    log(`epics/${state.alreadyArchived} is already archived (see ${toPortable(INDEX_FILE)}).`);
    return;
  }
  if (state.reasons.length > 0) {
    log(`Archive refused for ${state.rel || state.argument}:`);
    for (const reason of state.reasons) log(`  - ${reason}`);
    return;
  }

  if (dryRun) {
    log(`Dry run — nothing was written or staged. archive would:`);
    log(`  1. git rm -r -q -- ${state.rel} (${state.files} file(s), staged, not committed)`);
    log(`  2. append this entry to ${toPortable(INDEX_FILE)}:`);
    log(state.entry.trimEnd().split("\n").map((line) => `       ${line}`).join("\n"));
  } else {
    log(`Archived ${state.rel}: ${state.files} file(s) staged for deletion.`);
    log(`  Entry appended to ${toPortable(INDEX_FILE)}${state.indexStaged ? " (staged)" : " (not staged: the file has your own uncommitted edits)"}.`);
    log(`  Recover: git checkout ${state.sha} -- ${state.rel}`);
    log("  Nothing is committed: review `git status`, then commit.");
  }

  if (state.links.length > 0) {
    log("Still links here (tracked files, not edited):");
    for (const file of state.links) log(`  - ${file}`);
  }
}

function refuse(state, options) {
  report(state, options);
  process.exitCode = 1;
  return state;
}

function archive({ target, dryRun = false, json = false } = {}) {
  if (!git(["rev-parse", "--git-dir"], { allowFail: true })) {
    return refuse({ argument: target, reasons: ["not a git repository (or git is missing): without history the deletion could not be recovered"] }, { json, dryRun });
  }

  const resolved = resolveEpic(target);
  if (resolved.refused) return refuse({ argument: target, reasons: [resolved.refused] }, { json, dryRun });
  if (resolved.alreadyArchived) {
    const state = { alreadyArchived: resolved.alreadyArchived, reasons: [] };
    report(state, { json, dryRun });
    return state;
  }

  const state = plan(resolved.name);
  if (state.reasons.length > 0) return refuse(state, { json, dryRun });

  state.date = new Date().toISOString().slice(0, 10);
  state.entry = buildEntry({ name: resolved.name, sha: state.sha, stories: state.stories, date: state.date });
  state.links = linksInto(state.rel);
  state.files = git(["ls-files", "--", state.rel]).split("\n").filter(Boolean).length;
  state.dryRun = dryRun;
  if (!dryRun) {
    try {
      state.indexStaged = writeArchive(state);
    } catch (error) {
      const message = String(error.stderr || error.message || error).trim().split("\n")[0];
      return refuse({ ...state, reasons: [`archive failed and was rolled back: ${message}`] }, { json, dryRun });
    }
  }
  report(state, { json, dryRun });
  return state;
}

function archiveCommand({ commandArgs, flags }) {
  const target = commandArgs.find((arg) => !arg.startsWith("-"));
  if (!target) {
    log("Usage: ai-flow archive <epic-dir | NN> [--dry-run] [--json]");
    process.exitCode = 1;
    return;
  }
  archive({ target, dryRun: flags.has("--dry-run"), json: flags.has("--json") });
}

module.exports = { archive, archiveCommand, resolveEpic };
