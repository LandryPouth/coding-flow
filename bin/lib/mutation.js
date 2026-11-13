"use strict";

// Story 15-05: the mutation probe of story 15-04, opt-in and on high-risk diffs
// only. `verify` runs `scripts/mutation-probe.js` as a child process — its
// throwaway worktree, process groups, signal handling and leftover sweep were
// hardened over five reviews, and a second copy of them would drift — on the
// diff's own range (merge base..HEAD), seeded by the tree token so the same
// tree samples the same sites.
//
// Survivors are a contrary signal: listed every time, and they lower the
// verdict to NOT PROVEN only where the project asked for strictness, as the
// other contrary signals do. A `## Mutation Exemption` naming `file:line`
// excuses a survivor (an equivalent mutant is a human call) and is kept in the
// evidence verbatim. A probe that cannot run, that decided no mutant, or that
// would have mutated something other than the tree under proof is "not
// examined", never a pass.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const { cwd } = require("./context");
const { matchesPattern } = require("./util");
const { currentDiffBase } = require("./diff-scope");
const { currentTreeToken } = require("./identity");
const { readStoryBundle, extractSection } = require("./story");
const { scoreCombinedRisk } = require("./risk");
const { resolveClaim } = require("./claim");

const PROBE = path.join(__dirname, "..", "..", "scripts", "mutation-probe.js");
const DEFAULT_MAX_MUTANTS = 20;
// The whole probe, baseline included. Past it the probe is stopped (it cleans
// up on SIGTERM) and what it had not decided is not examined.
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const LIMITS =
  "heuristic, JS/TS only: strings, templates and comments are skipped by a line scanner; equivalent mutants exist and " +
  "only a human can tell them; a mutant that does not compile, times out or is not applied is counted apart, never as " +
  "killed; the mutants run on the committed HEAD; the throwaway worktree shares the repository's refs, stash and git config.";

