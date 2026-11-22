"use strict";

// Story 14-02: a public repository must not publish a trace to an open security
// hole. `doctor` reads the tracked dossier (`docs/recovery/findings.md`), asks
// `gh` for the visibility, and warns only when the trace is really exposed.
// `gh` is optional: when it cannot answer, the check says it was not made.

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(__dirname, "..", "bin", "ai-flow.js");
const skipOnWindows = process.platform === "win32" ? "the fake gh is a POSIX /bin/sh script" : false;

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-flow-doctor-recovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, [CLI, "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

function check(dir, visibility) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "coding-flow-fake-gh-"));
  fs.writeFileSync(
    path.join(bin, "gh"),
    visibility === null
      ? "#!/bin/sh\nexit 1\n"
      : `#!/bin/sh\nprintf '%s\\n' '{"visibility":"${visibility}"}'\n`,
    { mode: 0o755 },
  );

  try {
    const out = execFileSync(process.execPath, [CLI, "doctor", "--json"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });
    return JSON.parse(out);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

function writeFindings(dir, content, { local = false } = {}) {
  const target = local
    ? path.join(dir, ".coding-flow", "recovery")
    : path.join(dir, "docs", "recovery");

  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "findings.md"), content);
}

const EXPOSED = `### R-01 — IDOR on the invoice route

- State: confirmed
- Dimension: security
- Severity: high impact × reachable
- Location: server.js:1
- Trace: server.js:1
`;

test("a public repository warns about a tracked open security trace", { skip: skipOnWindows }, (t) => {
  const dir = project(t);
  writeFindings(dir, EXPOSED);

  const report = check(dir, "PUBLIC");
  const warning = report.warnings.find((entry) => entry.code === "recovery_public_trace");

  assert.ok(warning, "the exposure is a warning");
  assert.match(warning.message, /public repository/);
  assert.match(warning.message, /R-01/);
  assert.match(warning.message, /findings\.local\.md/);
});

test("a private repository does not warn", { skip: skipOnWindows }, (t) => {
  const dir = project(t);
  writeFindings(dir, EXPOSED);

  const report = check(dir, "PRIVATE");

  assert.equal(
    report.warnings.some((entry) => entry.code === "recovery_public_trace"),
    false,
  );
});

test("an open security finding without a Trace in the tracked file does not warn", { skip: skipOnWindows }, (t) => {
  const dir = project(t);
  writeFindings(
    dir,
    `### R-01 — IDOR on the invoice route

- State: confirmed
- Dimension: security
- Severity: high
`,
  );

  const report = check(dir, "PUBLIC");

  assert.equal(
    report.warnings.some((entry) => entry.code === "recovery_public_trace"),
    false,
  );
});

test("a trace kept only in the git-ignored local file does not warn", { skip: skipOnWindows }, (t) => {
  const dir = project(t);
  writeFindings(dir, EXPOSED, { local: true });

  const report = check(dir, "PUBLIC");

  assert.equal(
    report.warnings.some((entry) => entry.code === "recovery_public_trace"),
    false,
  );
});

test("when gh cannot report visibility the check says so without warning", { skip: skipOnWindows }, (t) => {
  const dir = project(t);
  writeFindings(dir, EXPOSED);

  const report = check(dir, null);

  assert.equal(
    report.warnings.some((entry) => entry.code === "recovery_public_trace"),
    false,
  );
  const note = report.notes.find((entry) => entry.code === "recovery_visibility_unknown");

  assert.ok(note, "the unknown visibility is reported as a note");
  assert.match(note.message, /R-01/);
});
