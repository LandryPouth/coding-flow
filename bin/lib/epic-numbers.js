"use strict";

// The next epic number (story 17-03), from everything the checkout can see:
// the `epic-NN-` directories on disk, the archived entries of `epics/INDEX.md`,
// and the `epics/` tree of every local branch and remote-tracking ref. No
// fetch and no network: remote refs are as of the last fetch, and the sources
// say so. Two clones that have not fetched each other still collide; only the
// existing `duplicate_epic_number` check catches that, after the merge.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { archivedEpics, parseEpicName, sameEpic } = require("./epic-index");

const REF_LIMIT = 200;

// Ref names come from `git for-each-ref` and reach git as argument-array
// entries or as lines on `cat-file --batch`'s stdin, never through a shell.
function git(root, args, { input = null, encoding = "utf8" } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      ...(encoding ? { encoding } : {}),
      input: input === null ? undefined : input,
      stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function numbered(names) {
  return names.map((name) => ({ name, ...parseEpicName(name) })).filter((epic) => epic.number !== null);
}

function epicsOnDisk(root) {
  const dir = path.join(root, "epics");
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return numbered(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
}

// The subdirectory names of a raw tree object: `<mode> <name>\0<hash>` entries,
// read as bytes, so no path quoting (`core.quotePath`) can change a name.
function treeDirectories(body, hashLength) {
  const names = [];
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    const nul = body.indexOf(0x00, space);
    if (space < 0 || nul < 0) break;
    if (body.toString("latin1", at, space) === "40000") names.push(body.toString("utf8", space + 1, nul));
    at = nul + 1 + hashLength;
  }
  return names;
}

// The `epic-*` trees directly under `epics/` at each ref, in one `git cat-file
// --batch` for all of them (one process per ref cost ~2.5 ms each). Refs whose
// `epics/` is the same tree are parsed once.
function epicsAtRefs(root, refs, prefix) {
  if (refs.length === 0) return [];
  const out = git(root, ["cat-file", "--batch"], { input: refs.map((ref) => `${ref}:${prefix}epics\n`).join(""), encoding: null });
  if (!out) return refs.map(() => []);
  const trees = new Map();
  const result = [];
  let at = 0;
  for (let i = 0; i < refs.length; i += 1) {
    const eol = out.indexOf(0x0a, at);
    if (eol < 0) break;
    const header = out.toString("utf8", at, eol).match(/^([0-9a-f]+) (\S+) (\d+)$/);
    at = eol + 1;
    if (!header) {
      result.push([]); // `<object> missing`: the ref has no `epics/`.
      continue;
    }
    const [, oid, type, size] = header;
    const body = out.subarray(at, at + Number(size));
    at += Number(size) + 1;
    if (type !== "tree") {
      result.push([]);
      continue;
    }
    if (!trees.has(oid)) trees.set(oid, numbered(treeDirectories(body, oid.length / 2)));
    result.push(trees.get(oid));
  }
  while (result.length < refs.length) result.push([]);
  return result;
}

function shortRef(ref) {
  return ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, "");
}

// Every local branch but the one checked out here (the disk stands for it; a
// detached HEAD scans them all) and every remote-tracking ref but the symbolic
// `<remote>/HEAD`. null outside a git repository.
function refsToScan(root) {
  const out = git(root, ["for-each-ref", "--format=%(HEAD) %(refname)", "refs/heads", "refs/remotes"]);
  if (out === null) return null;
  return out
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.startsWith("*"))
    .map((line) => line.slice(2))
    .filter((ref) => !/^refs\/remotes\/[^/]+\/HEAD$/.test(ref));
}

// The project's path inside the repository (`<ref>:<prefix>epics` is read from
// the repository root) and where FETCH_HEAD lives, in one call.
function repoPaths(root) {
  const out = git(root, ["rev-parse", "--show-prefix", "--git-path", "FETCH_HEAD"]);
  const [prefix = "", fetchHead = ""] = (out || "").split("\n");
  return { prefix, fetchHead };
}

