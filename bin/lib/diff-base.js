"use strict";

// Which commit a story's diff is measured from. Coverage, risk, weakening and
// deleted-test signals all read "what changed", and for a story forked from an
// epic branch that is NOT "everything since main" — it is everything since the
// epic branch. Resolved once per run, in an explicit order, and recorded with
// its source so a surprising scope can be explained.
//
// Order (first that yields a merge-base wins):
//   flag        --base <ref>
//   config      .coding-flow/config.json `baseBranch`
//   fork-point  git config branch.<name>.codingFlowBase, written by `worktree add`;
//               ignored (and named) on a base branch: develop, main, the default
//               branch, the configured baseBranch
//   nearest     closest of: the story's epic branch, develop, the default branch
//   default     today's behaviour: origin/HEAD, else main
//   none        no merge-base at all — the caller falls back to the working tree
//
// A flag or a configured base that IS HEAD, on a branch that is not a base and
// has commits of its own, would empty the diff: the flag is refused, and the
// baseBranch gives way to where those commits start (`ownCommitsStart`).
//
// Pure read. Never throws except for an explicit --base that does not resolve
// or empties the diff (a flag the user typed must not be silently replaced by a
// guess), and for a baseBranch naming the branch itself with nothing earlier to
// measure from.

const { execFileSync } = require("child_process");

const { readConfig } = require("./config");
const { defaultBranch, currentBranch } = require("./policy");

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// A ref and its remote twin, merge-based against HEAD. `ref` is a branch name
// (never a SHA for the recorded kinds), so a rebase keeps working.
function mergeBaseWith(cwd, ref) {
  // A ref that looks like an option would be parsed by git as one.
  if (!ref || ref.startsWith("-")) return null;

  for (const candidate of [ref, `origin/${ref}`]) {
    const mergeBase = git(cwd, ["merge-base", candidate, "HEAD"]);

    if (mergeBase) {
      return { ref, mergeBase };
    }
  }

  return null;
}

function epicNumber(story, branch) {
  const fromStory = story && /(?:^|[\\/])(?:epic|story)-(\d+)/i.exec(String(story));
  const fromBranch = branch && /(?:epic|story)-(\d+)/i.exec(branch);
  const match = fromStory || fromBranch;

  return match ? String(Number(match[1])) : null;
}

function nearestCandidates(cwd, { story, branch }) {
  const names = [];
  const number = epicNumber(story, branch);

  if (number) {
    const pattern = new RegExp(`epic-0*${number}(?!\\d)`, "i");
    const heads = git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]) || "";

    for (const name of heads.split(/\r?\n/).filter(Boolean)) {
      if (name !== branch && pattern.test(name)) names.push(name);
    }
  }

  names.push("develop", defaultBranch(cwd));

  return [...new Set(names)].filter((name) => name !== branch);
}

