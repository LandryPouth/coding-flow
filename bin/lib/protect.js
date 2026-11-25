"use strict";

// Story 29-08: `ai-flow protect` makes "auto-merge waits for the checks" true in
// the project the tool is installed in, instead of assuming it. GitHub's
// auto-merge only waits on REQUIRED status checks; on an unprotected base it
// merges at once, CI or not.
//
// What it does, through `gh api` (classic branch protection only):
//   - required status checks = the check runs GitHub reports on the branch's
//     latest commit (read, never guessed), `strict: false`;
//   - no reviews, `enforce_admins: false`, no force pushes, no deletion — on a
//     branch that has no protection yet;
//   - on a branch that has one, it only ADDS the missing checks: reviews,
//     restrictions and the checks already required are kept. A second run sends
//     nothing.
//   - a branch governed by a repository ruleset is reported and left alone.
//
// It never protects a branch with an empty check list: no check runs means the
// project needs CI first. Every blocker (no `gh`, no admin rights, not GitHub,
// no CI) is a reason plus the next command, never a crash — `init` calls this
// and must not fail on it.

const { execFileSync } = require("child_process");

const { readConfig } = require("./config");

function firstLine(text) {
  return String(text || "").trim().split(/\r?\n/)[0] || "";
}

function gh(root, args, body) {
  const input = body === undefined ? undefined : JSON.stringify(body);
  try {
    const stdout = execFileSync("gh", args, {
      cwd: root,
      encoding: "utf8",
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: 60000,
    });
    return { ok: true, stdout: stdout || "" };
  } catch (error) {
    return {
      ok: false,
      missing: error.code === "ENOENT",
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || error.message || ""),
    };
  }
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function originUrl(root) {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function isGitHubOrigin(root) {
  const url = originUrl(root);
  return Boolean(url) && /github\.com/i.test(url);
}

const NEXT_RUN = "then run `ai-flow protect`";

// The repository as `gh` sees it, or the reason it cannot be read.
function resolveRepo(root) {
  const url = originUrl(root);

  if (!url) {
    return { blocked: "no `origin` remote — branch protection is GitHub only", next: `add a GitHub remote (\`git remote add origin <url>\`), ${NEXT_RUN}` };
  }

  if (!/github\.com/i.test(url)) {
    return { blocked: "the `origin` remote is not on GitHub — branch protection is GitHub only", next: null, notGitHub: true };
  }

  const version = gh(root, ["--version"]);
  if (!version.ok) {
    return {
      blocked: version.missing ? "`gh` (GitHub CLI) is not installed" : `\`gh\` does not run (${firstLine(version.stderr)})`,
      next: `install gh (https://cli.github.com), run \`gh auth login\`, ${NEXT_RUN}`,
    };
  }

  const view = gh(root, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef,viewerPermission"]);
  const data = view.ok ? parse(view.stdout) : null;
  if (!data || !data.nameWithOwner) {
    return {
      blocked: `\`gh\` cannot read this repository (${firstLine(view.stderr) || "no answer"})`,
      next: `run \`gh auth login\`, ${NEXT_RUN}`,
    };
  }

  return {
    repo: data.nameWithOwner,
    defaultBranch: data.defaultBranchRef && data.defaultBranchRef.name ? data.defaultBranchRef.name : null,
    permission: data.viewerPermission || null,
  };
}

const notFound = (res) => /HTTP 404|Not Found|not protected/i.test(res.stderr);

// What GitHub says about one branch: its latest commit, its classic
// protection (null when none), and the ruleset rules that apply to it.
function inspectBranch(root, repo, branch) {
  const ref = encodeURIComponent(branch);
  const info = gh(root, ["api", `repos/${repo}/branches/${ref}`]);

  if (!info.ok) {
    return notFound(info) ? { branch, missing: true } : { branch, error: firstLine(info.stderr) || "gh api failed" };
  }

  const data = parse(info.stdout) || {};
  const sha = data.commit && data.commit.sha ? data.commit.sha : null;
  const rulesRes = gh(root, ["api", `repos/${repo}/rules/branches/${ref}`]);
  const rules = rulesRes.ok && Array.isArray(parse(rulesRes.stdout)) ? parse(rulesRes.stdout) : [];
  const prot = gh(root, ["api", `repos/${repo}/branches/${ref}/protection`]);

  if (!prot.ok && !notFound(prot)) {
    return { branch, sha, rules, error: firstLine(prot.stderr) || "gh api failed" };
  }

  return { branch, sha, rules, protection: prot.ok ? parse(prot.stdout) : null };
}

function requiredChecksOf(protection) {
  const rsc = protection && protection.required_status_checks;
  if (!rsc) return [];
  const names = [
    ...(Array.isArray(rsc.contexts) ? rsc.contexts : []),
    ...(Array.isArray(rsc.checks) ? rsc.checks.map((check) => check && check.context) : []),
  ].filter((name) => typeof name === "string" && name);
  return [...new Set(names)];
}

// Whether GitHub's auto-merge would wait for a check on this branch.
function isGated(info) {
  if (requiredChecksOf(info.protection).length > 0) return true;
  return (info.rules || []).some((rule) => rule && rule.type === "required_status_checks");
}

function checkRunNames(root, repo, sha) {
  const res = gh(root, ["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`]);
  const data = res.ok ? parse(res.stdout) : null;

  if (!data || !Array.isArray(data.check_runs)) {
    return { error: firstLine(res.stderr) || "no answer" };
  }

  return { names: [...new Set(data.check_runs.map((run) => run && run.name).filter(Boolean))].sort() };
}

function freshProtection(checks) {
  return {
    required_status_checks: { strict: false, checks: checks.map((context) => ({ context })) },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

const enabled = (setting) => Boolean(setting && setting.enabled);
const names = (list, key) => (Array.isArray(list) ? list.map((item) => item && item[key]).filter(Boolean) : []);
const actors = (who) => ({ users: names(who.users, "login"), teams: names(who.teams, "slug"), apps: names(who.apps, "slug") });

// The PUT body that keeps everything an existing protection has and adds the
// required checks. Only used when the protection has no required checks yet
// (otherwise the additive contexts endpoint is enough and touches nothing else).
function keepAndAddChecks(existing, checks) {
  const reviews = existing.required_pull_request_reviews;

  return {
    required_status_checks: { strict: false, checks: checks.map((context) => ({ context })) },
    enforce_admins: enabled(existing.enforce_admins),
    required_pull_request_reviews: reviews
      ? {
          dismiss_stale_reviews: Boolean(reviews.dismiss_stale_reviews),
          require_code_owner_reviews: Boolean(reviews.require_code_owner_reviews),
          required_approving_review_count: Number.isInteger(reviews.required_approving_review_count) ? reviews.required_approving_review_count : 1,
          require_last_push_approval: Boolean(reviews.require_last_push_approval),
          ...(reviews.dismissal_restrictions ? { dismissal_restrictions: actors(reviews.dismissal_restrictions) } : {}),
          ...(reviews.bypass_pull_request_allowances ? { bypass_pull_request_allowances: actors(reviews.bypass_pull_request_allowances) } : {}),
        }
      : null,
    restrictions: existing.restrictions ? actors(existing.restrictions) : null,
    required_linear_history: enabled(existing.required_linear_history),
    allow_force_pushes: enabled(existing.allow_force_pushes),
    allow_deletions: enabled(existing.allow_deletions),
    block_creations: enabled(existing.block_creations),
    required_conversation_resolution: enabled(existing.required_conversation_resolution),
    lock_branch: enabled(existing.lock_branch),
    allow_fork_syncing: enabled(existing.allow_fork_syncing),
  };
}

// One branch: what would change, and the one request that changes it.
function planBranch(root, repo, branch) {
  const info = inspectBranch(root, repo, branch);
  const blocked = (reason, next) => ({ branch, action: "blocked", reason, next });

  if (info.missing) return blocked(`branch "${branch}" does not exist on GitHub`, `push it, ${NEXT_RUN}`);
  if (info.error) return blocked(`GitHub did not answer for "${branch}" (${info.error})`, `check \`gh auth status\`, ${NEXT_RUN}`);

  if (info.rules.length > 0) {
    return {
      branch,
      action: "ruleset",
      gated: isGated(info),
      reason: "governed by a repository ruleset — left alone (classic branch protection only)",
    };
  }

  const required = requiredChecksOf(info.protection);
  const runs = info.sha ? checkRunNames(root, repo, info.sha) : { names: [] };
  if (runs.error) return blocked(`could not read the check runs of "${branch}" (${runs.error})`, `check \`gh auth status\`, ${NEXT_RUN}`);

  const missing = runs.names.filter((name) => !required.includes(name));
  const base = `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`;

  if (missing.length === 0 && required.length > 0) {
    return { branch, action: "unchanged", required, reason: `already requires ${required.join(", ")}` };
  }

  if (missing.length === 0) {
    return blocked(
      `no check runs on "${branch}"'s latest commit${info.sha ? ` (${info.sha.slice(0, 7)})` : ""} — the project needs CI first; a protection with no required check would not stop a merge`,
      `add CI (\`ai-flow ci init\`), push so it runs on "${branch}", ${NEXT_RUN}`,
    );
  }

  if (!info.protection) {
    return { branch, action: "protect", required: [], missing, request: { method: "PUT", path: base, body: freshProtection(missing) } };
  }

  if (info.protection.required_status_checks) {
    return {
      branch,
      action: "add-checks",
      required,
      missing,
      request: { method: "POST", path: `${base}/required_status_checks/contexts`, body: { contexts: missing } },
    };
  }

  return { branch, action: "add-checks", required, missing, request: { method: "PUT", path: base, body: keepAndAddChecks(info.protection, missing) } };
}

function targetBranches(root, repoInfo, explicit) {
  if (explicit && explicit.length > 0) return [...new Set(explicit)];
  const configured = readConfig(root).baseBranch;
  return [...new Set([repoInfo.defaultBranch, typeof configured === "string" && configured ? configured : null].filter(Boolean))];
}

// The whole run. `exitCode` 2 when anything was blocked, 0 otherwise.
function runProtect(root, { branches = [], dryRun = false } = {}) {
  const repoInfo = resolveRepo(root);

  if (repoInfo.blocked) {
    return { ok: false, exitCode: 2, dryRun, repo: null, reason: repoInfo.blocked, next: repoInfo.next, notGitHub: Boolean(repoInfo.notGitHub), branches: [] };
  }

  if (repoInfo.permission !== "ADMIN") {
    return {
      ok: false,
      exitCode: 2,
      dryRun,
      repo: repoInfo.repo,
      reason: `no admin rights on ${repoInfo.repo} (${repoInfo.permission || "unknown"}) — protecting a branch needs them`,
      next: "ask a repository admin to run `ai-flow protect`",
      branches: [],
    };
  }

  const results = targetBranches(root, repoInfo, branches).map((branch) => planBranch(root, repoInfo.repo, branch));

  if (!dryRun) {
    for (const result of results.filter((entry) => entry.request)) {
      const { method, path: apiPath, body } = result.request;
      const sent = gh(root, ["api", "-X", method, apiPath, "--input", "-"], body);
      result.applied = sent.ok;
      if (!sent.ok) {
        result.action = "blocked";
        result.reason = `GitHub refused the protection (${firstLine(sent.stderr) || "unknown error"})`;
        result.next = `check your admin rights with \`gh auth status\`, ${NEXT_RUN}`;
      }
    }
  }

  const blocked = results.filter((entry) => entry.action === "blocked");
  return {
    ok: blocked.length === 0,
    exitCode: blocked.length === 0 ? 0 : 2,
    dryRun,
    repo: repoInfo.repo,
    reason: blocked.length > 0 ? blocked.map((entry) => `${entry.branch}: ${entry.reason}`).join("; ") : null,
    next: blocked.length > 0 ? blocked[0].next : null,
    branches: results,
  };
}

function describeBranch(entry, dryRun) {
  const will = (text) => (dryRun ? `would ${text}` : text);
  if (entry.action === "protect") {
    return `${entry.branch}: ${will(`${dryRun ? "protect" : "protected"} — requires ${entry.missing.join(", ")}`)} (strict: false, no reviews, enforce_admins: false, no force push, no deletion)`;
  }
  if (entry.action === "add-checks") {
    return `${entry.branch}: ${will(`${dryRun ? "add" : "added"} required check(s) ${entry.missing.join(", ")}`)}; kept ${entry.required.length ? entry.required.join(", ") : "no check"} and every other rule`;
  }
  if (entry.action === "unchanged") return `${entry.branch}: nothing to change — ${entry.reason}`;
  if (entry.action === "ruleset") return `${entry.branch}: ${entry.reason}`;
  return `${entry.branch}: not protected — ${entry.reason}`;
}

function formatReport(report) {
  if (!report.repo || report.branches.length === 0) {
    return [`Branch protection: not done — ${report.reason}`, ...(report.next ? [`Next: ${report.next}`] : [])];
  }

  const lines = [`Branch protection (${report.repo}):`, ...report.branches.map((entry) => `  ${describeBranch(entry, report.dryRun)}`)];
  const changes = report.branches.filter((entry) => entry.request).length;

  if (report.dryRun) lines.push(changes > 0 ? "Dry run — nothing sent." : "Dry run — nothing to change.");
  if (report.next) lines.push(`Next: ${report.next}`);
  return lines;
}

// `init`: protect when the project is a GitHub repository, quietly skip when it
// is not, and never fail the install.
function protectOnInit(root, { dryRun = false, skip = null } = {}) {
  try {
    if (!isGitHubOrigin(root)) return [];
    if (skip) return [`Branch protection: skipped (${skip})`];
    return formatReport(runProtect(root, { dryRun }));
  } catch (error) {
    return [`Branch protection: not done — ${error.message}`];
  }
}

// `ship`: may auto-merge be armed on this base? Protects it first when it can.
function ensureBaseGated(root, base, { protectBranches = true } = {}) {
  const repoInfo = resolveRepo(root);
  if (repoInfo.blocked) return { gated: false, reason: repoInfo.blocked, next: repoInfo.next };

  const info = inspectBranch(root, repoInfo.repo, base);
  if (info.error || info.missing) {
    return { gated: false, reason: info.missing ? `"${base}" does not exist on GitHub` : `could not read "${base}"'s protection (${info.error})`, next: NEXT_RUN.replace(/^then /, "") };
  }
  if (isGated(info)) return { gated: true };

  if (!protectBranches) {
    return { gated: false, reason: "protectBranches is false in .coding-flow/config.json", next: `protect "${base}" with required checks, or run \`ai-flow protect --branch ${base}\`` };
  }

  const report = runProtect(root, { branches: [base] });
  const entry = report.branches[0];
  if (entry && entry.applied) return { gated: true, protected: describeBranch(entry, false) };
  return { gated: false, reason: entry ? entry.reason : report.reason, next: entry ? entry.next : report.next };
}

// `doctor`: the bases auto-merge would merge into with no required check.
// Silent (empty) on anything it cannot read.
function ungatedBases(root) {
  if (!isGitHubOrigin(root)) return [];
  const repoInfo = resolveRepo(root);
  if (repoInfo.blocked) return [];
  return targetBranches(root, repoInfo, []).filter((branch) => {
    const info = inspectBranch(root, repoInfo.repo, branch);
    return !info.error && !info.missing && !isGated(info);
  });
}

function protectCommand({ args, flags, cwd }) {
  const branches = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--branch" && args[index + 1] && !args[index + 1].startsWith("-")) branches.push(args[index + 1]);
    else if (args[index].startsWith("--branch=")) branches.push(args[index].slice("--branch=".length));
  }

  const report = runProtect(cwd, { branches, dryRun: flags.has("--dry-run") });

  if (flags.has("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(report).join("\n")}\n`);
  }
  process.exitCode = report.exitCode;
}

module.exports = {
  runProtect,
  formatReport,
  protectOnInit,
  ensureBaseGated,
  ungatedBases,
  protectCommand,
  keepAndAddChecks,
  freshProtection,
  requiredChecksOf,
};
