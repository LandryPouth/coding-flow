"use strict";

// `ai-flow ship`: from the current branch (typically inside a worktree), pushes
// the branch and opens/updates ONE pull request against the base. One feature =
// one branch = one PR. Idempotent: if the PR already exists, the push is enough
// to update it, we don't recreate anything.
//
// Design choices:
//   - explicit (a command), never a pre-push hook: opening a PR is an outward
//     side effect that has no business in a hook (duplicates, CI failures...).
//   - the logic keys off the BRANCH, not the local layout (worktree or not): a
//     push never carries the layout, only commits.
//   - zero dependencies: shell-out to `git` (required) and `gh` (optional).
//     Without `gh`, we push and print the compare URL to open by hand.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { readConfig } = require("./config");
const { getStorage } = require("./storage");
const { collectHarnessReport } = require("./harness");
const { latestVerifyByStoryDir } = require("./audit");

// Idempotent markers: the evidence section is replaced between them, never the
// human text around it. Ship can thus refresh the proof without overwriting the
// PR description.
const EVIDENCE_START = "<!-- coding-flow:evidence:start -->";
const EVIDENCE_END = "<!-- coding-flow:evidence:end -->";

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function git(cwd, gitArgs, { allowFail = false } = {}) {
  try {
    const stdout = execFileSync("git", gitArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
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

function gh(ghArgs, cwd, { allowFail = true } = {}) {
  try {
    const stdout = execFileSync("gh", ghArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout: stdout || "" };
  } catch (err) {
    const stderr = (err.stderr || err.stdout || err.message || "").toString();
    if (allowFail) {
      return { code: err.status ?? 1, stdout: (err.stdout || "").toString(), stderr };
    }
    fail(`gh ${ghArgs.join(" ")} failed: ${stderr.trim()}`);
    return { code: 1, stdout: "", stderr };
  }
}

function requireRepo(cwd) {
  if (git(cwd, ["--version"], { allowFail: true }).code !== 0) {
    fail("git was not found in PATH.");
  }
  const root = git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (root.code !== 0) {
    fail("this directory is not a git repository.");
  }
  return root.stdout.trim();
}

function currentBranch(root) {
  const res = git(root, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true });
  const branch = res.stdout.trim();
  if (res.code !== 0 || branch === "HEAD") {
    fail("HEAD is detached: check out a branch before you ship.");
  }
  return branch;
}

// Default base: the remote's default branch (origin/HEAD), otherwise main,
// otherwise master.
function defaultBase(root) {
  const sym = git(root, ["symbolic-ref", "refs/remotes/origin/HEAD"], { allowFail: true });
  if (sym.code === 0 && sym.stdout.trim()) {
    return sym.stdout.trim().replace("refs/remotes/origin/", "");
  }
  for (const candidate of ["main", "master"]) {
    if (git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], { allowFail: true }).code === 0) {
      return candidate;
    }
  }
  return "main";
}

function localRefExists(root, ref) {
  return git(root, ["rev-parse", "--verify", "--quiet", ref], { allowFail: true }).code === 0;
}

function isGitHubRemote(url) {
  return /github\.com/i.test(url);
}

// Normalizes a git remote URL into a GitHub web URL (without .git).
function remoteToHttps(url) {
  let clean = url.trim().replace(/\.git$/, "");
  const sshMatch = clean.match(/^git@github\.com:(.+)$/i);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }
  clean = clean.replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/");
  return clean;
}

function ghAvailable() {
  return (() => {
    try {
      execFileSync("gh", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      return true;
    } catch {
      return false;
    }
  })();
}

// Latest `harness verify` evidence in the repo, best-effort. Absent/unreadable → null.
function latestVerifyEvidence(root) {
  const runsDir = path.join(root, ".coding-flow", "runs");

  if (!fs.existsSync(runsDir)) {
    return null;
  }

  const files = fs
    .readdirSync(runsDir)
    .filter((name) => name.endsWith("-verify.json"))
    .sort();

  if (files.length === 0) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(path.join(runsDir, files[files.length - 1]), "utf8"));
  } catch {
    return null;
  }
}

