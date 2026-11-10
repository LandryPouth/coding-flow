"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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

test("history reports the first commit that introduced a key, even when it is added twice", (t) => {
  const { repo } = initRepo(t, "recover-history-first");
  const key = "AKIA" + "IOSFODNN7EXAMPLE";

  fs.writeFileSync(path.join(repo, "app.js"), `const key = "${key}";\n`);
  commitAll(repo, "add the key");
  const first = sh(repo, "git", ["rev-parse", "HEAD"]).trim();

  fs.writeFileSync(path.join(repo, "app.js"), "const key = null;\n");
  commitAll(repo, "remove the key");

  fs.writeFileSync(path.join(repo, "app.js"), `const key = "${key}";\n`);
  commitAll(repo, "add the key again");

  const result = scan(repo);
  const finding = result.secrets.history.findings.find((entry) => entry.name === "AWS access key");

  assert.ok(finding, "the AWS pattern is reported");
  assert.equal(finding.commit, first, "the commit is the first introduction, not the last walk entry");
  assert.equal(finding.count, 2, "both introductions are counted");
});

test("a non-ASCII path keeps its churn and its history trace", (t) => {
  const { repo } = initRepo(t, "recover-unicode");
  const key = "AKIA" + "IOSFODNN7EXAMPLE";

  fs.writeFileSync(path.join(repo, "café.js"), `const key = "${key}";\n`);
  commitAll(repo, "add the key");

  const result = scan(repo);
  const hotspot = result.hotspots.find((row) => row.path === "café.js");
  const finding = result.secrets.history.findings.find((entry) => entry.path === "café.js");

  assert.ok(hotspot, "the file is a hotspot under its real name, not a C-quoted one");
  assert.equal(hotspot.churn, 1, "churn lands on the real path");
  assert.ok(finding, "the history finding uses the real path");
});

test("binary and > 1 MB files are skipped by the secret scan and counted", (t) => {
  const { repo } = initRepo(t, "recover-skipped");

  fs.writeFileSync(path.join(repo, "image.bin"), Buffer.from([0, 1, 2, 3, 0, 4]));
  fs.writeFileSync(path.join(repo, "large.js"), `${"const x = 1;\n".repeat(90000)}`);
  commitAll(repo, "binary and large files");

  const result = scan(repo);

  assert.ok(result.secrets.tree.skipped >= 2, `skipped ${result.secrets.tree.skipped}, expected at least 2`);

  const large = result.largeFiles.find((row) => row.path === "large.js");

  assert.ok(large, "the size report sees past the 1 MB secret-scan cap");
  assert.equal(large.lines, 90000, `large.js has ${large.lines} lines`);
});

test("line counts stay exact when a chunk boundary falls inside a line", (t) => {
  const { repo } = initRepo(t, "recover-line-boundary");
  const body = `${"a".repeat(70000)}\n${"x\n".repeat(1000)}`;
  fs.writeFileSync(path.join(repo, "mixed.js"), body);
  commitAll(repo, "a long line followed by short ones");

  const result = scan(repo);
  const large = result.largeFiles.find((row) => row.path === "mixed.js");
  const hotspot = result.hotspots.find((row) => row.path === "mixed.js");

  assert.ok(large, "mixed.js is reported as large");
  assert.equal(large.lines, 1001, "the first line and the 1000 short lines are each counted once");
  assert.equal(hotspot.lines, 1001, "the hotspot uses the same exact count");
});

test("a secret on a history line longer than the stream window is still found", (t) => {
  const { repo } = initRepo(t, "recover-long-history");
  const key = "AKIA" + "IOSFODNN7EXAMPLE";
  fs.writeFileSync(
    path.join(repo, "bundle.js"),
    `const value = "${"a".repeat(1024 * 1024 + 300000)}:${key}";\n`,
  );
  commitAll(repo, "one very long added line");

  const result = scan(repo);
  const finding = result.secrets.history.findings.find((entry) => entry.name === "AWS access key");

  assert.ok(finding, "the secret past the window is reported");
  assert.equal(finding.path, "bundle.js");
  assert.equal(finding.count, 1, "the pieces of one line count as one occurrence");
});

