"use strict";

// Story 29-08: `ai-flow protect` makes "auto-merge waits for the checks" true in
// the project the tool is installed in, instead of assuming it. GitHub's
// auto-merge only waits on REQUIRED status checks; on an unprotected base it
// merges at once, CI or not.
//
// What it does, through `gh api` (classic branch protection only):
//   - required status checks = the check runs GitHub reports on the branch's
//     latest commit AND on the head commit of a recent pull request into it
//     (read, never guessed), `strict: false`. A check that runs only on push
//     (deploy, release, pages) never reports on a pull request: requiring it
//     would leave every PR pending forever. No pull request yet means the
//     pull-request checks are unknown, so nothing is protected;
//   - no reviews, `enforce_admins: false`, no force pushes, no deletion — on a
//     branch that has no protection yet;
//   - on a branch that has one, it only ADDS the missing checks: reviews,
//     restrictions and the checks already required are kept. A second run sends
//     nothing.
//   - a branch governed by a repository ruleset is reported and left alone;
//     one whose ruleset has no required status checks rule is pending (exit 2):
//     auto-merge would merge into it at once, and the fix is in the ruleset.
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

// A private repository on GitHub Free has no branch protection at all: GitHub
// answers 403 "Upgrade to GitHub Pro or make this repository public". That is
// a plan limit, not an auth problem, and no `gh auth` fixes it.
const PLAN_LIMIT = "branch protection is not available on this plan (private repository on GitHub Free)";
const PLAN_NEXT =
  "merge each pull request by hand once its checks pass (auto-merge cannot wait for them here), " +
  "or make the repository public or move it to a paid plan, then run `ai-flow protect`";
