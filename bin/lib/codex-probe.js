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
// denied" on the probe file (or "Read-only file system" when the target does not exist yet); an
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

// Insurance against a hung subprocess, not a tight budget (same reasoning as the
// guard hook's own timeout): a probe must never be able to hang doctor or init.
const PROBE_TIMEOUT_MS = 20000;

// Only the probe shell's own refusal of the probe file counts — dash words it "sh: 1:
// cannot create <file>: Permission denied", bash "sh: line 1: <file>: Permission denied".
// A bare "permission denied" / "operation not permitted" also comes from a
// sandbox that failed to start (bwrap, config EACCES) — that proves nothing was enforced.
const DENIAL_SIGNAL = /(cannot create [^\n]*|\.coding-flow-probe-[^\n]*): (permission denied|read-only file system)/i;
const UNTRUSTED_SIGNAL = /requires a `?\[permissions\]`? table|unknown permissions? profile|not found in/i;

// Bounded `codex --version`: "ok", "absent" (not on PATH) or a "broken: ..." reason
// (found but failing or hung). The generic isCommandAvailable has no timeout, so a
// hung codex would block doctor/init before the probe's own limit even starts.
function checkCodexBinary(timeoutMs = PROBE_TIMEOUT_MS) {
  const result = spawnSync("codex", ["--version"], { stdio: "ignore", timeout: timeoutMs });

  if (result.error) {
    return result.error.code === "ENOENT" ? "absent" : `broken: ${result.error.code === "ETIMEDOUT" ? "`codex --version` timed out" : result.error.message}`;
  }

  return result.status === 0 ? "ok" : `broken: \`codex --version\` exited ${result.status}`;
}

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

  // The probe file name embeds pid and time: keep it out of the detail so an
  // unchanged failure stays identical between runs (evidence dedupes on detail).
  const reason = (firstLine(stderr) || `exit ${status}`).replace(/\S*\.coding-flow-probe-[\w-]+/g, "<probe file>");

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
// `available` returns true/false or the string result of checkCodexBinary.
function probeCodexSandbox({ root = cwd, spawn = spawnSync, available = () => checkCodexBinary(timeoutMs), timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const binary = available("codex");

  if (binary === false || binary === "absent") {
    return { ran: false, ok: null, reason: "no-binary", detail: "codex is not on PATH — sandbox not checked" };
  }

  if (typeof binary === "string" && binary !== "ok") {
    return { ran: true, ok: null, detail: `codex itself failed unrelated to the sandbox: ${binary.replace(/^broken: /, "")}` };
  }

  const directory = probeDirectory(root);

  if (!directory) {
    return { ran: false, ok: null, reason: "no-directory", detail: "no directory-type blocked path (`dir/**`) to probe — sandbox not checked" };
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

module.exports = { probeCodexSandbox, interpretProbe, describeProbe, probeDirectory, checkCodexBinary, PROBE_TIMEOUT_MS };
