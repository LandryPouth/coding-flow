"use strict";

// Executed proof that the Codex sandbox profile really denies a write, instead of
// trusting that the file we generated does. Runs the real `codex sandbox` against
// a path the profile denies and reads what happened:
//
//   ok: true   the write was refused by the sandbox
//   ok: false  the write went through — the profile is not enforcing (worst case)
//   ok: null   Codex failed for a reason that says nothing about the sandbox
//              (most often: the project is not trusted, so Codex never loaded
//              the project's .codex/config.toml)
//
// Observed against codex-cli 0.138: a denied write exits non-zero with "Permission
// denied" (or "Read-only file system" when the target does not exist yet); an
// untrusted project fails with "default_permissions requires a `[permissions]`
// table" before running anything. A deny GLOB only covers files that exist when the
// sandbox starts, so the probe targets a denied DIRECTORY, which also covers files
// created later.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { cwd } = require("./context");
const { loadPolicy } = require("./guard");
const { PROFILE_NAME } = require("./codex-settings");
const { isCommandAvailable } = require("./util");

// Insurance against a hung subprocess, not a tight budget (same reasoning as the
// guard hook's own timeout): a probe must never be able to hang doctor or init.
const PROBE_TIMEOUT_MS = 20000;

const DENIAL_SIGNAL = /permission denied|read-only file system|operation not permitted/i;
const UNTRUSTED_SIGNAL = /requires a `?\[permissions\]`? table|unknown permissions? profile|not found in/i;

// The first denied path that is a plain directory (`dir/**` with no glob in `dir`).
function probeDirectory(root) {
  for (const glob of loadPolicy(root).blockedPaths) {
    if (typeof glob === "string" && glob.endsWith("/**")) {
      const dir = glob.slice(0, -3);

      if (dir && !/[*?[\]{}]/.test(dir) && !path.isAbsolute(dir) && !dir.split("/").includes("..")) {
        return dir;
      }
    }
  }

  return null;
}

function firstLine(text) {
  return (
    String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("WARNING:")) || ""
  );
}

// Pure: the raw outcome of the spawn → the probe verdict. `wrote` is whether the
// probe file exists afterwards.
function interpretProbe({ status, signal, error, stderr, wrote, directory }) {
  if (wrote) {
    return {
      ran: true,
      ok: false,
      detail: `a write into ${directory}/ succeeded under the Codex sandbox — the profile is not enforcing`,
    };
  }

  if (error || signal) {
    const timedOut = (error && error.code === "ETIMEDOUT") || signal === "SIGTERM";

    return {
      ran: true,
      ok: null,
      detail: timedOut ? "codex itself failed unrelated to the sandbox: timed out" : `codex itself failed unrelated to the sandbox: ${error ? error.message : signal}`,
    };
  }

  if (status !== 0 && DENIAL_SIGNAL.test(stderr || "")) {
    return { ran: true, ok: true, detail: `a write into ${directory}/ was denied by the sandbox` };
  }

  const reason = firstLine(stderr) || `exit ${status}`;

  return {
    ran: true,
    ok: null,
    detail: UNTRUSTED_SIGNAL.test(stderr || "")
      ? `codex did not load the project profile (is this project trusted in Codex?): ${reason}`
      : `codex itself failed unrelated to the sandbox: ${reason}`,
  };
}

// `spawn` and `available` are injectable so the outcomes are testable without a
// real codex. Always cleans up what it created, whatever the outcome.
function probeCodexSandbox({ root = cwd, spawn = spawnSync, available = isCommandAvailable, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!available("codex")) {
    return { ran: false, ok: null, detail: "codex is not on PATH — sandbox not checked" };
  }

  const directory = probeDirectory(root);

  if (!directory) {
    return { ran: false, ok: null, detail: "no directory-type blocked path (`dir/**`) to probe — sandbox not checked" };
  }

  const dirPath = path.join(root, directory);
  const createdDir = !fs.existsSync(dirPath);
  const probeFile = path.join(dirPath, `.coding-flow-probe-${process.pid}-${Date.now()}`);

  try {
    if (createdDir) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const result = spawn(
      "codex",
      ["sandbox", "--permissions-profile", PROFILE_NAME, "-C", root, "--", "sh", "-c", 'echo probe > "$1"', "sh", probeFile],
      { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] },
    );

    return interpretProbe({
      status: result.status,
      signal: result.signal,
      error: result.error,
      stderr: `${result.stderr || ""}`,
      wrote: fs.existsSync(probeFile),
      directory,
    });
  } finally {
    fs.rmSync(probeFile, { force: true });

    if (createdDir) {
      try {
        fs.rmdirSync(dirPath);
      } catch {
        // Not empty (something else wrote there) — not ours to remove.
      }
    }
  }
}

// The three plain-language outcomes `doctor` and `init` print.
function describeProbe(probe) {
  if (!probe.ran) {
    return `not checked — ${probe.detail}`;
  }

  if (probe.ok === true) {
    return `confirmed working — ${probe.detail}`;
  }

  if (probe.ok === false) {
    return `confirmed BROKEN — ${probe.detail}`;
  }

  return `could not be confirmed — ${probe.detail}`;
}

module.exports = { probeCodexSandbox, interpretProbe, describeProbe, probeDirectory, PROBE_TIMEOUT_MS };