test("a secret straddling a stream piece boundary is still found", (t) => {
  const { repo } = initRepo(t, "recover-seam");
  const key = "AKIA" + "IOSFODNN7EXAMPLE";

  fs.writeFileSync(path.join(repo, "seam.js"), "seed\n");
  commitAll(repo, "seed");
  fs.writeFileSync(path.join(repo, "seam.js"), "small edit\n");
  commitAll(repo, "small edit");

  // The stream emits a piece at the first 256 KiB read boundary whose pending
  // text reaches 1 MiB, so the seam that matters is that piece boundary (not
  // the line boundary). It depends on where the line starts in the patch; the
  // small edit has the same header length as the huge edit below.
  const patch = sh(repo, "git", ["log", "-p", "-U0", "--no-color", "-n1", "--format=%H", "HEAD"]);
  const hunk = patch.indexOf("\n@@");
  const lineStart = patch.indexOf("\n+", hunk) + 1;
  const chunk = 256 * 1024;
  let boundary = chunk - lineStart;

  while (boundary < 1024 * 1024) {
    boundary += chunk;
  }

  // Raw offset of the key is 1 ("+") + content. Put its start 10 bytes before
  // the piece boundary: the piece holds only its first 10 bytes, so only the
  // 64 KiB overlap can carry its start into the continuation piece. Spaces keep
  // the key's word boundaries so the pattern can match.
  const contentOffset = boundary - 11;
  const before = `${"a".repeat(contentOffset - 1)} `;

  fs.writeFileSync(path.join(repo, "seam.js"), `${before}${key} ${"z".repeat(1024)}\n`);
  commitAll(repo, "a key across the piece boundary");

  const result = scan(repo);
  const finding = result.secrets.history.findings.find((entry) => entry.path === "seam.js");

  assert.ok(finding, "the key crossing the piece boundary is reported");
  assert.equal(finding.count, 1);
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
  assert.equal(scan.secrets.tree.available, false, "the tree scan says it did not run, not that it found nothing");
  assert.equal(scan.secrets.history.available, false);
  assert.deepEqual(scan.hotspots, []);
});

