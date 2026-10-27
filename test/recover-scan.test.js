"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(__dirname, "..", "bin", "ai-flow.js");
const FIXTURE = path.join(__dirname, "..", "evals", "recovery", "fixture");

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(t, prefix, source = null) {
  const base = tmp(t, prefix);
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo);

  if (source) {
    fs.cpSync(source, repo, { recursive: true });
  }

  sh(repo, "git", ["-c", "init.defaultBranch=main", "init"]);
  sh(repo, "git", ["config", "user.email", "test@example.com"]);
  sh(repo, "git", ["config", "user.name", "Test"]);
  return { base, repo };
}

function commitAll(repo, message) {
  sh(repo, "git", ["add", "-A"]);
  sh(repo, "git", ["commit", "-m", message]);
}

function run(repo, args, env = {}) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

function scan(repo, extra = []) {
  const result = run(repo, ["recover", "scan", "--json", ...extra]);
  assert.equal(result.code, 0, result.output);
  return JSON.parse(result.output);
}

function snapshot(dir) {
  const rows = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      if (name === ".git") {
        continue;
      }
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else {
        rows.push(`${path.relative(dir, full)}:${fs.readFileSync(full, "utf8")}`);
      }
    }
  };
  walk(dir);
  return rows.join("\n");
}

test("the fixture scan reports the hotspot, the test gap and does not call a command substitution a secret", (t) => {
  const { repo } = initRepo(t, "recover-fixture", FIXTURE);
  commitAll(repo, "fixture");

  const result = scan(repo);

  assert.equal(result.git.available, true);
  assert.equal(result.hotspots[0].path, "src/engine/runner.js", "the largest, churned file ranks first");
  assert.equal(result.hotspots[0].hasTest, false, "no test sits next to it or imports it");
  assert.ok(result.testMap.withoutTests.includes("src"), "src has code and no test");
  assert.ok(result.testMap.withoutTests.includes("scripts"), "scripts has code and no test");

  const secretPaths = result.secrets.tree.findings.map((finding) => finding.path);
  assert.equal(
    secretPaths.some((file) => file.endsWith("lot1-2-rds.sh")),
    false,
    "a password fetched by a command substitution is not a written credential",
  );
  assert.equal(result.secrets.history.available, true);
});

test("history reports the pattern, path and first commit without ever printing the key", (t) => {
  const { repo } = initRepo(t, "recover-history");
  const key = "AKIA" + "IOSFODNN7EXAMPLE";

  fs.writeFileSync(path.join(repo, "app.js"), `const key = "${key}";\n`);
  commitAll(repo, "add the key");
  const first = sh(repo, "git", ["rev-parse", "HEAD"]).trim();

  fs.writeFileSync(path.join(repo, "app.js"), "const key = null;\n");
  commitAll(repo, "remove the key");

  const json = run(repo, ["recover", "scan", "--json"]);
  const text = run(repo, ["recover", "scan"]);

  assert.equal(json.code, 0, json.output);
  assert.equal(text.code, 0, text.output);
  assert.equal(json.output.includes(key), false, "the JSON must not carry the matched value");
  assert.equal(text.output.includes(key), false, "the text output must not carry the matched value");

  const history = JSON.parse(json.output).secrets.history;
  const finding = history.findings.find((entry) => entry.name === "AWS access key");

  assert.ok(finding, "the AWS pattern is reported");
  assert.equal(finding.path, "app.js");
  assert.equal(finding.commit, first, "the first commit that introduced the line");
  assert.equal(finding.count, 1);
  assert.match(text.output, /AWS access key in app\.js \(first [0-9a-f]{8}\)/);
});

test("the scan writes nothing and --help acts on nothing", (t) => {
  const { repo } = initRepo(t, "recover-readonly", FIXTURE);
  commitAll(repo, "fixture");

  const before = snapshot(repo);

  assert.equal(run(repo, ["recover", "scan"]).code, 0);
  assert.equal(run(repo, ["recover", "scan", "--json"]).code, 0);
  assert.equal(snapshot(repo), before, "the text scan writes nothing");

  const help = run(repo, ["recover", "--help"]);
  assert.equal(help.code, 0);
  assert.match(help.output, /ai-flow recover scan/);
  assert.equal(snapshot(repo), before, "--help writes nothing");

  const subHelp = run(repo, ["recover", "scan", "--help"]);
  assert.equal(subHelp.code, 0);
  assert.match(subHelp.output, /ai-flow recover scan/);
  assert.equal(snapshot(repo), before, "a subcommand --help writes nothing");
});

test("no git history is reported as unavailable, not as zero churn", (t) => {
  const repo = tmp(t, "recover-nogit");
  sh(repo, "git", ["-c", "init.defaultBranch=main", "init"]);
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "module.exports = 1;\n");
  sh(repo, "git", ["add", "-A"]);

  const result = scan(repo);

  assert.equal(result.git.available, true, "the index is readable even with no commit");
  assert.equal(result.git.churnAvailable, false, "there is no history to measure churn from");
  assert.equal(result.secrets.history.available, false);
  assert.ok(result.hotspots.length > 0);
  assert.equal(result.hotspots[0].churn, null, "churn is unavailable, never zero");
  assert.equal(result.hotspots[0].score, null);
});

test("binary and > 1 MB files are skipped by the secret scan and counted", (t) => {
  const { repo } = initRepo(t, "recover-skipped");

  fs.writeFileSync(path.join(repo, "image.bin"), Buffer.from([0, 1, 2, 3, 0, 4]));
  fs.writeFileSync(path.join(repo, "large.js"), `${"const x = 1;\n".repeat(90000)}`);
  commitAll(repo, "binary and large files");

  const result = scan(repo);

  assert.ok(result.secrets.tree.skipped >= 2, `skipped ${result.secrets.tree.skipped}, expected at least 2`);
});

