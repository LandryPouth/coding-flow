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

// Ref names come from `git for-each-ref` and are passed as argument-array
// entries, never through a shell.
function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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

// The `epic-*` trees directly under `epics/` at `ref`.
function epicsAtRef(root, ref) {
  const out = git(root, ["ls-tree", ref, "--", "epics/"]);
  if (!out) return [];
  const names = [];
  for (const line of out.split("\n")) {
    const match = line.match(/^\d+ tree [0-9a-f]+\t(.+)$/);
    if (match) names.push(path.posix.basename(match[1]));
  }
  return numbered(names);
}

function shortRef(ref) {
  return ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, "");
}

// Every local branch but the current one (the disk stands for it) and every
// remote-tracking ref but the symbolic `<remote>/HEAD`.
function refsToScan(root) {
  const out = git(root, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]);
  if (out === null) return null;
  const current = (git(root, ["symbolic-ref", "-q", "HEAD"]) || "").trim();
  return out
    .split("\n")
    .filter(Boolean)
    .filter((ref) => ref !== current && !/^refs\/remotes\/[^/]+\/HEAD$/.test(ref));
}

function lastFetch(root) {
  const file = (git(root, ["rev-parse", "--git-path", "FETCH_HEAD"]) || "").trim();
  if (!file) return null;
  try {
    return fs.statSync(path.resolve(root, file)).mtime.toISOString();
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
  const refs = scanned.map((ref) => ({ ref: shortRef(ref), remote: ref.startsWith("refs/remotes/"), epics: epicsAtRef(root, ref) }));

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
      refs: refs.map((entry) => entry.ref),
      refLimit,
      refsCapped: Boolean(allRefs) && allRefs.length > refLimit,
      remoteRefsAsOfLastFetch: remote,
      lastFetch: remote ? lastFetch(root) : null,
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
    for (const { ref, epics } of scan.refs) {
      for (const theirs of epics) {
        if (sameNumber(own, theirs) && theirs.slug !== own.slug && !known(theirs)) {
          found.push({
            code: "epic_number_on_other_branch",
            message:
              `${own.name} uses number ${own.number}, which ${ref} uses for ${theirs.name} — ` +
              `renumber one before merging (next free: ${scan.next})`,
          });
        }
      }
    }
  }
  return found;
}

module.exports = { epicNumbers, epicNumberCollisions, REF_LIMIT };