test("with git unavailable the text report says unavailable, not none", (t) => {
  const { repo } = initRepo(t, "recover-no-git-text", FIXTURE);

  const result = run(repo, ["recover", "scan"], { PATH: "/nonexistent" });

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Git: unavailable/);
  assert.match(result.output, /Hotspots — ranked by churn × size \(no coverage report\)\n- unavailable/);
  assert.match(result.output, /Secrets in the tree\n- unavailable/);
  assert.match(result.output, /Tracked sensitive files\n- unavailable/);
  assert.match(result.output, /Large files \(over \d+ lines\)\n- unavailable/);
  assert.doesNotMatch(result.output, /Secrets in the tree\n- none/);
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

test("an invalid configured secret pattern is reported instead of scanning nothing silently", (t) => {
  const { repo } = initRepo(t, "recover-invalid-pattern");

  fs.mkdirSync(path.join(repo, ".coding-flow"));
  fs.writeFileSync(
    path.join(repo, ".coding-flow", "harness.json"),
    `${JSON.stringify({ secretPatterns: [{ name: "broken", pattern: "[" }] }, null, 2)}\n`,
  );
  commitAll(repo, "a detector that does not compile");

  const json = run(repo, ["recover", "scan", "--json"]);
  const text = run(repo, ["recover", "scan"]);

  assert.equal(json.code, 0, json.output);
  const scan = JSON.parse(json.output);
  assert.deepEqual(
    scan.secrets.invalid.map((entry) => entry.name),
    ["broken"],
    "the JSON names the detector that did not compile",
  );
  assert.match(text.output, /invalid secret pattern/i);
  assert.match(text.output, /broken/);
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

test("a rename inside a directory (braced numstat form) also follows to the new path", (t) => {
  const { repo } = initRepo(t, "recover-braced-rename");
  fs.mkdirSync(path.join(repo, "dir"));
  fs.writeFileSync(path.join(repo, "dir", "old.js"), "module.exports = 1;\n");
  commitAll(repo, "add");
  sh(repo, "git", ["mv", "dir/old.js", "dir/new.js"]);
  fs.appendFileSync(path.join(repo, "dir", "new.js"), "module.exports = 2;\n");
  commitAll(repo, "rename and edit");

  const result = scan(repo);
  const renamed = result.hotspots.find((row) => row.path === "dir/new.js");

  assert.ok(renamed, "the file is a hotspot under its new name");
  assert.ok(renamed.churn >= 1, `churn lands on the new path, got ${renamed.churn}`);
  assert.equal(
    result.hotspots.some((row) => row.path.includes("{")),
    false,
    "no braced rename template leaks into a path",
  );
});

test("a shallow clone reports churn as unavailable: one snapshot is size, not churn", (t) => {
  const { base, repo } = initRepo(t, "recover-shallow", FIXTURE);
  commitAll(repo, "fixture");

  assert.equal(scan(repo).git.churnAvailable, true, "the full clone has churn");

  const shallowDir = path.join(base, "shallow");
  sh(base, "git", ["clone", "--depth", "1", pathToFileURL(repo).href, shallowDir]);

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

test("a hunk line starting with ++ is content, not a file header", (t) => {
  const { repo } = initRepo(t, "recover-plus-prefix");
  const key = "AKIA" + "IOSFODNN7EXAMPLE";

  fs.writeFileSync(
    path.join(repo, "app.js"),
    `++ query\nconst key = "${key}";\n++ const other = "${key}";\n`,
  );
  commitAll(repo, "a line that looks like a diff header");

  const result = scan(repo);
  const finding = result.secrets.history.findings.find((entry) => entry.name === "AWS access key");

  assert.ok(finding, "the key in the hunk is reported");
  assert.equal(finding.path, "app.js", "the hunk line is content, not a new path");
  assert.equal(finding.count, 2, "the plain line and the ++-prefixed line are both scanned");
});

test("a temp patch directory left by a hard kill is cleared by the next scan", (t) => {
  const { repo } = initRepo(t, "recover-stale-temp", FIXTURE);
  commitAll(repo, "fixture");

  const stale = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-recover-stale-"));
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-recover-fresh-"));
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);

  fs.writeFileSync(path.join(stale, "history.log"), "patch text\n");
  fs.utimesSync(stale, old, old);

  t.after(() => {
    fs.rmSync(fresh, { recursive: true, force: true });
    fs.rmSync(stale, { recursive: true, force: true });
  });

  scan(repo);

  assert.equal(fs.existsSync(stale), false, "a crash's leftover patch directory is removed");
  assert.equal(fs.existsSync(fresh), true, "a directory a live scan could still own is left alone");
});

test("a monorepo's members are detected and every member's code is scanned", (t) => {
  const { repo } = initRepo(t, "recover-monorepo");
  const root = { name: "root", private: true, workspaces: ["packages/*"] };

  fs.writeFileSync(path.join(repo, "package.json"), `${JSON.stringify(root, null, 2)}\n`);

  for (const member of ["api", "web"]) {
    const directory = path.join(repo, "packages", member);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      `${JSON.stringify({ name: member, version: "1.0.0", dependencies: { [member === "api" ? "express" : "react"]: "1.0.0" } }, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(directory, "index.js"), "module.exports = 1;\n");
  }

  commitAll(repo, "two workspace members");

  const result = scan(repo);

  assert.equal(result.stack.workspace.memberCount, 2, "bootstrap detects both members");
  const paths = result.hotspots.map((row) => row.path);
  assert.ok(paths.includes("packages/api/index.js"), "the api member is scanned");
  assert.ok(paths.includes("packages/web/index.js"), "the web member is scanned");
  assert.ok(
    result.testMap.directories.some((entry) => entry.directory === "packages" && entry.codeFiles === 2),
    "the shared parent is measured",
  );
});


test("the scan names the declared security commands and the recipes that apply but are not declared", (t) => {
  const { repo } = initRepo(t, "recover-security-tools");
  fs.writeFileSync(path.join(repo, "go.mod"), "module example.com/demo\n");
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo" }));
  fs.writeFileSync(path.join(repo, "package-lock.json"), "{}");
  fs.mkdirSync(path.join(repo, ".coding-flow"));
  fs.writeFileSync(
    path.join(repo, ".coding-flow", "config.json"),
    JSON.stringify({ validation: { commands: [], security: [{ command: "npm audit --omit=dev", timeoutMs: 60000 }] } }),
  );
  commitAll(repo, "init");

  const result = run(repo, ["recover", "scan", "--json"]);
  assert.equal(result.code, 0, result.output);
  const tools = JSON.parse(result.output).securityTools;
  assert.deepEqual(tools.declared, ["npm audit --omit=dev"]);
  const undeclared = tools.undeclared.map((recipe) => recipe.tool);
  assert.ok(undeclared.includes("govulncheck"), undeclared.join(", "));
  assert.ok(!undeclared.includes("npm-audit"), undeclared.join(", "));

  const text = run(repo, ["recover", "scan"]);
  assert.match(text.output, /- declared: npm audit --omit=dev/);
  assert.match(text.output, /- applies, not declared: govulncheck \(`govulncheck \.\/\.\.\.`\)/);
});

test("with no security command declared, the scan says no scanner runs in verify", (t) => {
  const { repo } = initRepo(t, "recover-security-none");
  fs.writeFileSync(path.join(repo, "app.js"), "module.exports = 1;\n");
  commitAll(repo, "init");

  const result = run(repo, ["recover", "scan"]);
  assert.match(result.output, /- none declared — no scanner runs in verify/);
});

// Story 14-07: with a fresh lcov the hotspots rank by churn × CRAP, the file's
// worst function; without one, by churn × size, and the scan says which.
function crapRepo(t) {
  const { repo } = initRepo(t, "recover-crap");
  const ifs = Array.from({ length: 10 }, (_, i) => `  if (x === ${i}) return ${i};`);
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "route.js"), ["function route(x) {", ...ifs, "  return -1;", "}", ""].join("\n"));
  const big = Array.from({ length: 200 }, (_, i) => `  const v${i} = ${i};`);
  fs.writeFileSync(path.join(repo, "src", "big.js"), ["function big() {", ...big, "}", ""].join("\n"));
  commitAll(repo, "init");
  return repo;
}

function writeLcov(repo) {
  const record = (file, name, lines, hit, branchLines) => [
    `SF:${file}`,
    `FN:1,${name}`,
    ...Array.from({ length: lines }, (_, i) => `DA:${i + 1},${hit}`),
    ...branchLines.map((line) => `BRDA:${line},0,0,${hit}`),
    "end_of_record",
  ];
  fs.mkdirSync(path.join(repo, "coverage"), { recursive: true });
  fs.writeFileSync(path.join(repo, "coverage", "lcov.info"), [
    ...record("src/route.js", "route", 13, 0, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    ...record("src/big.js", "big", 202, 1, []),
    "",
  ].join("\n"));
}

test("without a coverage report hotspots rank by churn × size, and the scan says so", (t) => {
  const repo = crapRepo(t);

  const result = scan(repo);
  assert.equal(result.hotspots[0].path, "src/big.js");
  assert.equal(result.hotspotRanking.by, "churn × size");
  assert.equal(result.hotspots[0].crap, undefined);

  const text = run(repo, ["recover", "scan"]);
  assert.match(text.output, /Hotspots — ranked by churn × size \(no coverage report\)/);
});

test("a fresh lcov ranks by churn × CRAP: the uncovered 10-branch function comes first at 132", (t) => {
  const repo = crapRepo(t);
  writeLcov(repo);

  const result = scan(repo);
  assert.equal(result.hotspotRanking.by, "churn × CRAP");
  assert.equal(result.hotspotRanking.heuristic, true);
  assert.equal(result.hotspots[0].path, "src/route.js");
  assert.equal(result.hotspots[0].crap, 132);
  assert.deepStrictEqual(result.hotspots[0].functions[0], { name: "route", line: 1, length: 13, crap: 132 });

  const text = run(repo, ["recover", "scan"]);
  assert.match(text.output, /Hotspots — ranked by churn × CRAP \(heuristic, from coverage\/lcov\.info\)/);
  assert.match(text.output, /- src\/route\.js: 13 lines, churn \d+, CRAP 132 \(route:1, 13 lines\)/);
});

test("an lcov older than a source it lists is not ranked by", (t) => {
  const repo = crapRepo(t);
  writeLcov(repo);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(repo, "coverage", "lcov.info"), old, old);

  const result = scan(repo);
  assert.equal(result.hotspotRanking.by, "churn × size");
  assert.equal(result.hotspotRanking.reason, "coverage report older than the code");
  assert.equal(result.hotspots[0].path, "src/big.js");
});
