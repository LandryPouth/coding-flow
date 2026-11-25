"use strict";

// Story 29-08: auto-merge waits for the checks. GitHub's auto-merge only waits
// on REQUIRED status checks; on an unprotected base it merges at once. These
// tests drive `protect`, `init`, `ship` and `doctor` against a fake `gh`
// (test/fixtures/fake-gh) first on PATH: it answers from a state file, applies
// the protection writes to it, and logs every call — nothing reaches GitHub.

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "bin", "ai-flow.js");
const FAKE_GH = path.join(__dirname, "fixtures", "fake-gh");
const skip = process.platform === "win32" ? "the fake gh is a POSIX script on PATH" : false;

const { keepAndAddChecks } = require("../bin/lib/protect");

const ADMIN = { nameWithOwner: "acme/app", defaultBranchRef: { name: "main" }, viewerPermission: "ADMIN" };
const THREE = ["build", "lint", "test"];

function unprotected(extra = {}) {
  return { repo: ADMIN, branches: { main: { sha: "a".repeat(40), checkRuns: THREE, protection: null } }, ...extra };
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Unless a test says otherwise (`pulls`), every branch has had one pull request
// whose head commit reported the same checks as the branch: those checks are
// known to run on pull requests.
function withPulls(state) {
  if (state.pulls) return state;
  const pulls = Object.entries(state.branches || {}).map(([base, branch], index) => ({
    base,
    headRefOid: `${index + 1}`.repeat(39) + "p",
    checkRuns: branch.checkRuns,
  }));
  return { ...state, pulls };
}

// A GitHub-looking repository, a fake gh, and what it saw.
function sandbox(t, rawState, { withGh = true } = {}) {
  const state = withPulls(rawState);
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "coding-flow-protect-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  if (withGh) {
    fs.copyFileSync(FAKE_GH, path.join(bin, "gh"));
    fs.chmodSync(path.join(bin, "gh"), 0o755);
  } else {
    // No gh anywhere: PATH is this directory alone, with git linked in.
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    fs.symlinkSync(realGit, path.join(bin, "git"));
  }

  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["remote", "add", "origin", "https://github.com/acme/app.git"]);

  const stateFile = path.join(dir, "gh-state.json");
  const logFile = path.join(dir, "gh-calls.jsonl");
  fs.writeFileSync(stateFile, JSON.stringify(state));
  fs.writeFileSync(logFile, "");

  const env = {
    ...process.env,
    PATH: withGh ? `${bin}${path.delimiter}${process.env.PATH}` : bin,
    FAKE_GH_STATE: stateFile,
    FAKE_GH_LOG: logFile,
  };
  const calls = () => fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

  return {
    dir,
    repo,
    env,
    calls,
    writes: () => calls().filter((call) => call.args[0] === "api" && call.args.includes("-X")),
    state: () => JSON.parse(fs.readFileSync(stateFile, "utf8")),
    reset: () => fs.writeFileSync(logFile, ""),
  };
}

function cli(sb, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: sb.repo, env: sb.env, encoding: "utf8" });
  return { code: res.status, out: `${res.stdout}${res.stderr}`, stdout: res.stdout };
}

function writeConfig(sb, config) {
  fs.mkdirSync(path.join(sb.repo, ".coding-flow"), { recursive: true });
  fs.writeFileSync(path.join(sb.repo, ".coding-flow", "config.json"), JSON.stringify(config));
}

// Criterion 1.
test("protect requires exactly the 3 check runs of main's latest commit, strict false, no reviews", { skip }, (t) => {
  const sb = sandbox(t, unprotected());
  const res = cli(sb, ["protect"]);

  assert.equal(res.code, 0, res.out);
  const writes = sb.writes();
  assert.equal(writes.length, 1, "one protection request");
  assert.deepEqual(writes[0].args.slice(0, 4), ["api", "-X", "PUT", "repos/acme/app/branches/main/protection"]);

  const body = writes[0].body;
  assert.deepEqual(body.required_status_checks.checks.map((check) => check.context).sort(), THREE);
  assert.equal(body.required_status_checks.strict, false);
  assert.equal(body.required_pull_request_reviews, null);
  assert.equal(body.enforce_admins, false);
  assert.equal(body.allow_force_pushes, false);
  assert.equal(body.allow_deletions, false);
  assert.match(res.stdout, /main: protected — requires build, lint, test/);

  const checkRunReads = sb.calls().filter((call) => /commits\/a{40}\/check-runs/.test(call.args[1] || ""));
  assert.equal(checkRunReads.length, 1, "the check names are read from GitHub for the latest commit");
});

