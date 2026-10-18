"use strict";

// Running the story's declared validation: which commands (story, Spec Kit,
// config), executing them with a timeout and a clean environment, reading a
// cache hit from their output, and recording the machine they ran on.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const { cwd } = require("./context");
const { readConfig } = require("./config");
const { readStoryPart, resolveProjectPath } = require("./story");
const { readJson, selectFailureLines } = require("./util");

function resolveStoryDir(story) {
  if (!story) {
    return null;
  }

  const resolved = resolveProjectPath(story);

  if (!resolved || !resolved.insideRoot || !resolved.exists) {
    return null;
  }

  return fs.statSync(resolved.fullPath).isDirectory()
    ? resolved.fullPath
    : path.dirname(resolved.fullPath);
}

// Extracts the command lines under "## Commands": the lines of a fenced block, plus
// labelled bullets (`- Command: `x``) because a model reading "a block" often writes
// that instead, and verify must not silently find zero commands because of it.
function parseTestsCommands(testsMarkdown) {
  const lines = testsMarkdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === "## commands");

  if (start === -1) {
    return [];
  }

  const commands = [];
  let inFence = false;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("## ")) {
      break;
    }

    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence && trimmed && !trimmed.startsWith("#")) {
      commands.push(trimmed);
    } else if (!inFence) {
      const bullet = trimmed.match(/^[-*]\s+command:\s*`([^`]+)`/i);

      if (bullet) {
        commands.push(bullet[1].trim());
      }
    }
  }

  return commands;
}

// Source of the commands, by decreasing priority: explicit config, then the
// story's plan.md contract, then the usual package.json scripts.
function resolveValidationCommands({ storyDir = null, fresh = false } = {}) {
  const config = readConfig(cwd);

  if (config.validation) {
    // Correctness (`commands`) and deterministic quality (`quality`) both flow
    // through the same executed-and-captured proof; a red quality command blocks
    // exactly like a red test. Tests run first, then quality.
    // `fresh`: the story's risk asks for tests that really ran, so the project's
    // cache-bypassing commands stand in for the usual ones when it declared any.
    const freshCommands = Array.isArray(config.validation.freshCommands) ? config.validation.freshCommands : [];
    const entries = (value) => (Array.isArray(value) ? value : []);
    const quality = entries(config.validation.quality);
    const declared = [
      ...(fresh && freshCommands.length > 0 ? freshCommands : entries(config.validation.commands)),
      ...quality,
    ];

    if (declared.length > 0) {
      // Entries are strings or `{ command, timeoutMs }`; everything downstream
      // keeps seeing command strings, and the limits travel beside them.
      const globalTimeout = Number.isFinite(config.validation.timeoutMs) ? config.validation.timeoutMs : null;
      // Keyed by command string: one limit per distinct command, the last declared wins.
      const timeouts = {};
      const commandOf = (entry) => {
        const command = typeof entry === "string" ? entry : entry.command;
        const timeoutMs = typeof entry === "string" ? globalTimeout : entry.timeoutMs || globalTimeout;

        if (timeoutMs) {
          timeouts[command] = timeoutMs;
        }

        return command;
      };

      // `quality` is returned so a cached lint is not refused as stale tests.
      return {
        source: "config",
        commands: declared.map(commandOf),
        quality: quality.map(commandOf),
        timeouts,
      };
    }
  }

  if (storyDir) {
    // The "plan" role: plan.md, or story.md for a single-file story.
    const planContent = readStoryPart(storyDir, "plan");

    if (planContent) {
      const commands = parseTestsCommands(planContent);

      if (commands.length > 0) {
        return { source: "plan.md", commands };
      }
    }
  }

  const pkg = readJson(path.join(cwd, "package.json"), null);

  if (pkg && pkg.scripts && typeof pkg.scripts === "object") {
    // Correctness first, then deterministic quality (lint/format). These are the
    // conventional script names; a project with other tools declares them in
    // config.validation.quality instead.
    const commands = ["typecheck", "type-check", "lint", "test", "format:check", "format-check"]
      .filter((name) => pkg.scripts[name])
      .map((name) => `npm run ${name}`);

    if (commands.length > 0) {
      return { source: "package.json", commands };
    }
  }

  return { source: null, commands: [] };
}

// A test suite that prints a lot is not a failing test suite. At 10 MB Node kills
// the child with SIGTERM and returns ENOBUFS with status null, which this function
// used to fold into `exit 127` — a green suite reported red, an evidence written,
// and the story marked blocked in the ledger. `turbo test` over a monorepo with
// jsdom clears 10 MB without trying.
//
// Two changes: a much larger buffer, and — when it still overflows — an explicit
// tool failure instead of a fabricated exit code. We only ever keep the last 4 KB
// of each stream, so the buffer exists purely to let the child finish.
// Overridable so a project with an unusually loud suite can raise it without a
// release — and so the overflow path itself is testable without generating a
// quarter of a gigabyte of output.
function outputBufferBytes() {
  const override = Number.parseInt(process.env.CODING_FLOW_MAX_OUTPUT_BYTES || "", 10);
  return Number.isFinite(override) && override > 0 ? override : 256 * 1024 * 1024;
}

// Did this command run, or did a build tool replay a previous run? Read from the
// WHOLE output (the stored tail may have lost the summary). turbo and nx only;
// anything else is "unknown". `cached`/`total` are present when the summary
// gave counts.
function detectCacheState(output) {
  const text = String(output || "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

  const turbo = [...text.matchAll(/Cached:\s+(\d+)\s+cached,\s+(\d+)\s+total/g)].pop();
  if (turbo) {
    const cached = Number(turbo[1]);
    const total = Number(turbo[2]);
    const state = cached === 0 ? "none" : cached >= total ? "full" : "partial";
    return { cache: state, cached, total };
  }

  if (/>>>\s*FULL TURBO/.test(text)) {
    return { cache: "full" };
  }

  const nx = [...text.matchAll(/read the output from the cache instead of running the command for (\d+) out of (\d+) tasks/g)].pop();
  if (nx) {
    const cached = Number(nx[1]);
    const total = Number(nx[2]);
    return { cache: cached >= total ? "full" : "partial", cached, total };
  }

  if (/Nx read the output from the cache|\[existing outputs match the cache|\[local cache\]/.test(text)) {
    return { cache: "partial" };
  }

  return { cache: "unknown" };
}

const DEFAULT_COMMAND_TIMEOUT_MS = 600000;

// Variables a clean-env run drops, by NAME only: the values are never read or recorded.
const SECRET_ENV_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY)/i;

// The child environment with credential-looking variables removed. PATH, HOME and
// CI always stay; anything else (NODE_*, npm_*, the rest) stays unless its name
// looks like a credential — NODE_AUTH_TOKEN is a secret whatever its prefix.
function cleanEnvironment(source = process.env) {
  const env = {};
  const dropped = [];

  for (const [name, value] of Object.entries(source)) {
    if (["PATH", "HOME", "CI"].includes(name) || !SECRET_ENV_NAME.test(name)) {
      env[name] = value;
    } else {
      dropped.push(name);
    }
  }

  return { env, dropped: dropped.sort() };
}

// Nobody is watching: no terminal on both ends, or a CI runner. Agents run with
// no TTY, which is the point. AI_FLOW_FORCE_TTY=1 exists for tests only, so it is
// honoured under NODE_ENV=test alone: an agent cannot use it to skip the refusal.
// A plan.md line that only names one of the project's own package.json scripts
// (`npm test`, `pnpm run lint`) carries no agent-written code: the script body is
// the project's, and is exactly what the package.json fallback already runs when
// no plan declares anything. Anything more (arguments, `&&`, a raw command) is not.
const SCRIPT_INVOCATION = /^(?:npm|pnpm|yarn|bun)\s+(?:(?:run|run-script)\s+)?([\w:.@/-]+)$/;

function isProjectScriptInvocation(command) {
  const match = String(command).trim().match(SCRIPT_INVOCATION);

  if (!match) {
    return false;
  }

  const pkg = readJson(path.join(cwd, "package.json"), null);
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const name = match[1] === "t" ? "test" : match[1];
  return Object.prototype.hasOwnProperty.call(scripts, name) && typeof scripts[name] === "string";
}

function isUnattended() {
  const ci = (process.env.CI || "").toLowerCase();

  if (!["", "0", "false"].includes(ci)) {
    return true;
  }

  if (process.env.NODE_ENV === "test" && process.env.AI_FLOW_FORCE_TTY === "1") {
    return false;
  }

  return !(process.stdin.isTTY && process.stdout.isTTY);
}

function runValidationCommand(command, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, env } = {}) {
  const maxOutputBytes = outputBufferBytes();
  const started = Date.now();
  const result = spawnSync(command, [], {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes,
    ...(env ? { env } : {}),
  });

  const cap = 4000;
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
  const overflowed = Boolean(result.error && result.error.code === "ENOBUFS");
  const exitCode = result.status != null ? result.status : timedOut ? 124 : result.error ? 127 : 1;

  // `toolError` says "the harness could not observe this command", which is not
  // the same claim as "this command failed". Both block a verify — an unobserved
  // command proves nothing — but only one of them means the code is broken, and
  // the report must not confuse the two.
  const toolError = overflowed
    ? `output exceeded ${Math.round(maxOutputBytes / (1024 * 1024))} MB and could not be captured; ` +
      "the command's real exit code is unknown"
    : !timedOut && result.error && result.status == null
      ? `could not be executed (${result.error.code || result.error.message})`
      : null;

  const ok = !toolError && exitCode === 0;

  return {
    command,
    exitCode: toolError ? null : exitCode,
    ok,
    timedOut,
    ...(timedOut ? { timeoutMs } : {}),
    toolError,
    durationMs: Date.now() - started,
    ...detectCacheState(`${result.stdout || ""}\n${result.stderr || ""}`),
    stdoutTail: (result.stdout || "").slice(-cap),
    stderrTail: (result.stderr || "").slice(-cap),
    // Selected from the WHOLE output, which only exists here: by the time anyone
    // reads the evidence file, all that survives is the 4 KB tail above, and a
    // verbose runner pushes the failure out of it long before the end. Recorded
    // only on a failure — a green run has nothing to name, and the evidence
    // ledger is append-only.
    ...(ok ? {} : { failureLines: selectFailureLines(`${result.stdout || ""}\n${result.stderr || ""}`) }),
  };
}

// The limit one command runs under, when the project declared one.
function commandTimeout(resolution, command) {
  const timeoutMs = resolution.timeouts && resolution.timeouts[command];

  return timeoutMs ? { timeoutMs } : {};
}

function resultStatus(item) {
  if (item.ok) {
    return "ok";
  }

  if (item.toolError) {
    return "tool error";
  }

  return item.timedOut ? "timeout" : `exit ${item.exitCode}`;
}

// Reproducibility fingerprint: a green verify is only auditable if we know the
// toolchain it ran on. We record the Node runtime, the OS/arch, and the hash of
// the dependency lockfile (the first one found). Cheap, no new dependency, and it
// turns "green here" into "green on this exact environment" for the ledger.
function captureEnvironment() {
  const lockfiles = [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
  ];

  let lockfile = null;

  for (const name of lockfiles) {
    const lockPath = path.join(cwd, name);

    if (fs.existsSync(lockPath)) {
      try {
        const sha256 = crypto.createHash("sha256").update(fs.readFileSync(lockPath)).digest("hex");
        lockfile = { name, sha256 };
      } catch {
        lockfile = { name, sha256: null };
      }
      break;
    }
  }

  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    lockfile,
  };
}

// --- coverage gate: a green suite is not evidence that the change is covered --
//
// Executing the declared commands proves they ran and passed. It does NOT prove
// they prove anything about THIS story: a change that adds no test rides on a
// suite that was already green before it, and comes out `verified`. That is the
// gap between "the tests passed" and "the change is tested", and it is the whole
// reason a story can be shipped with a proof behind it and no coverage in it.
//
// So: on a medium/high-risk story, a green run whose diff touches behavior but no
// test is NOT ok. It is not a failure of the suite either — it is a proof that
// does not reach far enough, reported as its own thing.
//
// Deliberately narrow, because a gate that fires wrongly gets disabled:
// - low-risk stories never trip it (copy, styling — the QUICK path stays free);
// - a diff of docs/story/lockfile-only changes trips nothing (no behavior moved);
// - outside git, or with no visible diff, the gate cannot see and stays silent.

module.exports = {
  resolveStoryDir,
  parseTestsCommands,
  resolveValidationCommands,
  cleanEnvironment,
  isUnattended,
  isProjectScriptInvocation,
  runValidationCommand,
  commandTimeout,
  resultStatus,
  captureEnvironment,
};
