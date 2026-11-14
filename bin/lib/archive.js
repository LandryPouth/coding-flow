"use strict";

// `ai-flow archive <epic-dir | NN>` (story 17-01): a finished, merged epic
// leaves the checkout. The gate is "finished and merged", not "proven" (epic 17,
// Decisions): every story past planned/in-progress/blocked, no linked worktree,
// a clean directory identical on the default branch. The proof state each story
// had is copied into `epics/INDEX.md` as it stands — never upgraded — next to
// the commit where the text still exists and the `git checkout` that brings it
// back. The deletion is staged with `git rm`, never committed: the user commits.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { cwd } = require("./context");
const { log, toPortable } = require("./util");
const { readConfig } = require("./config");
const { defaultBranch } = require("./policy");
const { buildStatusModel } = require("./status");
const { INDEX_FILE, indexPath, readIndex, archivedEpics, withArchivedEntry } = require("./epic-index");

const UNFINISHED = new Set(["planned", "in-progress", "blocked"]);

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function parseEpicName(name) {
  const match = name.match(/^epic-(\d+)-(.+)$/);
  return match ? { number: match[1], slug: match[2] } : { number: null, slug: name };
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

// { name } for an epic on disk, { alreadyArchived } for one only the index
// remembers, or { refused }.
function resolveEpic(arg) {
  const read = readArgument(arg);
  if (read.refused) return read;

  const onDisk = epicDirsOnDisk();
  const archived = archivedEpics(cwd);

  if (read.number) {
    const wanted = Number(read.number);
    const matches = onDisk.filter((name) => Number(parseEpicName(name).number) === wanted);
    if (matches.length > 1) {
      return { refused: `epic number ${read.number} names ${matches.length} directories: ${matches.map((m) => `epics/${m}`).join(", ")} — pass the directory` };
    }
    if (matches.length === 1) return { name: matches[0] };
    const entry = archived.find((item) => Number(item.number) === wanted);
    return entry ? { alreadyArchived: `epic-${entry.number}-${entry.slug}` } : { refused: `no epic numbered ${read.number} under epics/` };
  }

  if (onDisk.includes(read.name)) return { name: read.name };

  const { number, slug } = parseEpicName(read.name);
  const entry = archived.find((item) => item.number === number && item.slug === slug);
  return entry ? { alreadyArchived: read.name } : { refused: `no epic directory epics/${read.name}` };
}

// Every reason the epic cannot leave the checkout, named one by one. Empty
// means it may be archived.
function refusals(name, epic) {
  const rel = `epics/${name}`;
  const reasons = [];

  for (const story of epic ? epic.stories : []) {
    if (UNFINISHED.has(story.status)) {
      reasons.push(`${story.name} is ${story.status}`);
    }
    if (story.worktree) {
      reasons.push(`${story.name} has a linked worktree at ${story.worktree} (land or remove it first)`);
    }
  }

  const dirty = git(["status", "--porcelain", "--untracked-files=all", "--ignored", "--", rel]).trim();
  if (dirty) {
    const files = dirty.split("\n").map((line) => line.slice(3));
    reasons.push(`${rel} has uncommitted, untracked or ignored files: ${files.join(", ")}`);
  }

  reasons.push(...mergeRefusals(rel));
  return reasons;
}

// The directory's tree at HEAD must be the one on the default branch: archive
// what is merged, never a branch-only state.
function mergeRefusals(rel) {
  const base = defaultBranch(cwd);
  const baseRef = [base, `origin/${base}`].find((ref) => git(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { allowFail: true }));
  const headTree = git(["rev-parse", "-q", "--verify", `HEAD:./${rel}`], { allowFail: true });
  const baseTree = baseRef ? git(["rev-parse", "-q", "--verify", `${baseRef}:./${rel}`], { allowFail: true }) : null;

  if (!headTree) {
    return [`${rel} is not committed at HEAD`];
  }
  if (!baseTree) {
    return [`${rel} is absent from ${base}: merge it into ${base} first`];
  }
  if (headTree.trim() !== baseTree.trim()) {
    return [`${rel} differs from ${base}: merge it into ${base} first`];
  }
  return [];
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
    `### Epic ${number || "?"} — ${cell(epicTitle(name))} <!-- coding-flow:archived ${number || "0"} ${slug} -->`,
    "",
    `- Archived ${date} at \`${sha.slice(0, 7)}\` (\`${rel}\`).`,
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
  const model = buildStatusModel(config);
  const epic = model.epics.find((item) => item.path === `epics/${name}` || item.name === name) || null;
  const reasons = refusals(name, epic);
  const stories = (epic ? epic.stories : []).map(storyRow);
  return { name, rel: `epics/${name}`, reasons, stories };
}

function writeArchive(state) {
  const existing = readIndex(cwd);
  const indexWasClean = existing === null || !git(["status", "--porcelain", "--", INDEX_FILE]).trim();
  fs.mkdirSync(path.dirname(indexPath(cwd)), { recursive: true });
  fs.writeFileSync(indexPath(cwd), withArchivedEntry(existing, state.entry));

  try {
    git(["rm", "-r", "-q", "--", state.rel]);
  } catch (error) {
    if (existing === null) fs.unlinkSync(indexPath(cwd));
    else fs.writeFileSync(indexPath(cwd), existing);
    throw error;
  }

  // An INDEX.md holding the user's own uncommitted edits is left unstaged:
  // staging it would sweep their edits into the archive commit.
  if (indexWasClean) git(["add", "--", INDEX_FILE]);
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
    log(`  1. append this entry to ${toPortable(INDEX_FILE)}:`);
    log(state.entry.trimEnd().split("\n").map((line) => `       ${line}`).join("\n"));
    log(`  2. git rm -r -q -- ${state.rel} (${state.files} file(s), staged, not committed)`);
  } else {
    log(`Archived ${state.rel} at ${state.sha.slice(0, 7)}: ${state.files} file(s) staged for deletion.`);
    log(`  Entry appended to ${toPortable(INDEX_FILE)}${state.indexStaged ? " (staged)" : " (not staged: the file has your own uncommitted edits)"}.`);
    log(`  Recover: git checkout ${state.sha} -- ${state.rel}`);
    log("  Nothing is committed: review `git status`, then commit.");
  }

  if (state.links.length > 0) {
    log("Still links here (tracked files, not edited):");
    for (const file of state.links) log(`  - ${file}`);
  }
}