// Builds the markdown evidence section (between markers) from the verify JSON.
function buildEvidenceBlock(evidence) {
  const lines = [EVIDENCE_START, "### 🔬 Coding Flow — verify evidence", ""];

  const source = evidence.commandSource || "n/a";
  const count = evidence.commandsFound != null ? evidence.commandsFound : (evidence.results || []).length;
  lines.push(`**Result:** ${evidence.ok ? "✅ passed" : "❌ FAILED"} — ${count} command(s), source: \`${source}\``);

  const git = evidence.provenance && evidence.provenance.git;
  if (git) {
    const author = git.author && git.author.name ? git.author.name : "unknown";
    const dirty = git.dirty ? " (dirty tree)" : "";
    lines.push(`**Commit:** \`${git.shortCommit || git.commit}\`${dirty} · **Author:** ${author}`);
  }
  if (evidence.story) {
    lines.push(`**Story:** \`${evidence.story}\``);
  }
  const env = evidence.environment;
  if (env) {
    const lock = env.lockfile ? ` · lock \`${env.lockfile.name}@${(env.lockfile.sha256 || "").slice(0, 7)}\`` : "";
    lines.push(`**Toolchain:** ${env.node} · ${env.platform}/${env.arch}${lock}`);
  }
  lines.push(`**When:** ${evidence.generatedAt || "n/a"}`);
  lines.push("");

  const results = Array.isArray(evidence.results) ? evidence.results : [];
  if (results.length > 0) {
    lines.push("| Command | Result | Duration |", "| --- | --- | --- |");
    for (const item of results) {
      const status = item.ok ? "✅ exit 0" : item.timedOut ? "⏱ timeout" : `❌ exit ${item.exitCode}`;
      lines.push(`| \`${item.command}\` | ${status} | ${item.durationMs}ms |`);
    }
    lines.push("");
  }

  lines.push("_Generated by `ai-flow ship` from `.coding-flow/runs`._", EVIDENCE_END);
  return lines.join("\n");
}

// Inserts or replaces the evidence section in a PR body, without touching the rest.
function upsertEvidenceBlock(body, block) {
  const current = body || "";
  const startIndex = current.indexOf(EVIDENCE_START);
  const endIndex = current.indexOf(EVIDENCE_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = current.slice(0, startIndex);
    const after = current.slice(endIndex + EVIDENCE_END.length);
    return `${before}${block}${after}`;
  }

  return current.trim() ? `${current.trim()}\n\n${block}\n` : `${block}\n`;
}

// Refreshes the evidence section in the PR body (gh required).
function syncEvidenceIntoPr(root, branch, block) {
  const view = gh(["pr", "view", branch, "--json", "body"], root);
  let body = "";

  if (view.code === 0) {
    try {
      body = JSON.parse(view.stdout).body || "";
    } catch {
      body = "";
    }
  }

  const next = upsertEvidenceBlock(body, block);
  const edit = gh(["pr", "edit", branch, "--body", next], root);
  return edit.code === 0;
}

// Finds the story named after this branch (worktrees are named after their
// story dir, see `worktree add --story`) and the epic it belongs to. Best
// effort: a branch with no matching story (custom name, no epics/ at all)
// simply isn't linked to one.
function findStoryAndEpic(root, config, branch) {
  try {
    for (const epic of getStorage(root, config).listEpics()) {
      const story = epic.stories.find((s) => s.name === branch);
      if (story) {
        return { epic, story };
      }
    }
  } catch {
    // best-effort only — never block ship on a storage read failure.
  }
  return null;
}

// A generic-but-meaningful commit message: the story title when the branch is
// linked to one, the branch name otherwise.
function autoCommitMessage(root, config, branch) {
  const found = findStoryAndEpic(root, config, branch);
  return `chore(ship): ${found ? found.story.title : branch}`;
}

