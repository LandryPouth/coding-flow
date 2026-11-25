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
const { defaultOf } = require("./rules-registry");

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
// `heading` reads another section the same way (`## Fixers`, story 19-05).
function parseTestsCommands(testsMarkdown, heading = "## commands") {
  const lines = testsMarkdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading);

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
//
// Fixers (story 19-05) run before every check and may rewrite files:
// `validation.fix` from the config whatever source the checks come from, else the
// `## Fixers` block of the plan when the checks come from it too (and then
// refused unattended exactly like plan checks). Absent, `fix` is empty and
// verify runs as it always did.
function resolveValidationCommands({ storyDir = null, fresh = false } = {}) {
  const resolution = resolveCheckCommands({ storyDir, fresh });
  const config = readConfig(cwd);
  const declaredFix = config.validation && Array.isArray(config.validation.fix) ? config.validation.fix : [];

  if (declaredFix.length > 0) {
    const globalTimeout = config.validation && Number.isFinite(config.validation.timeoutMs) ? config.validation.timeoutMs : null;
    // Apart from the checks' map: a fixer and a check may share a text
    // (`npm run lint` as both) and still carry different limits.
    const fixTimeouts = {};
    const fix = declaredFix.map((entry) => {
      const command = typeof entry === "string" ? entry : entry.command;
      const timeoutMs = typeof entry === "string" ? globalTimeout : entry.timeoutMs || globalTimeout;

      if (timeoutMs) {
        fixTimeouts[command] = timeoutMs;
      }

      return command;
    });

    return { ...resolution, fix, fixSource: "config", fixTimeouts };
  }

  const planFix = storyDir ? parseTestsCommands(readStoryPart(storyDir, "plan") || "", "## fixers") : [];

  if (resolution.source === "plan.md" && planFix.length > 0) {
    return { ...resolution, fix: planFix, fixSource: "plan.md", fixTimeouts: {} };
  }

  // A `## Fixers` block whose checks come from elsewhere is not run: said, not silent.
  return { ...resolution, fix: [], fixSource: null, fixTimeouts: {}, ...(planFix.length > 0 ? { planFixersIgnored: planFix.length } : {}) };
}