function archive({ target, dryRun = false, json = false } = {}) {
  if (!git(["rev-parse", "--git-dir"], { allowFail: true })) {
    const state = { argument: target, reasons: ["not a git repository (or git is missing): without history the deletion could not be recovered"] };
    report(state, { json, dryRun });
    process.exitCode = 1;
    return state;
  }

  const resolved = resolveEpic(target);
  if (resolved.refused || resolved.alreadyArchived) {
    const state = resolved.refused ? { argument: target, reasons: [resolved.refused] } : { alreadyArchived: resolved.alreadyArchived, reasons: [] };
    report(state, { json, dryRun });
    if (resolved.refused) process.exitCode = 1;
    return state;
  }

  const state = plan(resolved.name);
  if (state.reasons.length > 0) {
    report(state, { json, dryRun });
    process.exitCode = 1;
    return state;
  }

  state.sha = git(["rev-parse", "HEAD"]).trim();
  state.date = new Date().toISOString().slice(0, 10);
  state.entry = buildEntry({ name: resolved.name, sha: state.sha, stories: state.stories, date: state.date });
  state.links = linksInto(state.rel);
  state.files = git(["ls-files", "--", state.rel]).split("\n").filter(Boolean).length;
  state.dryRun = dryRun;
  if (!dryRun) state.indexStaged = writeArchive(state);
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