// Commits whatever is sitting dirty in the tree before ship pushes it, so
// "ship" is really the last step of a story instead of requiring a manual
// commit first. Gated by the same secret/sensitive-file scan `harness check
// --quick` runs: an automatic commit must never be the thing that leaks a
// credential a human would have caught in review.
function autoCommitDirtyTree(root, config, branch, { dryRun }) {
  const dirty = git(root, ["status", "--porcelain"], { allowFail: true }).stdout.trim().length > 0;

  if (!dirty) {
    return { committed: false, dirty: false };
  }

  const message = autoCommitMessage(root, config, branch);

  if (dryRun) {
    return { committed: false, dirty: true, message };
  }

  const report = collectHarnessReport({ quick: true });
  if (!report.ok) {
    fail(
      "dirty working tree, but the secret/sensitive-file check found issues — not committing.\n" +
        "  Run `ai-flow harness check` for details, fix them, then ship again (or commit by hand and re-run).",
    );
  }

  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", message]);
  log(`Committed: ${message}`);
  return { committed: true, dirty: false, message };
}

// Whether every story of the branch's epic is proof-backed, so the PR is safe to
// auto-merge. Not linked to a known story → never eligible.
//
// Deliberately reads captured verify evidence directly, NOT `story.status`: an
// explicit `## Status: done` in a story file wins over the machine signal
// everywhere else in the tool (`inferStoryStatus`), by design — a human override
// must stick. But that same shortcut lets an agent (or a human) claim "done" in
// prose without ever having run anything real. Auto-merge is the one decision
// that puts a PR into the base branch on its own, so it is the one place a
// written label is not enough — every story must have an actual captured green
// verify, or auto-merge stays off.
function epicCompleteness(root, config, branch) {
  const found = findStoryAndEpic(root, config, branch);
  if (!found) {
    return { eligible: false, reason: "branch is not linked to a known story" };
  }

  const { epic } = found;
  const verifyByDir = latestVerifyByStoryDir(root);
  const unproven = epic.stories.filter((s) => {
    const entry = verifyByDir.get(s.path);
    return !entry || entry.ok !== true;
  });

  if (unproven.length > 0) {
    return {
      eligible: false,
      epicName: epic.name,
      reason:
        `epic "${epic.name}" has ${unproven.length}/${epic.stories.length} stor${unproven.length === 1 ? "y" : "ies"} ` +
        `with no captured green verify (a written "done" is not proof): ${unproven.map((s) => s.name).join(", ")}`,
    };
  }

  return { eligible: true, epicName: epic.name, epic };
}

// Story branches are cut independently from the base, not stacked on one
// another — so nothing stops GitHub from merging story-02 before story-01 the
// moment both happen to go green together. That is exactly the race Walking
// Skeleton exists to prevent: a later story enriches a foundation the base does
// not have yet. Pure and injectable (`isOpenPr`) so it is unit-testable without
// a real `gh`. Sorted lexicographically: story dirs are zero-padded
// (`story-NN-MM-name`), so name order is delivery order.
function openSiblingsAhead(epic, branch, isOpenPr) {
  const ordered = [...epic.stories].sort((a, b) => a.name.localeCompare(b.name));
  const index = ordered.findIndex((s) => s.name === branch);

  if (index <= 0) {
    return [];
  }

  return ordered.slice(0, index).filter((s) => isOpenPr(s.name)).map((s) => s.name);
}

function prIsOpen(root, branchName) {
  const view = gh(["pr", "view", branchName, "--json", "state"], root);
  if (view.code !== 0) {
    return false;
  }
  try {
    return JSON.parse(view.stdout).state === "OPEN";
  } catch {
    return false;
  }
}