function resolveCheckCommands({ storyDir = null, fresh = false } = {}) {
  const config = readConfig(cwd);

  if (config.validation) {
    // Correctness (`commands`) and deterministic quality (`quality`) both flow
    // through the same executed-and-captured proof; a red quality command blocks
    // exactly like a red test. Tests run first, then quality, then security.
    // `fresh`: the story's risk asks for tests that really ran, so the project's
    // cache-bypassing commands stand in for the usual ones when it declared any.
    const freshCommands = Array.isArray(config.validation.freshCommands) ? config.validation.freshCommands : [];
    const entries = (value) => (Array.isArray(value) ? value : []);
    const quality = entries(config.validation.quality);
    const security = entries(config.validation.security);
    const declared = [
      ...(fresh && freshCommands.length > 0 ? freshCommands : entries(config.validation.commands)),
      ...quality,
      ...security,
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

      // `quality` is returned so a cached lint is not refused as stale tests;
      // `security` so a scanner that could not run is judged as not examined.
      return {
        source: "config",
        commands: declared.map(commandOf),
        quality: quality.map(commandOf),
        security: security.map(commandOf),
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

// The one per-command time limit when the project sets none (story 26-06: it
// was defined twice, here and in worktree.js). Read at call time from the
// rules registry, so land's lock sizing and this runner cannot disagree.
function commandTimeoutDefault() {
  return defaultOf("validation.timeoutMs");
}

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

// A timed-out command is killed with what it started. `spawnSync` kills the shell
// only: on Windows `cmd.exe` dies and the program it started keeps running,
// holding the directory and its files (a temp dir that cannot be removed, a port
// still bound). The shell is already gone by then, so `taskkill /T` cannot walk
// from it; its children still name it as their parent, and are found that way.
// On POSIX the shell's children outlive it too, reparented: reaching them needs
// the command in its own process group, which would also keep a Ctrl-C from
// reaching them — that trade is story 19-04's (`--detach`, process groups).
//
// Windows never updates a process's parent id and reuses ids, so "names it as
// parent" alone could kill an unrelated orphan whose dead parent once had that
// id. A descendant must therefore have been created after the command started
// and after its own parent. The shell's own children must also have been created
// before `spawnSync` returned (the shell was dead by then: anything newer naming
// its id was started by a later holder of that id, even one that has since
// exited) and before any live process now holding the command's id. Deeper down
// every parent is alive and listed, so its id is its own. Every id is visited
// once, so a reused-id cycle ends.
//
// The two bounds on the shell's children compare two clocks: `Date.now()` and
// the creation time Windows stamps, which advances once per timer tick (15.6 ms
// by default) and is read rounded down. Each reading can lag the true time by up
// to one tick, so a real child can look up to two ticks (~31 ms) older than
// `started`, or younger than `ended`. CLOCK_TOLERANCE_MS widens both bounds by
// 50 ms: two ticks with room for the rounding, and still small next to what
// letting an impostor in takes (the shell dies, its id is handed out again, and
// the new holder starts a process, all inside that 50 ms window, and exits
// before the list is read; a holder still alive is caught by the bound above).
// The selection is therefore bounded, not exact.
//
// The creation time is converted to UTC before it becomes a number. .NET keeps
// the local time's ambiguous-DST flag through that conversion when the value
// came from UTC; whether CIM's DateTime carries it is not verified. A misread
// hour moves a child outside the window, which spares it rather than kills a
// stranger.
//
// A live descendant can start a process between the listing and `taskkill`. So
// the list is read a second time, and what the killed processes started before
// they died (created no later than the kill, plus the tolerance) is killed too.
// A process forking faster than two passes still escapes.
const CLOCK_TOLERANCE_MS = 50;
const LIST_PROCESSES =
  "Get-CimInstance Win32_Process | ForEach-Object { if ($_.CreationDate) { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, ([DateTimeOffset]$_.CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds() } }";

function parseProcessList(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((fields) => fields.length === 3 && fields.every(Number.isFinite))
    .map(([pid, parentPid, created]) => ({ pid, parentPid, created }));
}

// `roots` are dead processes: `{ pid, created, until, self }`. Their children were
// created between `created` and `until` (both widened by the tolerance) and
// before any other process now listed under their id. `self` is the root's own
// creation time when it is known from a listing, so a root that survived its
// kill is not taken for an impostor of itself.
function treeBelow(processes, roots, started) {
  const found = [];
  const seen = new Set(roots.map((root) => root.pid));
  const queue = roots.map((root) => {
    const impostor = processes.find((entry) => entry.pid === root.pid && entry.created !== root.self);
    return {
      pid: root.pid,
      created: root.created - CLOCK_TOLERANCE_MS,
      until: root.until + CLOCK_TOLERANCE_MS,
      before: impostor ? impostor.created : Infinity,
    };
  });
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const entry of processes) {
      const ownChild =
        entry.parentPid === parent.pid &&
        entry.created >= started - CLOCK_TOLERANCE_MS &&
        entry.created >= parent.created &&
        entry.created <= parent.until &&
        entry.created < parent.before;
      if (ownChild && !seen.has(entry.pid)) {
        seen.add(entry.pid);
        found.push(entry.pid);
        queue.push({ pid: entry.pid, created: entry.created, until: Infinity, before: Infinity });
      }
    }
  }
  return found;
}

function descendantsOf(processes, rootPid, started, ended) {
  return treeBelow(processes, [{ pid: rootPid, created: started, until: ended }], started);
}

function killTree(pid, started, ended, platform = process.platform, run = spawnSync) {
  if (platform !== "win32" || !Number.isInteger(pid) || pid <= 0) {
    return [];
  }
  const list = () =>
    parseProcessList(
      run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", LIST_PROCESSES], { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 }).stdout,
    );
  const kill = (pids) => run("taskkill", ["/F", ...pids.flatMap((each) => ["/PID", String(each)])], { stdio: "ignore", windowsHide: true, timeout: 15000 });
  const killed = [];
  try {
    const first = list();
    const pids = descendantsOf(first, pid, started, ended);
    if (pids.length === 0) {
      return killed;
    }
    kill(pids);
    killed.push(...pids);
    const killedAt = Date.now();
    const roots = first
      .filter((entry) => pids.includes(entry.pid))
      .map((entry) => ({ pid: entry.pid, created: entry.created, until: killedAt, self: entry.created }));
    const late = treeBelow(list(), roots, started).filter((each) => !killed.includes(each));
    if (late.length > 0) {
      kill(late);
      killed.push(...late);
    }
    return killed;
  } catch {
    // No PowerShell: the timeout is still reported; the leftovers are not killed.
    return killed;
  }
}

function runValidationCommand(
  command,
  { timeoutMs = commandTimeoutDefault(), env, cwd: runCwd = cwd, keepOutput = false, kill = killTree } = {},
) {
  const maxOutputBytes = outputBufferBytes();
  const started = Date.now();
  const result = spawnSync(command, [], {
    cwd: runCwd,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes,
    ...(env ? { env } : {}),
  });
  // Taken before the kill: the duration is the command's, and the shell was dead
  // by now, which bounds what counts as its child.
  const ended = Date.now();

  const cap = 4000;
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
  const overflowed = Boolean(result.error && result.error.code === "ENOBUFS");
  if (timedOut || overflowed) {
    kill(result.pid, started, ended);
  }
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
    durationMs: ended - started,
    ...detectCacheState(`${result.stdout || ""}\n${result.stderr || ""}`),
    stdoutTail: (result.stdout || "").slice(-cap),
    stderrTail: (result.stderr || "").slice(-cap),
    // Selected from the WHOLE output, which only exists here: by the time anyone
    // reads the evidence file, all that survives is the 4 KB tail above, and a
    // verbose runner pushes the failure out of it long before the end. Recorded
    // only on a failure — a green run has nothing to name, and the evidence
    // ledger is append-only.
    ...(ok ? {} : { failureLines: selectFailureLines(`${result.stdout || ""}\n${result.stderr || ""}`) }),
    // A signal kill has no exit status; the 1 above is a stand-in, not a result.
    ...(result.signal ? { signal: result.signal } : {}),
    // Only for a caller that reads it right away (red-at-base); never written
    // to the evidence, which keeps the tails above.
    ...(keepOutput ? { output: `${result.stdout || ""}\n${result.stderr || ""}` } : {}),
  };
}

// The limit one command runs under, when the project declared one.
function commandTimeout(resolution, command) {
  const timeoutMs = resolution.timeouts && resolution.timeouts[command];

  return timeoutMs ? { timeoutMs } : {};
}

// A security scanner has three outcomes, not two. One that could not run — the
// harness could not observe it, the binary is missing, it timed out, or it could
// not reach its advisory database — found nothing because it looked at nothing:
// that is "not examined", never a pass. Calling it a failure instead would teach
// people to delete the command.
//
// The network test is the one a scanned codebase could game: findings echo the
// flagged source line and advisory titles, so a token anywhere in the output
// would let `err.code === "ENOTFOUND"` on a flagged line turn a red scan into a
// warning. So each pattern is a whole line, anchored at its start, in the shape
// the scanner's own HTTP client prints — npm and pnpm (Node fetch), pip-audit
// (Python requests), govulncheck (Go) — read from the last lines of either
// stream (pnpm prints its failure on stdout, npm on stderr), stack frames
// skipped. An echoed source line starts with its line number, not with these.
const NETWORK_FAILURES = [
  // npm (`npm warn audit request to … failed`), pnpm (` ENOTFOUND  request to …`,
  // `FetchError: request to …`) and a bare Node fetch error.
  /^\s*(?:npm (?:warn|error|ERR!)\s+(?:audit\s+)?|(?:ENOTFOUND|EAI_AGAIN)\s+|FetchError:\s+)?request (?:to \S+ )?failed, reason: getaddrinfo (?:ENOTFOUND|EAI_AGAIN) \S+\s*$/,
  // pip-audit, semgrep: `requests.exceptions.ConnectionError: … NameResolutionError …`
  /^[\w.]*ConnectionError: .*(?:NameResolutionError|Temporary failure in name resolution|Name or service not known|nodename nor servname)/,
  // govulncheck: `govulncheck: fetching vulnerabilities: … dial tcp: lookup vuln.go.dev: no such host`
  /^govulncheck: .*\bdial tcp: lookup \S+.*: (?:no such host|server misbehaving|i\/o timeout)\s*$/,
];
const NETWORK_TAIL_LINES = 5;

function streamEnd(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^\s+at\s/.test(line))
    .slice(-NETWORK_TAIL_LINES);
}