function classifyScope({ cwd, branch, source, story }) {
  if (source === "none") return "working-tree";
  if (!branch) return "branch";

  if (source === "fork-point" || storyNamed(branch, story)) {
    return "story";
  }

  if (/epic-\d+/i.test(branch) || /^feature\//i.test(branch)) return "epic";

  return "branch";
}

// The branches stories fork from. A fork point is a story's, never a base's:
// `develop` once carried one (a SHA past its own history), and every verify run
// from it measured "all of develop since then" as if it were a story.
function baseBranchNames(cwd, configured = null) {
  const names = ["main", "master", "develop", defaultBranch(cwd)];

  if (typeof configured === "string" && configured) names.push(configured);

  return [...new Set(names)];
}

// `baseBranch` as committed at `sha`, or null: what the base said, not the tree.
function baseBranchAt(cwd, sha) {
  const raw = sha ? git(cwd, ["show", `${sha}:.coding-flow/config.json`]) : null;

  try {
    const value = raw ? JSON.parse(raw).baseBranch : null;

    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

// `ignoreForkPoint` answers "where would this branch start without its recorded
// fork point?" — the refactor claim compares the two, since that fork point is a
// local git setting, not part of the diff it would narrow.
function resolveDiffBase(cwd, { story = null, flagBase = null, ignoreForkPoint = false } = {}) {
  const branch = currentBranch(cwd);
  const head = git(cwd, ["rev-parse", "HEAD"]);
  const configured = readConfig(cwd).baseBranch;
  const value = typeof configured === "string" && configured ? configured : null;
  const context = { story, branch, configured: value };
  const found = (source, hit, extra = {}) => ({
    ref: hit.ref,
    mergeBase: hit.mergeBase,
    source,
    scope: classifyScope({ cwd, branch, source, story }),
    ...extra,
  });
  const recorded = (skipForkPoint = ignoreForkPoint) =>
    resolveRecorded(cwd, { ...context, ignoreForkPoint: skipForkPoint, found });

  // A base that IS HEAD empties every committed change. On a base branch that
  // is a choice (verify the uncommitted work); anywhere else it hides the
  // branch's own commits, and the policy read at its base skips them (13-07).
  const ownStart = (hit) =>
    head && hit.mergeBase === head && !isBaseBranch(cwd, context) ? ownCommitsStart(cwd, { ...context, head, recorded }) : null;

  if (flagBase) {
    const hit = mergeBaseWith(cwd, flagBase);

    if (!hit) {
      throw new Error(`--base "${flagBase}" does not resolve to a ref with a merge-base against HEAD.`);
    }

    const own = ownStart(hit);

    if (own) {
      throw new Error(
        `--base "${flagBase}" is HEAD itself: this branch has ${own.count} commit(s) of its own since ` +
          `${own.ref}, and the diff would hide them all. Pass --base ${own.ref} (or omit --base).`,
      );
    }

    return found("flag", hit);
  }

  const hit = value ? mergeBaseWith(cwd, value) : null;

  if (hit) {
    const own = ownStart(hit);

    if (!own) return found("config", hit, forkPointIgnoredFor(cwd, context));
    if (own.count === null) {
      throw new Error(`baseBranch "${value}" names this branch itself, and no earlier base is known to measure its commits from.`);
    }

    const configIgnored = {
      value,
      reason: `baseBranch "${value}" would empty this branch's diff (${own.count} commit(s) of its own since ${own.ref})`,
    };

    return own.source === "config" ? found("config", own, { configIgnored }) : { ...recorded(), configIgnored };
  }

  // A configured base that does not resolve is not silently ignored: it is
  // recorded, as a missing fork point is.
  return value ? { ...recorded(), configUnresolved: value } : recorded();
}

function storyNamed(branch, story) {
  const leaf = branch.split("/").pop();
  const storyLeaf = story ? String(story).replace(/\/+$/, "").split("/").pop() : null;

  return /^story-/i.test(leaf) || Boolean(storyLeaf && leaf === storyLeaf);
}

// develop, main… by name, or the configured baseBranch — unless that names a
// story branch: a story that sets baseBranch to itself is not a base.
function isBaseBranch(cwd, { branch, story, configured }) {
  if (!branch) return false;
  if (baseBranchNames(cwd).includes(branch)) return true;

  return branch === configured && !storyNamed(branch, story);
}

// Where this branch's own commits start, when its chosen base is HEAD: the
// baseBranch values its history carried before (newest first), then its fork
// point, then the nearest shared branch. `count: null` when the chosen base
// names the branch itself and none of those is known — nothing to fall back on.
function ownCommitsStart(cwd, { branch, head, configured, recorded }) {
  const commits = (git(cwd, ["log", "--format=%H", "-n", "50", "HEAD", "--", ".coding-flow/config.json"]) || "").split(/\s+/).filter(Boolean);
  const earlier = commits.flatMap((sha) => [baseBranchAt(cwd, sha), baseBranchAt(cwd, `${sha}^`)]);
  const forkPoint = branch ? git(cwd, ["config", "--get", `branch.${branch}.codingFlowBase`]) : null;
  const fallback = recorded(true);
  const candidates = [
    ...[...new Set(earlier)].filter((name) => name && name !== configured).map((name) => ({ name, source: "config" })),
    ...(forkPoint ? [{ name: forkPoint, source: "fork-point" }] : []),
  ];

  for (const { name, source } of candidates) {
    const hit = mergeBaseWith(cwd, name);

    if (hit && hit.mergeBase !== head) return { ...hit, source, count: countSince(cwd, hit.mergeBase) };
  }

  if (fallback.mergeBase && fallback.mergeBase !== head) {
    return { ref: fallback.ref, mergeBase: fallback.mergeBase, source: fallback.source, count: countSince(cwd, fallback.mergeBase) };
  }

  return configured && configured === branch ? { count: null } : null;
}

function countSince(cwd, sha) {
  return Number(git(cwd, ["rev-list", "--count", `${sha}..HEAD`]));
}

// A fork point recorded on a base branch, or naming the branch itself: not
// used, and named with why.
function forkPointIgnoredFor(cwd, context) {
  const { branch } = context;
  const recorded = branch ? git(cwd, ["config", "--get", `branch.${branch}.codingFlowBase`]) : null;

  if (!recorded) return {};
  if (isBaseBranch(cwd, context)) {
    return { forkPointIgnored: { value: recorded, reason: `${branch} is a base branch: a fork point belongs to a story branch` } };
  }
  if (recorded === branch) {
    return { forkPointIgnored: { value: recorded, reason: "it names the branch itself, which would empty the diff" } };
  }

  return {};
}

// The fork point, then the nearest base: what the branch resolves to on its own.
function resolveRecorded(cwd, { story, branch, configured, ignoreForkPoint, found }) {
  let forkPointMissing = null;
  const ignored = forkPointIgnoredFor(cwd, { story, branch, configured });

  if (branch && !ignoreForkPoint && !ignored.forkPointIgnored) {
    const recorded = git(cwd, ["config", "--get", `branch.${branch}.codingFlowBase`]);

    if (recorded) {
      const hit = mergeBaseWith(cwd, recorded);

      if (hit) return found("fork-point", hit);

      // The epic branch was merged and removed: say so, then fall through.
      forkPointMissing = recorded;
    }
  }

  let best = null;
  let resolved = 0;

  for (const name of nearestCandidates(cwd, { story, branch })) {
    const hit = mergeBaseWith(cwd, name);

    if (!hit) continue;

    resolved += 1;
    const count = Number(git(cwd, ["rev-list", "--count", `${hit.mergeBase}..HEAD`]));

    if (best === null || count < best.count) best = { ...hit, count };
  }

  const extra = {
    ...(forkPointMissing ? { forkPointMissing } : {}),
    ...ignored,
  };

  if (best) {
    return found(resolved === 1 && best.ref === defaultBranch(cwd) ? "default" : "nearest", { ref: best.ref, mergeBase: best.mergeBase }, extra);
  }

  return found("none", { ref: null, mergeBase: null }, extra);
}

const SOURCE_LABEL = {
  flag: "--base",
  config: "baseBranch",
  "fork-point": "fork point",
  nearest: "nearest branch",
  default: "default branch",
};

// One sentence for verify, ship and status, so the three never word a scope
// differently: "Scope: story — diff against feature/EPIC-32-geo (fork point), 12 files".
function describeScope(diffBase, fileCount = null) {
  if (!diffBase) return null;

  const files = Number.isInteger(fileCount) ? `, ${fileCount} file${fileCount === 1 ? "" : "s"}` : "";

  if (!diffBase.ref) {
    return `Scope: ${diffBase.scope || "working-tree"} — no base to compare against, working tree only${files}`;
  }

  const ignored = [
    diffBase.forkPointIgnored ? `fork point ${diffBase.forkPointIgnored.value} ignored: ${diffBase.forkPointIgnored.reason}` : null,
    diffBase.configIgnored ? `${diffBase.configIgnored.reason}: ignored` : null,
  ].filter(Boolean);
  const notes = ignored.length ? ` (${ignored.join("; ")})` : "";

  return `Scope: ${diffBase.scope} — diff against ${diffBase.ref} (${SOURCE_LABEL[diffBase.source] || diffBase.source})${files}${notes}`;
}

module.exports = { resolveDiffBase, describeScope, baseBranchNames };