// Merges the PR on its own once its epic is fully done — via GitHub's native
// auto-merge (`--auto`), so required checks still gate the actual merge. Never
// attempted on a conflicting PR: conflicts are a human's call, not something
// ship resolves for you. Nor ahead of an earlier sibling story still open —
// see `openSiblingsAhead`.
function maybeAutoMerge(root, config, branch, targetBase, { autoMerge, mergeMethod }) {
  if (!autoMerge) {
    return;
  }

  const completeness = epicCompleteness(root, config, branch);
  if (!completeness.eligible) {
    log(`Auto-merge: ${completeness.reason} — skipped.`);
    return;
  }

  const blockers = openSiblingsAhead(completeness.epic, branch, (name) => prIsOpen(root, name));
  if (blockers.length > 0) {
    log(
      `Auto-merge: waiting for earlier ${blockers.length === 1 ? "story" : "stories"} in epic ` +
        `"${completeness.epicName}" to merge first: ${blockers.join(", ")} — skipped.`,
    );
    return;
  }

  const view = gh(["pr", "view", branch, "--json", "mergeable"], root);
  if (view.code === 0) {
    let mergeable = "";
    try {
      mergeable = JSON.parse(view.stdout).mergeable || "";
    } catch {
      mergeable = "";
    }
    if (mergeable === "CONFLICTING") {
      log(`Auto-merge: PR conflicts with "${targetBase}" — resolve them, then ship again.`);
      return;
    }
  }

  const merge = gh(["pr", "merge", branch, `--${mergeMethod}`, "--auto", "--delete-branch"], root);
  if (merge.code === 0) {
    log(
      `Auto-merge: epic "${completeness.epicName}" complete — merge into "${targetBase}" enabled ` +
        "(GitHub merges it once required checks pass).",
    );
  } else {
    log(`Auto-merge: could not enable — ${merge.stderr.trim() || "unknown gh error"}. Merge the PR manually.`);
  }
}