// cmd.exe has no exit 127: a command it cannot find exits 1, prints nothing on
// stdout, and ends stderr with exactly these two lines. Only that, on Windows,
// is a scanner that did not run: a scanner may quote the phrase in a finding,
// and a finding must stay a failure. A localized Windows prints another
// sentence; it does not match and stays a failure (it fails safe).
const CMD_NOT_FOUND = [/^'[^']+' is not recognized as an internal or external command,$/, /^operable program or batch file\.$/];

function cmdNotFound(item, platform) {
  if (platform !== "win32" || item.exitCode !== 1 || String(item.stdoutTail || "").trim() !== "") {
    return false;
  }
  const lines = String(item.stderrTail || "").split(/\r?\n/).filter((line) => line.trim() !== "");
  const last = lines.slice(-CMD_NOT_FOUND.length);

  return last.length === CMD_NOT_FOUND.length && CMD_NOT_FOUND.every((pattern, index) => pattern.test(last[index]));
}

// `platform` is injectable for the tests; it defaults to this process's.
function securityOutcome(item, platform = process.platform) {
  if (item.ok) {
    return { outcome: "pass" };
  }

  const notExamined = (reason) => ({ outcome: "not-examined", notExamined: reason });

  if (item.toolError) {
    return notExamined(item.toolError);
  }

  if (item.timedOut) {
    return notExamined(`timed out after ${Number((item.timeoutMs / 1000).toFixed(1))} s`);
  }

  if (item.exitCode === 127) {
    return notExamined("command not found (exit 127)");
  }

  if (item.exitCode === 126) {
    return notExamined("command found but not executable (exit 126)");
  }

  if (cmdNotFound(item, platform)) {
    return notExamined("command not found (not recognized by cmd.exe)");
  }

  const network = [...streamEnd(item.stdoutTail), ...streamEnd(item.stderrTail)].find((line) =>
    NETWORK_FAILURES.some((pattern) => pattern.test(line)),
  );

  return network ? notExamined(`network unavailable (${network.trim()})`) : { outcome: "fail" };
}

function resultStatus(item) {
  if (item.outcome === "not-examined") {
    return "not examined";
  }

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
  killTree,
  descendantsOf,
  CLOCK_TOLERANCE_MS,
  parseProcessList,
  parseTestsCommands,
  resolveValidationCommands,
  resolveCheckCommands,
  cleanEnvironment,
  isUnattended,
  isProjectScriptInvocation,
  runValidationCommand,
  commandTimeout,
  commandTimeoutDefault,
  securityOutcome,
  resultStatus,
  captureEnvironment,
};