// A ruleset branch is fixed in the ruleset, never by classic protection.
const rulesetNext = (branch) => `add a required status checks rule to the ruleset protecting "${branch}" (Settings → Rules → Rulesets)`;
const RULESET_UNGATED = "governed by a repository ruleset with no required status checks rule, so GitHub would merge at once";
const isPlanLimit = (text) => /Upgrade to GitHub Pro|make this repository public to enable this feature/i.test(String(text || ""));

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
    // A 5xx is GitHub not answering, not a login problem.
    const transient = /HTTP 5\d\d/.test(view.stderr || "");
    return {
      blocked: `\`gh\` cannot read this repository (${firstLine(view.stderr) || "no answer"})`,
      next: transient ? `try again once GitHub answers, ${NEXT_RUN}` : `run \`gh auth login\`, ${NEXT_RUN}`,
      transient,
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
    return { branch, sha, rules, error: firstLine(prot.stderr) || "gh api failed", planLimit: isPlanLimit(prot.stderr) };
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

// The checks GitHub saw on pull requests into this branch: the check runs of
// the head commit of its most recent pull requests (open, merged or closed).
// `names` are the checks seen on EVERY one of them that had checks: a check
// that runs only on some paths (`paths:`) or only on fork pull requests would
// keep the others pending forever once required. `partial` is the rest.
// `withoutChecks` counts the pull requests that ran no check at all (a CI with
// a `paths:` filter skipped them): any required check would keep such a pull
// request pending forever. `{ prs: 0 }` when there is none yet.
function pullRequestCheckNames(root, repo, branch) {
  const list = gh(root, ["pr", "list", "-R", repo, "--base", branch, "--state", "all", "-L", "5", "--json", "headRefOid"]);
  const prs = list.ok ? parse(list.stdout) : null;
  if (!Array.isArray(prs)) return { error: firstLine(list.stderr) || "no answer" };

  const shas = [...new Set(prs.map((pr) => pr && pr.headRefOid).filter(Boolean))];
  const perPr = [];
  let withoutChecks = 0;
  for (const sha of shas) {
    const runs = checkRunNames(root, repo, sha);
    if (runs.error) return { error: runs.error };
    if (runs.names.length > 0) perPr.push(runs.names);
    else withoutChecks += 1;
  }
  const union = [...new Set(perPr.flat())].sort();
  const onEvery = union.filter((name) => perPr.every((list) => list.includes(name)));
  return { prs: shas.length, withoutChecks, names: onEvery, partial: union.filter((name) => !onEvery.includes(name)) };
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

// No check of the branch ran on every recent pull request into it.
function noPullRequestCheck(branch, runs, extra) {
  const reason = extra.partial.length > 0
    ? `none of the checks on "${branch}"'s latest commit (${runs.names.join(", ")}) ran on every recent pull request into it — requiring one would keep the pull requests that skip it pending`
    : `none of the checks on "${branch}"'s latest commit (${runs.names.join(", ")}) was seen on a pull request into it — requiring them would keep every pull request pending`;
  return { branch, action: "blocked", ...extra, reason, next: `run CI on every pull request (\`on: pull_request\`, no \`paths:\` filter), open one pull request into "${branch}", ${NEXT_RUN}` };
}

// A recent pull request ran no check: requiring any (more) would block such
// pull requests forever. An existing protection is left as is, not weakened.
function pullRequestWithoutChecks(branch, info, required) {
  const next = `run CI on every pull request into "${branch}" (\`on: pull_request\`, no \`paths:\` filter), ${NEXT_RUN}`;
  if (info.protection) {
    const reason = required.length
      ? `left as is (requires ${required.join(", ")}) — a recent pull request ran no checks; requiring more would block such pull requests`
      : "left as is (no required check; its other rules kept) — a recent pull request ran no checks; requiring a check would block such pull requests";
    return { branch, action: "blocked", leftAsIs: true, reason, next };
  }
  const reason = "a recent pull request ran no checks (a `paths:` filter?) — requiring checks would block such pull requests forever";
  return { branch, action: "blocked", reason, next };
}

// A ruleset branch is left alone. Without a required status checks rule it
// is pending, not settled: auto-merge would merge into it at once.
function rulesetBranch(branch, info) {
  if (isGated(info)) {
    return { branch, action: "ruleset", gated: true, reason: "governed by a repository ruleset — left alone (classic branch protection only)" };
  }
  const reason = `${RULESET_UNGATED} — left alone (classic branch protection only)`;
  return { branch, action: "blocked", ruleset: true, leftAsIs: true, gated: false, reason, next: rulesetNext(branch) };
}

// One branch: what would change, and the one request that changes it.
function planBranch(root, repo, branch) {
  const info = inspectBranch(root, repo, branch);
  const blocked = (reason, next) => ({ branch, action: "blocked", reason, next });

  if (info.missing) return blocked(`branch "${branch}" does not exist on GitHub`, `push it, ${NEXT_RUN}`);
  if (info.planLimit) return { ...blocked(PLAN_LIMIT, PLAN_NEXT), planLimit: true };
  if (info.error) return blocked(`GitHub did not answer for "${branch}" (${info.error})`, `check \`gh auth status\`, ${NEXT_RUN}`);

  if (info.rules.length > 0) return rulesetBranch(branch, info);

  const required = requiredChecksOf(info.protection);
  const runs = info.sha ? checkRunNames(root, repo, info.sha) : { names: [] };
  if (runs.error) return blocked(`could not read the check runs of "${branch}" (${runs.error})`, `check \`gh auth status\`, ${NEXT_RUN}`);

  const base = `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`;
  const unchanged = (extra = {}) => ({ branch, action: "unchanged", required, ...extra, reason: `already requires ${required.join(", ")}` });
  const notRequired = runs.names.filter((name) => !required.includes(name));

  if (notRequired.length === 0 && required.length > 0) return unchanged();

  if (runs.names.length === 0) {
    return blocked(
      `no check runs on "${branch}"'s latest commit${info.sha ? ` (${info.sha.slice(0, 7)})` : ""} — the project needs CI first; a protection with no required check would not stop a merge`,
      `add CI (\`ai-flow ci init\`), push so it runs on "${branch}", ${NEXT_RUN}`,
    );
  }

  // Only a check that also reports on pull requests can be required: one that
  // runs on push alone would keep every pull request pending forever.
  const onPrs = pullRequestCheckNames(root, repo, branch);
  if (onPrs.error) return blocked(`could not read the pull requests into "${branch}" (${onPrs.error})`, `check \`gh auth status\`, ${NEXT_RUN}`);
  // Safe side: a pull request that ran no check at all would pend forever
  // behind any required check, so nothing is required on this branch.
  if (onPrs.withoutChecks > 0) return pullRequestWithoutChecks(branch, info, required);

  const missing = notRequired.filter((name) => onPrs.names.includes(name));
  const partial = notRequired.filter((name) => onPrs.partial.includes(name));
  const extra = { pushOnly: notRequired.filter((name) => !missing.includes(name) && !partial.includes(name)), partial };

  if (missing.length === 0 && required.length > 0) return unchanged(extra);

  if (onPrs.prs === 0) {
    return blocked(
      `no pull request into "${branch}" yet — open one pull request first, so the checks that run on pull requests are known`,
      `open a pull request into "${branch}" and let its checks run, ${NEXT_RUN}`,
    );
  }

  if (missing.length === 0) return noPullRequestCheck(branch, runs, extra);

  if (!info.protection) {
    return { branch, action: "protect", required: [], missing, ...extra, request: { method: "PUT", path: base, body: freshProtection(missing) } };
  }

  if (info.protection.required_status_checks) {
    return {
      branch,
      action: "add-checks",
      required,
      missing,
      ...extra,
      request: { method: "POST", path: `${base}/required_status_checks/contexts`, body: { contexts: missing } },
    };
  }

  return { branch, action: "add-checks", required, missing, ...extra, request: { method: "PUT", path: base, body: keepAndAddChecks(info.protection, missing) } };
}

function targetBranches(root, repoInfo, explicit) {
  if (explicit && explicit.length > 0) return [...new Set(explicit)];
  const configured = readConfig(root).baseBranch;
  return [...new Set([repoInfo.defaultBranch, typeof configured === "string" && configured ? configured : null].filter(Boolean))];
}

// GitHub refused the write. A branch that already had a protection keeps it
// untouched: it is "left as is", never "not protected".
function refused(result, stderr) {
  const error = firstLine(stderr) || "unknown error";
  result.planLimit = isPlanLimit(stderr);
  result.leftAsIs = !result.planLimit && result.action === "add-checks";
  result.reason = result.planLimit
    ? PLAN_LIMIT
    : result.leftAsIs
      ? `left as is — GitHub refused adding required check(s) ${result.missing.join(", ")} (${error})`
      : `GitHub refused the protection (${error})`;
  result.next = result.planLimit ? PLAN_NEXT : `check your admin rights with \`gh auth status\`, ${NEXT_RUN}`;
  result.action = "blocked";
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
      if (!sent.ok) refused(result, sent.stderr);
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
  const left = [
    entry.partial && entry.partial.length ? `not required (not on every pull request): ${entry.partial.join(", ")}` : null,
    entry.pushOnly && entry.pushOnly.length ? `not required (never seen on a pull request): ${entry.pushOnly.join(", ")}` : null,
  ].filter(Boolean).map((text) => `; ${text}`).join("");
  if (entry.action === "protect") {
    return `${entry.branch}: ${will(`${dryRun ? "protect" : "protected"} — requires ${entry.missing.join(", ")}`)} (strict: false, no reviews, enforce_admins: false, no force push, no deletion)${left}`;
  }
  if (entry.action === "add-checks") {
    const kept = entry.required.length ? `kept ${entry.required.join(", ")} and every other rule` : "kept every other rule";
    return `${entry.branch}: ${will(`${dryRun ? "add" : "added"} required check(s) ${entry.missing.join(", ")}`)}; ${kept}${left}`;
  }
  if (entry.action === "unchanged") return `${entry.branch}: nothing to change — ${entry.reason}${left}`;
  if (entry.action === "ruleset") return `${entry.branch}: ${entry.reason}`;
  if (entry.leftAsIs) return `${entry.branch}: ${entry.reason}`;
  return `${entry.branch}: not protected — ${entry.reason}`;
}

function formatReport(report) {
  if (!report.repo || report.branches.length === 0) {
    return [`Branch protection: not done — ${report.reason}`, ...(report.next ? [`Next: ${report.next}`] : [])];
  }

  const lines = [`Branch protection (${report.repo}):`, ...report.branches.map((entry) => `  ${describeBranch(entry, report.dryRun)}`)];
  // "Nothing to change" only when every branch is settled: a blocked branch
  // is something left to do, not a branch already right.
  const pending = report.branches.filter((entry) => entry.request || entry.action === "blocked").length;

  if (report.dryRun) lines.push(pending > 0 ? "Dry run — nothing sent." : "Dry run — nothing to change.");
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

// The repository's "Allow auto-merge" setting: false when it is off, null when
// GitHub does not say (then `gh pr merge --auto` answers for itself).
function autoMergeAllowed(root, repo) {
  const res = gh(root, ["api", `repos/${repo}`]);
  const data = res.ok ? parse(res.stdout) : null;
  return data && typeof data.allow_auto_merge === "boolean" ? data.allow_auto_merge : null;
}

// Why `ship` cannot arm auto-merge on this base before any write, or null.
// `manual`: the next step already says to merge by hand.
function baseBlocker(root, repo, base) {
  // Checked before any write: protecting the base is pointless when GitHub
  // would refuse `--auto` anyway.
  if (autoMergeAllowed(root, repo) === false) {
    return {
      why: `the repository ${repo} has auto-merge disabled (allow_auto_merge: false), so GitHub would refuse it`,
      next: "turn on \"Allow auto-merge\" in the repository's Settings → General, then ship again — or merge the PR once its checks pass",
      manual: true,
    };
  }
  const info = inspectBranch(root, repo, base);
  if (info.planLimit) return { why: `"${base}" cannot be protected — ${PLAN_LIMIT} — so GitHub would merge at once`, next: PLAN_NEXT, manual: true };
  // Unread is not unprotected: it cannot say GitHub would merge at once.
  if (info.error || info.missing) {
    const cause = info.missing ? `"${base}" does not exist on GitHub` : info.error;
    const next = info.missing ? `push "${base}", then ship again` : `run \`ai-flow protect --dry-run --branch ${base}\` to see what GitHub answers`;
    return { why: `"${base}"'s protection could not be read (${cause})`, next };
  }
  if (isGated(info)) return { gated: true };
  if (info.rules.length > 0) return { why: `"${base}" is ${RULESET_UNGATED}`, next: rulesetNext(base) };
  return null;
}

// `ship`: may auto-merge be armed on this base? Protects it first when it can.
// `why`, when set, replaces "the base has no required status checks". With
// `dryRun`, nothing is written: `wouldProtect` is set when the real run would.
function ensureBaseGated(root, base, { protectBranches = true, dryRun = false } = {}) {
  const repoInfo = resolveRepo(root);
  // Unread is not unprotected: the base's protection was never looked at.
  if (repoInfo.blocked) {
    const next = repoInfo.transient ? "ship again once GitHub answers" : repoInfo.next;
    return { gated: false, why: `${repoInfo.blocked}, so "${base}"'s protection could not be checked`, next };
  }

  const blocker = baseBlocker(root, repoInfo.repo, base);
  if (blocker) return { gated: false, ...blocker };

  if (!protectBranches) {
    return { gated: false, reason: "protectBranches is false in .coding-flow/config.json", next: `protect "${base}" with required checks, or run \`ai-flow protect --branch ${base}\`` };
  }

  const report = runProtect(root, { branches: [base], dryRun });
  const entry = report.branches[0];
  if (dryRun) return { gated: false, wouldProtect: Boolean(entry && entry.request) };
  if (entry && entry.applied) return { gated: true, protected: describeBranch(entry, false) };
  if (entry && entry.planLimit) {
    return { gated: false, why: `"${base}" cannot be protected — ${PLAN_LIMIT} — so GitHub would merge at once`, next: PLAN_NEXT, manual: true };
  }
  return { gated: false, reason: entry ? entry.reason : report.reason, next: entry ? entry.next : report.next };
}

// What `doctor` reports about one base, or null when auto-merge waits there.
function baseProblem(root, repo, branch) {
  const info = inspectBranch(root, repo, branch);
  if (info.planLimit) return { branch, kind: "plan" };
  if (info.missing) return { branch, kind: "missing" };
  if (info.error) return { branch, kind: "unread", error: info.error };
  if (isGated(info)) return null;
  return { branch, kind: info.rules.length > 0 ? "ruleset" : "ungated" };
}

// `doctor`: why auto-merge would not wait for the checks, as `{ branch, kind }`
// — "disabled" (the repository refuses auto-merge; branch null), "plan" (no
// branch protection on this plan), "ruleset" (a ruleset with no required
// status checks rule), "unread" (the protection could not be read: `error`),
// "ungated" (no required check), "missing" (the branch is not on GitHub). Silent (empty) when the repository itself
// cannot be read.
function ungatedBases(root) {
  if (!isGitHubOrigin(root)) return [];
  const repoInfo = resolveRepo(root);
  if (repoInfo.blocked) return [];
  if (autoMergeAllowed(root, repoInfo.repo) === false) return [{ branch: null, kind: "disabled", repo: repoInfo.repo }];
  return targetBranches(root, repoInfo, []).map((branch) => baseProblem(root, repoInfo.repo, branch)).filter(Boolean);
}

// The branches named on the command line, or the one-line error that refuses
// the run: a branch the user did not name is never written to.
function parseBranchArgs(args) {
  const branches = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--branch") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) return { error: "--branch needs a name" };
      branches.push(value);
      index += 1;
    } else if (arg.startsWith("--branch=")) {
      const value = arg.slice("--branch=".length);
      if (!value) return { error: "--branch needs a name" };
      branches.push(value);
    } else if (!arg.startsWith("-")) {
      return { error: `unexpected argument "${arg}" — did you mean --branch ${arg}?` };
    }
  }
  return { branches };
}

function protectCommand({ args, flags, cwd }) {
  const { branches, error } = parseBranchArgs(args);
  if (error) {
    process.stderr.write(`Error: ${error}\n`);
    process.exitCode = 1;
    return;
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
  PLAN_LIMIT,
  PLAN_NEXT,
  RULESET_UNGATED,
  rulesetNext,
};