function ship({
  base = null,
  draft = false,
  title = null,
  web = false,
  dryRun = false,
  includeEvidence = true,
  commit = true,
  autoMerge = null,
  mergeMethod = "merge",
  cwd,
}) {
  const root = requireRepo(cwd);
  const branch = currentBranch(root);
  const targetBase = base || defaultBase(root);

  if (branch === targetBase) {
    fail(`you are on the base "${targetBase}". Check out a feature branch before you ship.`);
  }

  const config = readConfig(root);
  const autoMergeEnabled = autoMerge === null ? !!config.autoMergeEpic : autoMerge;

  const originUrl = git(root, ["remote", "get-url", "origin"], { allowFail: true });
  if (originUrl.code !== 0) {
    fail("no 'origin' remote. Add it with: git remote add origin <url>.");
  }
  const remoteUrl = originUrl.stdout.trim();

  const commitResult = commit ? autoCommitDirtyTree(root, config, branch, { dryRun }) : { committed: false, dirty: false };

  // Commits to ship: above the base (local if present, otherwise origin).
  const baseRef = localRefExists(root, targetBase)
    ? targetBase
    : localRefExists(root, `origin/${targetBase}`)
      ? `origin/${targetBase}`
      : targetBase;
  const ahead = git(root, ["rev-list", "--count", `${baseRef}..HEAD`], { allowFail: true });
  if (ahead.code === 0 && ahead.stdout.trim() === "0" && !commitResult.dirty) {
    fail(`no commits to ship: "${branch}" has nothing above "${targetBase}".`);
  }

  const dirty = git(root, ["status", "--porcelain"], { allowFail: true }).stdout.trim().length > 0;
  const github = isGitHubRemote(remoteUrl);
  const canPr = github && ghAvailable();
  const evidence = includeEvidence ? latestVerifyEvidence(root) : null;

  if (dryRun) {
    log("Dry run — nothing is pushed.");
    log(`  branch : ${branch}`);
    log(`  base   : ${targetBase}`);
    if (commitResult.dirty && commit) {
      log(`  commit : would commit the dirty tree as "${commitResult.message}"`);
    } else if (dirty) {
      log("  note   : dirty working tree (uncommitted changes will not be pushed; --no-commit).");
    }
    log(`  push   : git push -u origin ${branch}`);
    if (canPr) {
      log(`  PR     : ${draft ? "draft " : ""}${targetBase} <- ${branch} (created if absent, otherwise updated)`);
      log(
        `  merge  : ${
          autoMergeEnabled
            ? "auto-merge on — merged once the epic is fully done and the PR is conflict-free"
            : "auto-merge off"
        }`,
      );
    } else if (github) {
      log("  PR     : gh absent — the compare URL will be printed.");
    } else {
      log("  PR     : non-GitHub remote — PR not managed, push only.");
    }
    if (includeEvidence && canPr) {
      if (evidence) {
        log(`  evidence: latest verify (${evidence.ok ? "passed" : "FAILED"}) will be attached to the PR body.`);
      } else {
        log("  evidence: none (run `ai-flow verify --story <dir>` before you ship to attach the proof).");
      }
    }
    return;
  }

  if (dirty) {
    log("Note: dirty working tree — only commits are pushed, not the uncommitted changes (--no-commit).");
  }

  const push = git(root, ["push", "-u", "origin", branch], { allowFail: true });
  if (push.code !== 0) {
    fail(`push failed: ${push.stderr.trim()}`);
  }
  log(`Pushed: origin/${branch}`);

  if (!github) {
    log("Non-GitHub remote: branch pushed, PR not managed.");
    return;
  }

  if (!canPr) {
    const compare = `${remoteToHttps(remoteUrl)}/compare/${targetBase}...${branch}?expand=1`;
    log("gh CLI absent: open the PR here:");
    log(`  ${compare}`);
    return;
  }

  // Attaches/refreshes the verify proof in the PR body (idempotent).
  function attachEvidence() {
    if (!includeEvidence) {
      return;
    }
    if (!evidence) {
      log("Note: no verify evidence — run `ai-flow verify --story <dir>` before you ship to attach the proof.");
      return;
    }
    if (syncEvidenceIntoPr(root, branch, buildEvidenceBlock(evidence))) {
      log(`Verify evidence (${evidence.ok ? "passed" : "FAILED"}) attached to the PR body.`);
    }
  }

  // gh present: existing PR? (idempotent — the push already updated it)
  const existing = gh(["pr", "view", branch, "--json", "url,state"], root);
  if (existing.code === 0) {
    let url = "";
    try {
      url = JSON.parse(existing.stdout).url || "";
    } catch {
      url = "";
    }
    log(`PR already open (updated by the push)${url ? `: ${url}` : "."}`);
    attachEvidence();
    maybeAutoMerge(root, config, branch, targetBase, { autoMerge: autoMergeEnabled, mergeMethod });
    if (web && url) {
      gh(["pr", "view", branch, "--web"], root);
    }
    return;
  }

  // PR creation.
  const createArgs = ["pr", "create", "--base", targetBase, "--head", branch];
  if (title) {
    createArgs.push("--title", title, "--body", "");
  } else {
    createArgs.push("--fill");
  }
  if (draft) {
    createArgs.push("--draft");
  }
  const created = gh(createArgs, root);
  if (created.code !== 0) {
    fail(`PR creation failed: ${created.stderr.trim()}`);
  }
  const url = created.stdout.trim().split(/\s+/).find((token) => token.startsWith("http")) || created.stdout.trim();
  log(`PR ${draft ? "(draft) " : ""}created: ${url}`);
  attachEvidence();
  if (!draft) {
    maybeAutoMerge(root, config, branch, targetBase, { autoMerge: autoMergeEnabled, mergeMethod });
  }
  if (web && url) {
    gh(["pr", "view", branch, "--web"], root);
  }
}

const MERGE_METHODS = new Set(["merge", "squash", "rebase"]);

function shipCommand({ getFlagValue, flags, cwd }) {
  const mergeMethod = getFlagValue("--merge-method", "merge");
  if (!MERGE_METHODS.has(mergeMethod)) {
    fail(`--merge-method must be one of: ${[...MERGE_METHODS].join(", ")} (got "${mergeMethod}").`);
  }

  ship({
    base: getFlagValue("--base", null),
    title: getFlagValue("--title", null),
    draft: flags.has("--draft"),
    web: flags.has("--web"),
    dryRun: flags.has("--dry-run"),
    includeEvidence: !flags.has("--no-evidence"),
    commit: !flags.has("--no-commit"),
    autoMerge: flags.has("--auto-merge") ? true : flags.has("--no-auto-merge") ? false : null,
    mergeMethod,
    cwd,
  });
}

module.exports = {
  shipCommand,
  buildEvidenceBlock,
  upsertEvidenceBlock,
  latestVerifyEvidence,
  epicCompleteness,
  openSiblingsAhead,
};
