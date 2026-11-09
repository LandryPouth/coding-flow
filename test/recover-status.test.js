"use strict";

// Story 14-02: `status` reads the recovery dossier and derives what is actually
// proven. The tool, not the agent, decides whether a `State: fixed` is proven
// ("Fixed by:" names an ok verify run) or only claimed. Locations that no longer
// resolve are reported instead of trusted.

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(__dirname, "..", "bin", "ai-flow.js");

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(t, prefix) {
  const repo = tmp(t, prefix);

  sh(repo, "git", ["-c", "init.defaultBranch=main", "init"]);
  sh(repo, "git", ["config", "user.email", "test@example.com"]);
  sh(repo, "git", ["config", "user.name", "Test"]);
  return repo;
}

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

function writeFindings(repo, content, { local = false } = {}) {
  const dir = local
    ? path.join(repo, ".coding-flow", "recovery")
    : path.join(repo, "docs", "recovery");

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, local ? "findings.local.md" : "findings.md"), content);
}

function writeVerify(repo, name, evidence) {
  const dir = path.join(repo, ".coding-flow", "runs");

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(evidence, null, 2)}\n`);
}

function statusText(repo) {
  const result = run(repo, ["status"]);

  assert.equal(result.code, 0, result.output);
  return result.output;
}

function statusJson(repo) {
  const result = run(repo, ["status", "--json"]);

  assert.equal(result.code, 0, result.output);
  return JSON.parse(result.output);
}

function writeLines(repo, relativePath, count) {
  const absolute = path.join(repo, relativePath);

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n")}\n`);
}

const MIXED = `### R-01 — IDOR on the invoice route

- State: confirmed
- Dimension: security
- Severity: high impact × reachable from any authenticated user
- Location: src/a.js:10
- Trace: server.js:1 → src/a.js:10

### R-02 — Stale dependency

- State: refuted
- Dimension: dependencies
- Severity: low

### R-03 — Missing transaction

- State: mitigated
- Dimension: reliability
- Severity: medium

### R-04 — Old CORS policy

- State: accepted
- Dimension: security
- Severity: low
- Revisit: 2000-01-01
`;

test("status prints the recovery counts and the open findings by severity", (t) => {
  const repo = initRepo(t, "recover-status-mixed");

  writeLines(repo, "src/a.js", 20);
  writeFindings(repo, MIXED);

  const output = statusText(repo);

  assert.match(output, /Recovery — docs\/recovery\/findings\.md/);
  assert.match(output, /- 4 finding\(s\): confirmed 1, mitigated 1, accepted 1, refuted 1/);
  assert.match(output, /open by severity:/);
  assert.match(output, /\[high\] R-01 — IDOR on the invoice route \(src\/a\.js:10\)/);
  assert.doesNotMatch(output, /\[.*\] R-02/, "a refuted finding is not open");
  assert.match(output, /revisit overdue: R-04 \(2000-01-01\)/);

  const data = statusJson(repo);

  assert.equal(data.recovery.files.tracked, true);
  assert.equal(data.recovery.files.local, false);
  assert.equal(data.recovery.counts.confirmed, 1);
  assert.equal(data.recovery.counts.refuted, 1);
  assert.equal(data.recovery.open.length, 1);
  assert.deepEqual(
    {
      id: data.recovery.open[0].id,
      dimension: data.recovery.open[0].dimension,
      severity: data.recovery.open[0].severity,
      location: data.recovery.open[0].location,
    },
    { id: "R-01", dimension: "security", severity: 3, location: "src/a.js:10" },
  );
});

test('a fixed finding is "proven" only when Fixed by names an ok verify run', (t) => {
  const repo = initRepo(t, "recover-status-fixed");

  writeVerify(repo, "green-verify.json", { ok: true });
  writeVerify(repo, "failed-verify.json", { ok: false });
  writeVerify(repo, "red-at-base-verify.json", { ok: true, redAtBase: { ok: false } });
  writeVerify(repo, "red-at-base-ok-verify.json", { ok: true, redAtBase: { ok: true } });

  writeFindings(
    repo,
    `### R-01 — No run named

- State: fixed
- Dimension: security
- Severity: high

### R-02 — A green run

- State: fixed
- Dimension: security
- Severity: high
- Fixed by: green-verify.json

### R-03 — A failed run

- State: fixed
- Dimension: security
- Severity: high
- Fixed by: failed-verify.json

### R-04 — Green but red at base

- State: fixed
- Dimension: security
- Severity: high
- Fixed by: red-at-base-verify.json

### R-05 — Green and red at base

- State: fixed
- Dimension: security
- Severity: high
- Fixed by: red-at-base-ok-verify.json
`,
  );

  const output = statusText(repo);

  assert.match(output, /fixed \(proven\): R-02, R-05/);
  assert.match(output, /fixed \(claimed\): R-01, R-03, R-04/);

  const data = statusJson(repo);

  assert.deepEqual(data.recovery.fixedProven, ["R-02", "R-05"]);
  assert.deepEqual(data.recovery.fixedClaimed, ["R-01", "R-03", "R-04"]);
});