test("protect --dry-run sends nothing and prints the plan", { skip }, (t) => {
  const sb = sandbox(t, unprotected());
  const res = cli(sb, ["protect", "--dry-run"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(sb.writes().length, 0);
  assert.match(res.stdout, /main: would protect — requires build, lint, test/);
  assert.match(res.stdout, /Dry run — nothing sent\./);
  assert.equal(sb.state().branches.main.protection, null);
});

// Criterion 2.
test("an existing protection keeps its reviews and check, gains the missing ones, and a second run sends nothing", { skip }, (t) => {
  const reviews = { dismiss_stale_reviews: true, require_code_owner_reviews: false, required_approving_review_count: 2 };
  const sb = sandbox(t, unprotected({
    branches: {
      main: {
        sha: "b".repeat(40),
        checkRuns: THREE,
        protection: {
          required_status_checks: { strict: true, contexts: ["test"], checks: [{ context: "test", app_id: 15368 }] },
          required_pull_request_reviews: reviews,
          enforce_admins: { enabled: true },
        },
      },
    },
  }));

  const first = cli(sb, ["protect"]);
  assert.equal(first.code, 0, first.out);
  const writes = sb.writes();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args.slice(0, 4), ["api", "-X", "POST", "repos/acme/app/branches/main/protection/required_status_checks/contexts"]);
  assert.deepEqual(writes[0].body, { contexts: ["build", "lint"] });

  const after = sb.state().branches.main.protection;
  assert.deepEqual(after.required_pull_request_reviews, reviews, "reviews kept");
  assert.deepEqual(after.enforce_admins, { enabled: true }, "enforce_admins kept");
  assert.equal(after.required_status_checks.strict, true, "strict kept");
  assert.deepEqual(after.required_status_checks.contexts.sort(), THREE, "the existing check kept, the missing added");

  sb.reset();
  const second = cli(sb, ["protect"]);
  assert.equal(second.code, 0, second.out);
  assert.equal(sb.writes().length, 0, "a second run sends nothing");
  assert.match(second.stdout, /main: nothing to change/);
});

test("a protection with no required checks is rebuilt keeping its reviews and restrictions", () => {
  const body = keepAndAddChecks(
    {
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        dismissal_restrictions: { users: [{ login: "ana" }], teams: [{ slug: "core" }], apps: [] },
      },
      restrictions: { users: [{ login: "bo" }], teams: [], apps: [{ slug: "bot" }] },
      enforce_admins: { enabled: true },
      allow_force_pushes: { enabled: false },
      required_linear_history: { enabled: true },
    },
    ["test"],
  );

  assert.deepEqual(body.required_status_checks, { strict: false, checks: [{ context: "test" }] });
  assert.equal(body.required_pull_request_reviews.required_approving_review_count, 1);
  assert.deepEqual(body.required_pull_request_reviews.dismissal_restrictions, { users: ["ana"], teams: ["core"], apps: [] });
  assert.deepEqual(body.restrictions, { users: ["bo"], teams: [], apps: ["bot"] });
  assert.equal(body.enforce_admins, true);
  assert.equal(body.required_linear_history, true);
});

