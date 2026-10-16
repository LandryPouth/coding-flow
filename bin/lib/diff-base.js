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
//   fork-point  git config branch.<name>.codingFlowBase, written by `worktree add`
//   nearest     closest of: the story's epic branch, develop, the default branch
//   default     today's behaviour: origin/HEAD, else main
//   none        no merge-base at all — the caller falls back to the working tree
//
// Pure read. Never throws except for an explicit --base that does not resolve:
// a flag the user typed must not be silently replaced by a guess.

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

function resolveDiffBase(cwd, { story = null, flagBase = null } = {}) {
  const branch = currentBranch(cwd);
  const found = (source, hit, extra = {}) => ({
    ref: hit.ref,
    mergeBase: hit.mergeBase,
    source,
    scope: classifyScope({ cwd, branch, source, story }),
    ...extra,
  });

  if (flagBase) {
    const hit = mergeBaseWith(cwd, flagBase);

    if (!hit) {
      throw new Error(`--base "${flagBase}" does not resolve to a ref with a merge-base against HEAD.`);
    }

    return found("flag", hit);
  }

  const configured = readConfig(cwd).baseBranch;
  const configuredHit = typeof configured === "string" && configured ? mergeBaseWith(cwd, configured) : null;

  if (configuredHit) return found("config", configuredHit);

  // A configured base that does not resolve is not silently ignored: it is
  // recorded, as a missing fork point is.
  const configUnresolved = configured && !configuredHit && typeof configured === "string" ? configured : null;

  let forkPointMissing = null;

  if (branch) {
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
    ...(configUnresolved ? { configUnresolved } : {}),
  };

  if (best) {
    return found(resolved === 1 && best.ref === defaultBranch(cwd) ? "default" : "nearest", best, extra);
  }

  return found("none", { ref: null, mergeBase: null }, extra);
}

module.exports = { resolveDiffBase };