function lastFetch(root, fetchHead) {
  if (!fetchHead) return null;
  try {
    return fs.statSync(path.resolve(root, fetchHead)).mtime.toISOString();
  } catch {
    return null;
  }
}

// { next, disk, archived, refs: [{ ref, epics }], sources }.
function epicNumbers(root, { refLimit = REF_LIMIT } = {}) {
  const disk = epicsOnDisk(root);
  const archived = archivedEpics(root).filter((entry) => entry.number !== "-");
  const allRefs = refsToScan(root);
  const scanned = (allRefs || []).slice(0, refLimit);
  const paths = allRefs === null ? { prefix: "", fetchHead: "" } : repoPaths(root);
  const trees = epicsAtRefs(root, scanned, paths.prefix);
  const refs = scanned.map((ref, i) => ({ ref: shortRef(ref), remote: ref.startsWith("refs/remotes/"), epics: trees[i] }));

  const numbers = [...disk, ...archived, ...refs.flatMap((entry) => entry.epics)].map((epic) => epic.number);
  const width = numbers.reduce((max, number) => Math.max(max, number.length), 2);
  const highest = numbers.reduce((max, number) => Math.max(max, Number(number)), 0);
  const remote = refs.some((entry) => entry.remote);

  return {
    next: String(highest + 1).padStart(width, "0"),
    disk,
    archived,
    refs,
    sources: {
      git: allRefs !== null,
      directories: disk.length,
      archivedEntries: archived.length,
      // Only the refs that hold at least one numbered epic; the rest are counted.
      refs: refs.filter((entry) => entry.epics.length > 0).map((entry) => entry.ref),
      refsScanned: refs.length,
      refLimit,
      refsCapped: Boolean(allRefs) && allRefs.length > refLimit,
      remoteRefsAsOfLastFetch: remote,
      lastFetch: remote ? lastFetch(root, paths.fetchHead) : null,
    },
  };
}

// Doctor's two collisions, as { code, message } (story 17-03):
// - a number on disk already held by an archived epic under another slug;
// - a number on disk used by another ref under another slug, for an epic the
//   current branch has neither on disk nor archived.
function epicNumberCollisions(root, scan = epicNumbers(root)) {
  const found = [];
  const sameNumber = (a, b) => Number(a.number) === Number(b.number);
  const known = (epic) => scan.disk.some((own) => sameEpic(own, epic)) || scan.archived.some((entry) => sameEpic(entry, epic));

  for (const own of scan.disk) {
    for (const entry of scan.archived) {
      if (sameNumber(own, entry) && entry.slug !== own.slug) {
        found.push({
          code: "archived_epic_number_reused",
          message:
            `${own.name} reuses number ${entry.number}, already held by the archived epic ${entry.slug} — ` +
            `renumber it (take \`nextEpicNumber\` from \`ai-flow status --json\`): ${scan.next}`,
        });
      }
    }
    // One warning per conflicting epic, naming every ref that carries it.
    const refsByEpic = new Map();
    for (const { ref, epics } of scan.refs) {
      for (const theirs of epics) {
        if (sameNumber(own, theirs) && theirs.slug !== own.slug && !known(theirs)) {
          if (!refsByEpic.has(theirs.name)) refsByEpic.set(theirs.name, []);
          refsByEpic.get(theirs.name).push(ref);
        }
      }
    }
    for (const [name, refs] of refsByEpic) {
      found.push({
        code: "epic_number_on_other_branch",
        message:
          `${own.name} uses number ${own.number}, which ${refs.join(", ")} ${refs.length > 1 ? "use" : "uses"} for ${name} — ` +
          `renumber one before merging (next free: ${scan.next}); if a ref is stale, \`git fetch --prune\` or delete the branch`,
      });
    }
  }
  return found;
}

module.exports = { epicNumbers, epicNumberCollisions, REF_LIMIT };