// Review round 3, P1: every rule of an existing protection with no required
// checks survives the rebuild, each set to its non-default value.
test("a protection with no required checks keeps every rule, each non-default, when the checks are added", { skip }, (t) => {
  const who = (login, slug) => ({ users: [{ login }], teams: [{ slug }], apps: [{ slug: `${slug}-app` }] });
  const sb = sandbox(t, unprotected({
    branches: {
      main: {
        sha: "a".repeat(40),
        checkRuns: THREE,
        protection: {
          required_pull_request_reviews: {
            dismiss_stale_reviews: true,
            require_code_owner_reviews: true,
            required_approving_review_count: 4,
            require_last_push_approval: true,
            dismissal_restrictions: who("ana", "core"),
            bypass_pull_request_allowances: who("cy", "release"),
          },
          restrictions: who("bo", "ops"),
          enforce_admins: { enabled: true },
          required_linear_history: { enabled: true },
          allow_force_pushes: { enabled: true },
          allow_deletions: { enabled: true },
          block_creations: { enabled: true },
          required_conversation_resolution: { enabled: true },
          lock_branch: { enabled: true },
          allow_fork_syncing: { enabled: true },
        },
      },
    },
  }));
  const res = cli(sb, ["protect"]);

  assert.equal(res.code, 0, res.out);
  const writes = sb.writes();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args.slice(0, 4), ["api", "-X", "PUT", "repos/acme/app/branches/main/protection"]);
  assert.deepEqual(writes[0].body, {
    required_status_checks: { strict: false, checks: THREE.map((context) => ({ context })) },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      required_approving_review_count: 4,
      require_last_push_approval: true,
      dismissal_restrictions: { users: ["ana"], teams: ["core"], apps: ["core-app"] },
      bypass_pull_request_allowances: { users: ["cy"], teams: ["release"], apps: ["release-app"] },
    },
    restrictions: { users: ["bo"], teams: ["ops"], apps: ["ops-app"] },
    required_linear_history: true,
    allow_force_pushes: true,
    allow_deletions: true,
    block_creations: true,
    required_conversation_resolution: true,
    lock_branch: true,
    allow_fork_syncing: true,
  });
});