// `harness.json` `mutation: { command, maxMutants, link, timeoutMs }`; null when absent.
function mutationSettings(config) {
  const settings = config.mutation;

  if (settings === undefined || settings === null) {
    return null;
  }

  if (typeof settings !== "object" || Array.isArray(settings) || typeof settings.command !== "string" || !settings.command.trim()) {
    return { invalid: "mutation.command is not set in .coding-flow/harness.json" };
  }

  return {
    command: settings.command,
    max: Number.isInteger(settings.maxMutants) && settings.maxMutants > 0 ? settings.maxMutants : DEFAULT_MAX_MUTANTS,
    link: Array.isArray(settings.link) ? settings.link.filter((entry) => typeof entry === "string" && entry) : [],
    timeoutMs: Number.isInteger(settings.timeoutMs) && settings.timeoutMs > 0 ? settings.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

// `file:line` as a whole token: `limit.js:2` is not named by `limit.js:20`.
function names(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`(^|[^\\w./-])${escaped}(?![\\w])`).test(text);
}

// The exemption as written, without HTML comments (an unclosed one runs to the
// end): a commented-out line is a template, not a reason.
function readExemption(storyDir) {
  if (!storyDir) {
    return "";
  }

  // Before the section is cut out: a commented-out heading is no section.
  const text = Object.values(readStoryBundle(storyDir)).join("\n\n").replace(/<!--[\s\S]*?(?:-->|$)/g, "");

  return extractSection(text, "Mutation Exemption").trim();
}

function git(args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Tracked files whose working copy differs from HEAD: the mutants run on HEAD,
// so with any of them edited — code, `package.json`, a tsconfig, a fixture —
// the verdict would be about other code. Prose and Coding Flow's own files do
// not change behaviour; an untracked file is not in HEAD, nor in the run.
const NOT_BEHAVIOUR = /(?:^|\/)[^/]*\.md$|^(?:\.coding-flow|epics|specs|\.specify)\//;

function uncommittedChanges() {
  return git(["status", "--porcelain=v1", "-z", "--untracked-files=no"])
    .split("\0")
    .filter((entry) => /^.. /.test(entry))
    .map((entry) => entry.slice(3))
    .filter((file) => !NOT_BEHAVIOUR.test(file));
}

// The test files `{files}` receives. The probe takes the ones the diff touched;
// a diff that touched none — a refactor claim, by definition — is guarded by
// the tests already there, so every committed file matching `testGlobs` is named.
function testsFor(base, config) {
  const listed = (args) => git(args).split("\0").filter(Boolean);
  const isTest = (file) => config.testGlobs.some((pattern) => matchesPattern(file, pattern));

  if (listed(["diff", "--name-only", "-z", "--no-renames", base, "HEAD"]).some(isTest)) {
    return [];
  }

  return listed(["ls-tree", "-r", "-z", "--full-tree", "--name-only", "HEAD"]).filter(isTest);
}

function runProbe(settings, base, seed, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-flow-mutation-"));
  const json = path.join(dir, "report.json");
  const args = [PROBE, "--repo", cwd, "--base", base, "--head", "HEAD", "--command", settings.command,
    "--max", String(settings.max), "--seed", seed, "--json", json, ...settings.link.flatMap((link) => ["--link", link]),
    ...testsFor(base, config).flatMap((file) => ["--tests", file])];

  try {
    // SIGTERM on the budget: the probe stops its command's group, removes its
    // worktree and writes what it decided before exiting.
    const child = spawnSync(process.execPath, args, {
      cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: settings.timeoutMs, killSignal: "SIGTERM",
    });
    const report = fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, "utf8")) : null;
    const said = String(child.stderr || "").trim().split(/\r?\n/).pop();
    const outOfTime = Boolean(child.error && child.error.code === "ETIMEDOUT");

    if (outOfTime) {
      const decided = report ? report.mutants.length : 0;
      return { error: `the budget of ${settings.timeoutMs / 1000}s (mutation.timeoutMs) ran out after ${decided} mutant(s)` };
    }

    return report || { error: said || `the probe exited with ${child.status === null ? child.signal : child.status}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// What the probe found, judged: survivors not named by the exemption decide `ok`.
function judge(report, { enforced, storyDir, started, head }) {
  const exemption = readExemption(storyDir);
  const count = (status) => report.mutants.filter((mutant) => mutant.status === status).length;
  const survived = report.mutants
    .filter((mutant) => mutant.status === "survived")
    .map(({ file, line, operator }) => ({ file, line, operator }));
  const unexcused = survived.map(({ file, line }) => `${file}:${line}`).filter((key) => !(exemption && names(exemption, key)));

  return {
    ran: true,
    enforced,
    ok: !enforced || unexcused.length === 0,
    head,
    seed: report.seed,
    killed: count("killed"),
    survived,
    unexcused,
    apart: { timeout: count("timeout"), compile: count("compile"), notApplied: count("not applied"), error: count("error") },
    durationMs: Date.now() - started,
    mutants: report.mutants.map(({ file, line, operator, status }) => ({ file, line, operator, status })),
    ...(exemption && survived.length > 0 ? { exemption } : {}),
    limits: LIMITS,
  };
}

// Why the probe's answer would not be about the tree under proof, or null.
function notExaminedBecause(settings, base) {
  if (settings.invalid) {
    return settings.invalid;
  }

  if (!base) {
    return "no merge base to take the diff's sites from";
  }

  const dirty = uncommittedChanges();

  return dirty.length > 0
    ? `uncommitted changes in ${dirty.slice(0, 3).join(", ")}${dirty.length > 3 ? ", …" : ""}: the mutants run on HEAD, commit first`
    : null;
}

// Null when the project did not opt in. Otherwise the probe's verdict, or why
// it did not run: not triggered (not high risk, no refactor claim) is a quiet
// skip; triggered but unable to answer is "not examined", a failure when enforced.
function evaluateMutation({ storyDir, config, claim = null }) {
  const settings = mutationSettings(config);

  if (!settings) {
    return null;
  }

  const risk = scoreCombinedRisk({ storyDir, config }).level;
  const kind = (resolveClaim({ storyDir, flagClaim: claim }) || {}).kind;
  const enforced = config.mode === "strict" || (config.failOnContrarySignals === true && risk === "high");

  if (risk !== "high" && kind !== "refactor") {
    return { ran: false, skipped: true, ok: true, reason: `risk is ${risk} and no refactor claim` };
  }

  const base = currentDiffBase(cwd).mergeBase;
  const why = notExaminedBecause(settings, base);
  const started = Date.now();
  const report = why ? { error: why } : runProbe(settings, base, currentTreeToken(cwd) || base, config);
  const decided = report.error ? 0 : report.mutants.filter((m) => m.status === "killed" || m.status === "survived").length;
  const reason = report.error ||
    (decided === 0 ? (report.mutants.length === 0 ? "no site in the diff's committed JS/TS lines" : "no mutant was decided (all timed out, did not compile, did not start or were not applied)") : null);

  if (reason) {
    return { ran: false, enforced, ok: !enforced, reason: `not examined — ${reason}`, durationMs: Date.now() - started };
  }

  return judge(report, { enforced, storyDir, started, head: git(["rev-parse", "HEAD"]).trim() });
}

// One line for the PR body and the run summary; null when nothing ran.
function describeMutation(mutation) {
  if (!mutation || mutation.skipped) {
    return null;
  }

  if (!mutation.ran) {
    return `${mutation.ok ? "⚠️" : "❌"} ${mutation.reason}`;
  }

  const listed = mutation.unexcused.slice(0, 5).join(", ");

  return mutation.unexcused.length > 0
    ? `${mutation.ok ? "⚠️" : "❌"} ${mutation.killed} killed, ${mutation.unexcused.length} survived: ${listed}${mutation.unexcused.length > 5 ? ", …" : ""}`
    : `✅ ${mutation.killed} killed, none survived unexcused`;
}

module.exports = { evaluateMutation, mutationSettings, describeMutation };