test("a location whose file is gone or whose line is past the end is unresolved", (t) => {
  const repo = initRepo(t, "recover-status-location");

  writeLines(repo, "src/a.ts", 120);
  writeFindings(
    repo,
    `### R-01 — Past the end

- State: confirmed
- Dimension: security
- Severity: high
- Location: src/a.ts:400

### R-02 — Resolves

- State: confirmed
- Dimension: security
- Severity: high
- Location: src/a.ts:10

### R-03 — Missing file

- State: confirmed
- Dimension: security
- Severity: high
- Location: src/missing.ts:1

### R-04 — File only, no line

- State: confirmed
- Dimension: security
- Severity: low
- Location: src/a.ts

### R-05 — A range and a column inside the file

- State: confirmed
- Dimension: security
- Severity: low
- Location: src/a.ts:10-20, src/a.ts:12:5

### R-06 — A range starting past the end

- State: confirmed
- Dimension: security
- Severity: low
- Location: src/a.ts:400-410
`,
  );

  const output = statusText(repo);

  assert.match(
    output,
    /unresolved location: R-01 \(src\/a\.ts:400\), R-03 \(src\/missing\.ts:1\), R-06 \(src\/a\.ts:400-410\)/,
  );

  const data = statusJson(repo);

  assert.deepEqual(data.recovery.unresolvedLocations, [
    { id: "R-01", location: "src/a.ts:400" },
    { id: "R-03", location: "src/missing.ts:1" },
    { id: "R-06", location: "src/a.ts:400-410" },
  ]);
});

test("accepted findings without a revisit date or with a past one are flagged", (t) => {
  const repo = initRepo(t, "recover-status-accepted");

  writeFindings(
    repo,
    `### R-01 — No revisit

- State: accepted
- Dimension: security
- Severity: low

### R-02 — Overdue

- State: accepted
- Dimension: security
- Severity: low
- Revisit: 2000-01-01

### R-03 — In the future

- State: accepted
- Dimension: security
- Severity: low
- Revisit: 2999-01-01
`,
  );

  const output = statusText(repo);

  assert.match(output, /accepted, no revisit date: R-01/);
  assert.match(output, /revisit overdue: R-02 \(2000-01-01\)/);
  assert.doesNotMatch(output, /R-03 \(2999-01-01\)/);

  const data = statusJson(repo);

  assert.deepEqual(data.recovery.acceptedNoRevisit, ["R-01"]);
  assert.deepEqual(data.recovery.revisitOverdue, [{ id: "R-02", revisit: "2000-01-01" }]);
});

test("the local findings file wins for an id and a malformed block is reported", (t) => {
  const repo = initRepo(t, "recover-status-local");

  writeFindings(
    repo,
    `### R-01 — Open in tracked

- State: confirmed
- Dimension: security
- Severity: high
- Trace: src/a.js:1

### R-02 — No state

- Dimension: security
- Severity: high

### R03 — Id without its dash

- State: confirmed
- Dimension: security
- Severity: high
`,
  );
  writeFindings(
    repo,
    `### R-01 — Accepted locally

- State: accepted
- Dimension: security
- Severity: high
- Revisit: 2999-01-01
`,
    { local: true },
  );

  const data = statusJson(repo);

  assert.equal(data.recovery.files.tracked, true);
  assert.equal(data.recovery.files.local, true);
  assert.equal(data.recovery.counts.accepted, 1, "the local block replaces the tracked one for R-01");
  assert.equal(data.recovery.open.length, 0);
  assert.deepEqual(
    data.recovery.unreadable.map((entry) => entry.id),
    ["R-02", null],
    "a block without a State or an R-NN id is reported, never silently dropped",
  );
  assert.match(data.recovery.unreadable[1].reason, /without an R-NN id/);

  const output = statusText(repo);

  assert.match(output, /Recovery — docs\/recovery\/findings\.md \+ \.coding-flow\/recovery\/findings\.local\.md/);
});

test("a findings.md under .coding-flow/recovery is not the local override", (t) => {
  const repo = initRepo(t, "recover-status-local-name");
  const dir = path.join(repo, ".coding-flow", "recovery");

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "findings.md"), "### R-01 — Wrong file\n\n- State: confirmed\n");

  const data = statusJson(repo);

  assert.equal("recovery" in data, false, "only findings.local.md is read as the local dossier");
});

test("Fixed by proves nothing outside the runs directory or when one run covers two findings", (t) => {
  const repo = initRepo(t, "recover-status-forged");

  writeVerify(repo, "green-verify.json", { ok: true });
  writeVerify(repo, "shared-verify.json", { ok: true });
  writeVerify(repo, "green-review.json", { ok: true });
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "fake-verify.json"), '{"ok":true}\n');

  writeFindings(
    repo,
    `### R-01 — Escapes the runs directory

- State: fixed
- Fixed by: ../../docs/fake-verify.json

### R-02 — Not a verify run

- State: fixed
- Fixed by: green-review.json

### R-03 — Shares a run

- State: fixed
- Fixed by: shared-verify.json

### R-04 — Shares the same run

- State: fixed
- Fixed by: shared-verify.json

### R-05 — Its own green run

- State: fixed
- Fixed by: green-verify.json
`,
  );

  const data = statusJson(repo);

  assert.deepEqual(data.recovery.fixedProven, ["R-05"]);
  assert.deepEqual(data.recovery.fixedClaimed, ["R-01", "R-02", "R-03", "R-04"]);
});

test("without docs/recovery the status output has no Recovery section", (t) => {
  const repo = initRepo(t, "recover-status-absent");

  const output = statusText(repo);
  const data = statusJson(repo);

  assert.doesNotMatch(output, /Recovery/);
  assert.equal("recovery" in data, false, "a project that never ran recovery gets byte-identical JSON");
});