test("a ruleset-governed branch is reported and left alone", { skip }, (t) => {
  const sb = sandbox(t, unprotected({
    branches: { main: { sha: "c".repeat(40), checkRuns: THREE, protection: null, rules: [{ type: "deletion", ruleset_id: 1 }] } },
  }));
  const res = cli(sb, ["protect"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(sb.writes().length, 0);
  assert.match(res.stdout, /main: governed by a repository ruleset — left alone/);
});

// Criterion 3: protect exits 2 with the reason and the next command; init still
// succeeds and prints the same reason.
const BLOCKERS = [
  ["no admin rights", unprotected({ repo: { ...ADMIN, viewerPermission: "WRITE" } }), {}, /no admin rights on acme\/app/, /ask a repository admin/],
  ["no gh", unprotected(), { withGh: false }, /`gh` \(GitHub CLI\) is not installed/, /gh auth login/],
  ["no check runs", unprotected({ branches: { main: { sha: "d".repeat(40), checkRuns: [], protection: null } } }), {}, /no check runs on "main"'s latest commit .* needs CI first/, /ai-flow ci init/],
  ["no pull request yet", unprotected({ pulls: [] }), {}, /open one pull request first, so the checks that run on pull requests are known/, /open a pull request into "main"/],
];

for (const [name, state, options, reason, next] of BLOCKERS) {
  test(`${name}: protect exits 2 with the reason and the next command; init succeeds with the same reason`, { skip }, (t) => {
    const sb = sandbox(t, state, options);
    const res = cli(sb, ["protect"]);

    assert.equal(res.code, 2, res.out);
    assert.match(res.out, reason);
    assert.match(res.out, /Next: /);
    assert.match(res.out, next);
    assert.equal(sb.writes().length, 0);

    const init = cli(sb, ["init"]);
    assert.equal(init.code, 0, init.out);
    assert.match(init.out, /Branch protection/);
    assert.match(init.out, reason);
    assert.equal(sb.writes().length, 0);
  });
}

// Review round 1, P1: a check that runs only on push (deploy, release, pages)
// never reports on a pull request; requiring it would keep every PR pending.
test("a push-only check on the branch is not required; the checks seen on a pull request are", { skip }, (t) => {
  const sb = sandbox(t, unprotected({
    branches: { main: { sha: "a".repeat(40), checkRuns: [...THREE, "deploy"], protection: null } },
    pulls: [
      { base: "main", headRefOid: "9".repeat(40), checkRuns: THREE },
      { base: "main", headRefOid: "8".repeat(40), checkRuns: [...THREE, "preview"] },
      { base: "develop", headRefOid: "7".repeat(40), checkRuns: ["deploy"] },
    ],
  }));
  const res = cli(sb, ["protect"]);

  assert.equal(res.code, 0, res.out);
  const writes = sb.writes();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.required_status_checks.checks.map((check) => check.context).sort(), THREE);
  assert.match(res.stdout, /not required \(never seen on a pull request\): deploy/);

  const listed = sb.calls().find((call) => call.args[0] === "pr" && call.args[1] === "list");
  assert.ok(listed, "the pull requests into main were read");
  assert.equal(listed.args[listed.args.indexOf("--base") + 1], "main");
});

test("only push checks on the branch: protect exits 2 and sends nothing", { skip }, (t) => {
  const sb = sandbox(t, unprotected({
    branches: { main: { sha: "a".repeat(40), checkRuns: ["deploy"], protection: null } },
    pulls: [{ base: "main", headRefOid: "9".repeat(40), checkRuns: ["preview"] }],
  }));
  const res = cli(sb, ["protect"]);

  assert.equal(res.code, 2, res.out);
  assert.match(res.out, /none of the checks on "main"'s latest commit \(deploy\) was seen on a pull request/);
  assert.equal(sb.writes().length, 0);
});

test("an existing protection gains only the checks seen on a pull request", { skip }, (t) => {
  const sb = sandbox(t, unprotected({
    branches: {
      main: {
        sha: "a".repeat(40),
        checkRuns: [...THREE, "deploy"],
        protection: { required_status_checks: { strict: false, contexts: ["test"], checks: [{ context: "test" }] } },
      },
    },
    pulls: [{ base: "main", headRefOid: "9".repeat(40), checkRuns: THREE }],
  }));
  const res = cli(sb, ["protect"]);

  assert.equal(res.code, 0, res.out);
  const writes = sb.writes();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { contexts: ["build", "lint"] });

  sb.reset();
  const again = cli(sb, ["protect"]);
  assert.equal(again.code, 0, again.out);
  assert.equal(sb.writes().length, 0, "deploy is never added");
  assert.match(again.stdout, /main: nothing to change — already requires .*; not required \(never seen on a pull request\): deploy/);
});

// Review round 2, P1: a check that runs only on some pull requests (a `paths:`
// filter, fork pull requests only) would keep the others pending once required.
test("a check seen on only some recent pull requests is not required; one seen on every pull request is", { skip }, (t) => {
  const sb = sandbox(t, unprotected({
    branches: { main: { sha: "a".repeat(40), checkRuns: ["api-tests", "test"], protection: null } },
    pulls: [
      { base: "main", headRefOid: "9".repeat(40), checkRuns: ["test"] },
      { base: "main", headRefOid: "8".repeat(40), checkRuns: ["api-tests", "test"] },
      { base: "main", headRefOid: "6".repeat(40), checkRuns: ["test"] },
    ],
  }));
  const res = cli(sb, ["protect"]);

  assert.equal(res.code, 0, res.out);
  const writes = sb.writes();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.required_status_checks.checks.map((check) => check.context), ["test"]);
  assert.match(res.stdout, /not required \(not on every pull request\): api-tests/);
});

// The reviewer's repro: [test], [test], [api-tests] — requiring either check
// would keep one of those pull requests pending.
test("no check ran on every recent pull request: protect exits 2 and sends nothing", { skip }, (t) => {
  const sb = sandbox(t, unprotected({
    branches: { main: { sha: "a".repeat(40), checkRuns: ["api-tests", "test"], protection: null } },
    pulls: [
      { base: "main", headRefOid: "9".repeat(40), checkRuns: ["test"] },
      { base: "main", headRefOid: "8".repeat(40), checkRuns: ["test"] },
      { base: "main", headRefOid: "6".repeat(40), checkRuns: ["api-tests"] },
    ],
  }));
  const res = cli(sb, ["protect", "--dry-run"]);

  assert.equal(res.code, 2, res.out);
  assert.match(res.out, /ran on every recent pull request into it/);
  assert.doesNotMatch(res.out, /nothing to change/);
  assert.equal(sb.writes().length, 0);
});

// Review round 3, P1: a CI whose only workflow has a `paths:` filter runs no
// check at all on a docs-only pull request; any required check would keep that
// pull request pending forever. Safe side: nothing is protected on the branch.
test("a recent pull request that ran no checks: protect protects nothing, exits 2, and says why", { skip }, (t) => {
  const sb = sandbox(t, unprotected({
    branches: { main: { sha: "a".repeat(40), checkRuns: ["build", "test"], protection: null } },
    pulls: [
      { base: "main", headRefOid: "9".repeat(40), checkRuns: ["build", "test"] },
      { base: "main", headRefOid: "8".repeat(40), checkRuns: [] },
    ],
  }));

  for (const args of [["protect", "--dry-run"], ["protect"]]) {
    const res = cli(sb, args);
    assert.equal(res.code, 2, res.out);
    assert.match(res.out, /main: not protected — a recent pull request ran no checks \(a `paths:` filter\?\) — requiring checks would block such pull requests forever/);
    assert.match(res.out, /Next: /);
    assert.doesNotMatch(res.out, /nothing to change/);
  }
  assert.equal(sb.writes().length, 0);
  assert.equal(sb.state().branches.main.protection, null);

  const init = cli(sb, ["init"]);
  assert.equal(init.code, 0, init.out);
  assert.match(init.out, /a recent pull request ran no checks/);
  assert.equal(sb.writes().length, 0);
});

// Review round 2, P1: a private repository on GitHub Free has no branch
// protection; GitHub answers 403 "Upgrade to GitHub Pro". A plan limit, not an
// auth problem, and never "nothing to change".
const PLAN_LINE = /branch protection is not available on this plan \(private repository on GitHub Free\)/;

test("a plan without branch protection: protect says so, gives a real next step, never 'nothing to change'", { skip }, (t) => {
  const sb = sandbox(t, unprotected({ planLimit: true }));

  for (const args of [["protect", "--dry-run"], ["protect"]]) {
    const res = cli(sb, args);
    assert.equal(res.code, 2, res.out);
    assert.match(res.out, PLAN_LINE);
    assert.match(res.out, /Next: merge each pull request by hand once its checks pass/);
    assert.doesNotMatch(res.out, /nothing to change/);
    assert.doesNotMatch(res.out, /gh auth status/);
  }
  assert.equal(sb.writes().length, 0);

  const init = cli(sb, ["init"]);
  assert.equal(init.code, 0, init.out);
  assert.match(init.out, PLAN_LINE);
  assert.equal(sb.writes().length, 0);
});

test("a dry run with a blocked branch never prints 'nothing to change'", { skip }, (t) => {
  const sb = sandbox(t, unprotected({ repo: { ...ADMIN, defaultBranchRef: { name: "main" } }, pulls: [] }));
  const res = cli(sb, ["protect", "--dry-run"]);

  assert.equal(res.code, 2, res.out);
  assert.match(res.out, /Dry run — nothing sent\./);
  assert.doesNotMatch(res.out, /nothing to change/);
});

// Criterion 4.
function withDevelop() {
  return unprotected({
    branches: {
      main: { sha: "e".repeat(40), checkRuns: THREE, protection: null },
      develop: { sha: "f".repeat(40), checkRuns: ["test"], protection: null },
    },
  });
}

test("init in a GitHub repository with checks and admin rights protects the default branch and the base", { skip }, (t) => {
  const sb = sandbox(t, withDevelop());
  writeConfig(sb, { baseBranch: "develop" });
  const res = cli(sb, ["init"]);

  assert.equal(res.code, 0, res.out);
  const paths = sb.writes().map((call) => call.args[3]).sort();
  assert.deepEqual(paths, ["repos/acme/app/branches/develop/protection", "repos/acme/app/branches/main/protection"]);
  assert.match(res.out, /main: protected — requires build, lint, test/);
  assert.match(res.out, /develop: protected — requires test/);
});

test("init --dry-run prints the protection plan and sends nothing", { skip }, (t) => {
  const sb = sandbox(t, withDevelop());
  const res = cli(sb, ["init", "--dry-run"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(sb.writes().length, 0);
  assert.match(res.out, /main: would protect — requires build, lint, test/);
});

test("init --no-protect sends nothing", { skip }, (t) => {
  const sb = sandbox(t, withDevelop());
  const res = cli(sb, ["init", "--no-protect"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(sb.calls().filter((call) => call.args[0] === "api").length, 0);
  assert.match(res.out, /Branch protection: skipped \(--no-protect\)/);
});

test("init with protectBranches false sends nothing", { skip }, (t) => {
  const sb = sandbox(t, withDevelop());
  writeConfig(sb, { protectBranches: false });
  const res = cli(sb, ["init"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(sb.calls().filter((call) => call.args[0] === "api").length, 0);
  assert.match(res.out, /Branch protection: skipped \(protectBranches: false\)/);
});

// Criterion 5: a story branch whose epic is fully proven, with its PR open.
function shipReady(t, state, config = {}) {
  const sb = sandbox(t, { ...state, pr: true });
  const bare = path.join(sb.dir, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", bare]);
  git(sb.repo, ["config", "remote.origin.pushurl", bare]);
  fs.writeFileSync(path.join(sb.repo, "README.md"), "app\n");
  git(sb.repo, ["add", "-A"]);
  git(sb.repo, ["commit", "-q", "-m", "init"]);
  git(sb.repo, ["checkout", "-q", "-b", "story-01-01-a"]);

  const storyPath = "epics/epic-01-x/story-01-01-a";
  fs.mkdirSync(path.join(sb.repo, storyPath), { recursive: true });
  fs.writeFileSync(path.join(sb.repo, storyPath, "story.md"), "# Story 01-01\n\n## Status: done\n");
  fs.mkdirSync(path.join(sb.repo, ".coding-flow", "runs"), { recursive: true });
  fs.writeFileSync(path.join(sb.repo, ".coding-flow", "config.json"), JSON.stringify({ storage: "local", ...config }));
  fs.writeFileSync(
    path.join(sb.repo, ".coding-flow", "runs", "2026-11-25T00-00-00-000Z-verify.json"),
    JSON.stringify({ generatedAt: "2026-11-25T00:00:00.000Z", story: storyPath, ok: true, commandsFound: 1, results: [] }),
  );
  git(sb.repo, ["add", "-A"]);
  git(sb.repo, ["commit", "-q", "-m", "story"]);
  return sb;
}

const merges = (sb) => sb.calls().filter((call) => call.args[0] === "pr" && call.args[1] === "merge");

test("ship --auto-merge on a base it cannot protect opens the PR without auto-merge and says why", { skip }, (t) => {
  const sb = shipReady(t, unprotected({ repo: { ...ADMIN, viewerPermission: "WRITE" } }));
  const res = cli(sb, ["ship", "--auto-merge", "--no-evidence", "--no-commit"]);

  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /PR already open/);
  assert.equal(merges(sb).length, 0, "auto-merge is not armed");
  assert.match(res.out, /Auto-merge: not armed — "main" has no required status checks, so GitHub would merge at once/);
  assert.match(res.out, /no admin rights/);
});

test("ship --auto-merge on a base it can protect protects it first, then arms auto-merge", { skip }, (t) => {
  const sb = shipReady(t, unprotected());
  const res = cli(sb, ["ship", "--auto-merge", "--no-evidence", "--no-commit"]);

  assert.equal(res.code, 0, res.out);
  const calls = sb.calls();
  const protectAt = calls.findIndex((call) => call.args[0] === "api" && call.args.includes("PUT"));
  const mergeAt = calls.findIndex((call) => call.args[0] === "pr" && call.args[1] === "merge");
  assert.ok(protectAt >= 0, "the base was protected");
  assert.ok(mergeAt > protectAt, "auto-merge armed after the protection");
  assert.ok(calls[mergeAt].args.includes("--auto"));
  assert.match(res.out, /Branch protection: main: protected — requires build, lint, test/);
});

test("ship --auto-merge on an already protected base arms auto-merge without writing", { skip }, (t) => {
  const sb = shipReady(t, unprotected({
    branches: { main: { sha: "1".repeat(40), checkRuns: THREE, protection: { required_status_checks: { strict: false, contexts: ["test"], checks: [{ context: "test" }] } } } },
  }));
  const res = cli(sb, ["ship", "--auto-merge", "--no-evidence", "--no-commit"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(sb.writes().length, 0);
  assert.equal(merges(sb).length, 1);
});

test("ship --auto-merge when the base's protection cannot be read does not arm auto-merge", { skip }, (t) => {
  const sb = shipReady(t, unprotected({ protectionError: "gh: Server Error (HTTP 500)" }));
  const res = cli(sb, ["ship", "--auto-merge", "--no-evidence", "--no-commit"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(merges(sb).length, 0, "auto-merge is not armed");
  assert.equal(sb.writes().length, 0);
  assert.match(res.out, /Auto-merge: not armed — .*could not read "main"'s protection \(gh: Server Error \(HTTP 500\)\)/);
});

test("ship --auto-merge on a plan without branch protection says so and does not arm auto-merge", { skip }, (t) => {
  const sb = shipReady(t, unprotected({ planLimit: true }));
  const res = cli(sb, ["ship", "--auto-merge", "--no-evidence", "--no-commit"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(merges(sb).length, 0, "auto-merge is not armed");
  assert.equal(sb.writes().length, 0);
  assert.match(res.out, /Auto-merge: not armed — "main" cannot be protected — branch protection is not available on this plan/);
  assert.match(res.out, /Next: merge each pull request by hand once its checks pass/);
  assert.doesNotMatch(res.out, /has no required status checks/);
  assert.doesNotMatch(res.out, /gh auth status/);
});

// Review round 2, P2: `--auto` is refused on a repository with auto-merge off;
// the protection is not written for nothing.
test("ship --auto-merge on a repository with auto-merge disabled writes nothing and says so", { skip }, (t) => {
  const sb = shipReady(t, unprotected({ allowAutoMerge: false }));
  const res = cli(sb, ["ship", "--auto-merge", "--no-evidence", "--no-commit"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(sb.writes().length, 0, "no protection written");
  assert.equal(merges(sb).length, 0, "auto-merge is not armed");
  assert.match(res.out, /Auto-merge: not armed — the repository acme\/app has auto-merge disabled \(allow_auto_merge: false\)/);
  assert.match(res.out, /Allow auto-merge/);
});

// Review round 3, P1: `protectBranches: false` holds in `ship` too — the base
// is not protected, and auto-merge is not armed on it.
test("ship --auto-merge with protectBranches false on an unprotected base writes nothing and does not arm auto-merge", { skip }, (t) => {
  const sb = shipReady(t, unprotected(), { protectBranches: false });
  const res = cli(sb, ["ship", "--auto-merge", "--no-evidence", "--no-commit"]);

  assert.equal(res.code, 0, res.out);
  assert.equal(sb.writes().length, 0, "no protection written");
  assert.equal(merges(sb).length, 0, "auto-merge is not armed");
  assert.match(res.out, /Auto-merge: not armed — "main" has no required status checks, so GitHub would merge at once \(protectBranches is false in \.coding-flow\/config\.json\)/);
  assert.match(res.out, /ai-flow protect --branch main/);
});

// Criterion 6.
test("doctor warns with the command to run when autoMergeEpic is on and the base has no required checks", { skip }, (t) => {
  const sb = sandbox(t, unprotected());
  writeConfig(sb, { autoMergeEpic: true, install: "minimal" });
  assert.equal(cli(sb, ["init", "--minimal", "--no-protect"]).code, 0);

  const report = JSON.parse(cli(sb, ["doctor", "--json"]).stdout);
  const warning = report.warnings.find((entry) => entry.code === "auto_merge_ungated");
  assert.ok(warning, JSON.stringify(report.warnings));
  assert.match(warning.message, /"main" has no required status checks/);
  assert.match(warning.message, /ai-flow protect --branch main/);
  assert.equal(sb.writes().length, 0, "doctor only reads");
});

test("doctor warns on a plan without branch protection", { skip }, (t) => {
  const sb = sandbox(t, unprotected({ planLimit: true }));
  writeConfig(sb, { autoMergeEpic: true, install: "minimal" });
  assert.equal(cli(sb, ["init", "--minimal", "--no-protect"]).code, 0);

  const report = JSON.parse(cli(sb, ["doctor", "--json"]).stdout);
  const warning = report.warnings.find((entry) => entry.code === "auto_merge_plan_limit");
  assert.ok(warning, JSON.stringify(report.warnings));
  assert.match(warning.message, PLAN_LINE);
  assert.match(warning.message, /merge each pull request by hand/);
  assert.equal(sb.writes().length, 0, "doctor only reads");
});

test("doctor says nothing when GitHub cannot be read, or auto-merge is off", { skip }, (t) => {
  const sb = sandbox(t, unprotected({ repoError: "error connecting to api.github.com" }));
  writeConfig(sb, { autoMergeEpic: true, install: "minimal" });
  assert.equal(cli(sb, ["init", "--minimal", "--no-protect"]).code, 0);
  let report = JSON.parse(cli(sb, ["doctor", "--json"]).stdout);
  assert.equal(report.warnings.some((entry) => entry.code === "auto_merge_ungated"), false);

  const off = sandbox(t, unprotected());
  writeConfig(off, { autoMergeEpic: false, install: "minimal" });
  assert.equal(cli(off, ["init", "--minimal", "--no-protect"]).code, 0);
  off.reset();
  report = JSON.parse(cli(off, ["doctor", "--json"]).stdout);
  assert.equal(report.warnings.some((entry) => entry.code === "auto_merge_ungated"), false);
  assert.equal(off.calls().filter((call) => call.args[0] === "api").length, 0, "auto-merge off: GitHub is not read");
});

// Review round 3, P2: the repository is readable but the base's protection is
// not (HTTP 500): doctor cannot tell, so it says nothing.
test("doctor says nothing when the base's protection cannot be read", { skip }, (t) => {
  const sb = sandbox(t, unprotected({ protectionError: "gh: Server Error (HTTP 500)" }));
  writeConfig(sb, { autoMergeEpic: true, install: "minimal" });
  assert.equal(cli(sb, ["init", "--minimal", "--no-protect"]).code, 0);
  sb.reset();

  const report = JSON.parse(cli(sb, ["doctor", "--json"]).stdout);
  assert.ok(sb.calls().some((call) => /branches\/main\/protection$/.test(call.args[1] || "")), "the protection was read");
  assert.equal(report.warnings.some((entry) => entry.code === "auto_merge_ungated"), false, JSON.stringify(report.warnings));
  assert.equal(report.warnings.some((entry) => entry.code === "auto_merge_plan_limit"), false);
  assert.equal(sb.writes().length, 0, "doctor only reads");
});

test("a non-GitHub remote: protect says GitHub only, init stays quiet", { skip }, (t) => {
  const sb = sandbox(t, unprotected());
  git(sb.repo, ["remote", "set-url", "origin", "https://gitlab.com/acme/app.git"]);

  const res = cli(sb, ["protect"]);
  assert.equal(res.code, 2);
  assert.match(res.out, /GitHub only/);

  const init = cli(sb, ["init"]);
  assert.equal(init.code, 0, init.out);
  assert.doesNotMatch(init.out, /Branch protection/);
  assert.equal(sb.calls().length, 0);
});
