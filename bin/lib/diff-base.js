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
// A flag or a configured base that IS HEAD on a branch with commits of its own
// would empty the diff: the flag is refused, a baseBranch the branch set itself
// gives way to the one committed at its base.
//
// Pure read. Never throws except for an explicit --base that does not resolve
// or empties the diff: a flag the user typed must not be silently replaced by a
// guess.

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

  const leaf = branch.split("/").pop();
  const storyLeaf = story ? String(story).replace(/\/+$/, "").split("/").pop() : null;

  if (source === "fork-point" || /^story-/i.test(leaf) || (storyLeaf && leaf === storyLeaf)) {
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
  const found = (source, hit, extra = {}) => ({
    ref: hit.ref,
    mergeBase: hit.mergeBase,
    source,
    scope: classifyScope({ cwd, branch, source, story }),
    ...extra,
  });

  // A base that IS HEAD empties every committed change. That is a choice on a
  // branch with nothing of its own, and a hole on one with commits: the diff,
  // and the policy read at its base, would skip all of them (story 13-07).
  // "Its own" is against the shared branches, not the fork point: that is a
  // local setting, and the one on a base branch is exactly what 13-07 ignores.
  const withoutChoice = () => resolveRecorded(cwd, { story, branch, ignoreForkPoint: true, found });
  const ownCommits = (hit) => {
    if (!head || hit.mergeBase !== head || baseBranchNames(cwd).includes(branch)) return null;

    const fallback = withoutChoice();

    if (!fallback.mergeBase || fallback.mergeBase === head) return null;

    return { fallback, count: Number(git(cwd, ["rev-list", "--count", `${fallback.mergeBase}..HEAD`])) };
  };

  if (flagBase) {
    const hit = mergeBaseWith(cwd, flagBase);

    if (!hit) {
      throw new Error(`--base "${flagBase}" does not resolve to a ref with a merge-base against HEAD.`);
    }

    const own = ownCommits(hit);

    if (own) {
      throw new Error(
        `--base "${flagBase}" is HEAD itself: this branch has ${own.count} commit(s) of its own since ` +
          `${own.fallback.ref}, and the diff would hide them all. Pass --base ${own.fallback.ref} (or omit --base).`,
      );
    }

    return found("flag", hit);
  }

  const configured = readConfig(cwd).baseBranch;
  let effective = typeof configured === "string" && configured ? configured : null;
  let configuredHit = effective ? mergeBaseWith(cwd, effective) : null;
  let configIgnored = null;

  const own = configuredHit ? ownCommits(configuredHit) : null;

  if (own) {
    const atBase = baseBranchAt(cwd, own.fallback.mergeBase);

    // Committed at the base already: the repository chose it, not this branch.
    if (atBase !== configured) {
      configIgnored = {
        value: configured,
        reason: `baseBranch "${configured}" is set by this branch and would empty its diff (${own.count} commit(s) since ${own.fallback.ref})`,
      };
      const baseHit = atBase ? mergeBaseWith(cwd, atBase) : null;

      effective = atBase;
      configuredHit = baseHit && baseHit.mergeBase !== head ? baseHit : null;
      if (!configuredHit) return { ...resolveRecorded(cwd, { story, branch, ignoreForkPoint, found }), configIgnored };
    }
  }

  if (configuredHit) {
    return found("config", configuredHit, { ...forkPointIgnoredFor(cwd, branch, effective), ...(configIgnored ? { configIgnored } : {}) });
  }

  // A configured base that does not resolve is not silently ignored: it is
  // recorded, as a missing fork point is.
  const configUnresolved = effective;
  const result = resolveRecorded(cwd, { story, branch, ignoreForkPoint, found });

  return configUnresolved ? { ...result, configUnresolved } : result;
}

// A fork point recorded on a base branch: not used, and named with why.
function forkPointIgnoredFor(cwd, branch, configured) {
  if (!branch || !baseBranchNames(cwd, configured).includes(branch)) return {};

  const recorded = git(cwd, ["config", "--get", `branch.${branch}.codingFlowBase`]);

  return recorded ? { forkPointIgnored: { value: recorded, reason: `${branch} is a base branch: a fork point belongs to a story branch` } } : {};
}

// The fork point, then the nearest base: what the branch resolves to on its own.
function resolveRecorded(cwd, { story, branch, ignoreForkPoint, found }) {
  let forkPointMissing = null;
  // Not the configured baseBranch: one that is honoured never reaches here.
  const ignored = forkPointIgnoredFor(cwd, branch, null);

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