test("--history-limit bounds the commit window", (t) => {
  const { repo } = initRepo(t, "recover-limit", FIXTURE);
  commitAll(repo, "fixture");
  fs.writeFileSync(path.join(repo, "notes.txt"), "one\n");
  commitAll(repo, "second");
  fs.writeFileSync(path.join(repo, "notes.txt"), "two\n");
  commitAll(repo, "third");

  const result = scan(repo, ["--history-limit", "2"]);

  assert.equal(result.secrets.history.limit, 2);
  assert.ok(result.secrets.history.commitsScanned <= 2);
});

test("an invalid --history-limit is refused", (t) => {
  const { repo } = initRepo(t, "recover-bad-limit");

  const result = run(repo, ["recover", "scan", "--history-limit", "zero"]);

  assert.equal(result.code, 1);
  assert.match(result.output, /--history-limit must be a positive integer/);
});

test("a missing git binary is reported as unavailable", (t) => {
  const { repo } = initRepo(t, "recover-no-git", FIXTURE);

  const result = run(repo, ["recover", "scan", "--json"], { PATH: "/nonexistent" });

  assert.equal(result.code, 0, result.output);
  const scan = JSON.parse(result.output);
  assert.equal(scan.git.available, false);
  assert.equal(scan.secrets.history.available, false);
  assert.deepEqual(scan.hotspots, []);
});

test("empty files and short basenames are handled by the hotspot pass", (t) => {
  const { repo } = initRepo(t, "recover-short");
  fs.writeFileSync(path.join(repo, "a.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(repo, "empty.js"), "");
  commitAll(repo, "short names and an empty file");

  const result = scan(repo);

  const short = result.hotspots.find((row) => row.path === "a.js");
  const empty = result.hotspots.find((row) => row.path === "empty.js");
  assert.equal(short.hasTest, false, "a one-letter basename is not searched as a test reference");
  assert.equal(empty.lines, 0);
});

test("a committed tree secret is reported with its path", (t) => {
  const { repo } = initRepo(t, "recover-tree-secret");
  const key = "AKIA" + "IOSFODNN7EXAMPLE";
  fs.writeFileSync(path.join(repo, "config.js"), `module.exports = "${key}";\n`);
  commitAll(repo, "add the key");

  const result = scan(repo);
  const finding = result.secrets.tree.findings.find((entry) => entry.path === "config.js");

  assert.ok(finding, "the tree scan reports the key");
  assert.equal(finding.name, "AWS access key");
});

test("a staged file with no commit history keeps zero churn beside committed files", (t) => {
  const { repo } = initRepo(t, "recover-mixed-churn");
  fs.writeFileSync(path.join(repo, "base.js"), "module.exports = 1;\n");
  commitAll(repo, "base");
  fs.writeFileSync(path.join(repo, "staged.js"), "module.exports = 2;\n");
  sh(repo, "git", ["add", "staged.js"]);

  const result = scan(repo);
  const staged = result.hotspots.find((row) => row.path === "staged.js");
  const base = result.hotspots.find((row) => row.path === "base.js");

  assert.equal(staged.churn, 0);
  assert.equal(base.churn, 1);
});

test("churn follows a renamed file to its new path, not the old one", (t) => {
  const { repo } = initRepo(t, "recover-rename");
  fs.writeFileSync(path.join(repo, "old.js"), "module.exports = 1;\n");
  commitAll(repo, "add");
  sh(repo, "git", ["mv", "old.js", "new.js"]);
  fs.appendFileSync(path.join(repo, "new.js"), "module.exports = 2;\n");
  commitAll(repo, "rename and edit");

  const result = scan(repo);
  const renamed = result.hotspots.find((row) => row.path === "new.js");

  assert.ok(renamed, "the file is a hotspot under its new name");
  assert.ok(renamed.churn >= 1, `churn lands on the new path, got ${renamed.churn}`);
  assert.equal(
    result.hotspots.some((row) => row.path.includes("=>")),
    false,
    "no numstat rename arrow leaks into a path",
  );
});

test("a shallow clone reports churn as unavailable: one snapshot is size, not churn", (t) => {
  const { base, repo } = initRepo(t, "recover-shallow", FIXTURE);
  commitAll(repo, "fixture");

  assert.equal(scan(repo).git.churnAvailable, true, "the full clone has churn");

  const shallowDir = path.join(base, "shallow");
  sh(base, "git", ["clone", "--depth", "1", `file://${repo}`, shallowDir]);

  const result = scan(shallowDir);

  assert.equal(result.git.available, true);
  assert.equal(result.git.churnAvailable, false, "a one-commit log is not churn");
  assert.ok(result.hotspots.length > 0);
  assert.equal(result.hotspots[0].churn, null, "churn is unavailable, never size masquerading as churn");
  assert.equal(result.hotspots[0].score, null);
  assert.equal(result.secrets.history.available, true, "history covers the commit the clone has");
  assert.equal(result.secrets.history.commitsScanned, 1);
});

test("a tracked file deleted from the working tree is not counted as a skipped binary", (t) => {
  const { repo } = initRepo(t, "recover-deleted");
  fs.writeFileSync(path.join(repo, "kept.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(repo, "gone.js"), "module.exports = 2;\n");
  commitAll(repo, "two files");

  fs.rmSync(path.join(repo, "gone.js"));

  const result = scan(repo);

  assert.equal(result.secrets.tree.skipped, 0, "a deleted tracked file is not a skipped binary or oversize file");
});
