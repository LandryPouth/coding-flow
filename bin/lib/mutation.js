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
// evidence verbatim. A probe that cannot run is "not examined", never a pass.

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
const LIMITS =
  "heuristic: strings, templates and comments are skipped by a line scanner; equivalent mutants exist and only a human " +
  "can tell them; a mutant that does not compile, times out or is not applied is counted apart, never as killed; " +
  "the mutants run on the committed HEAD, not on uncommitted edits.";

// `harness.json` `mutation: { command, maxMutants, link }`; null when absent.
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
  };
}

// `file:line` as a whole token: `limit.js:2` is not named by `limit.js:20`.
function names(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`(^|[^\\w./-])${escaped}(?![\\w])`).test(text);
}

// The test files `{files}` receives. The probe takes the ones the diff touched;
// a diff that touched none — a refactor claim, by definition — is guarded by
// the tests already there, so every committed file matching `testGlobs` is named.
function testsFor(base, config) {
  const listed = (args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
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
    const child = spawnSync(process.execPath, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const report = fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, "utf8")) : null;
    const said = String(child.stderr || "").trim().split(/\r?\n/).pop();

    return report || { error: said || `the probe exited with ${child.status === null ? child.signal : child.status}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// What the probe found, judged: survivors not named by the exemption decide `ok`.
function judge(report, { enforced, storyDir, started }) {
  const exemption = storyDir ? extractSection(Object.values(readStoryBundle(storyDir)).join("\n\n"), "Mutation Exemption").trim() : "";
  const count = (status) => report.mutants.filter((mutant) => mutant.status === status).length;
  const survived = report.mutants
    .filter((mutant) => mutant.status === "survived")
    .map(({ file, line, operator }) => ({ file, line, operator }));
  const unexcused = survived.map(({ file, line }) => `${file}:${line}`).filter((key) => !(exemption && names(exemption, key)));

  return {
    ran: true,
    enforced,
    ok: !enforced || unexcused.length === 0,
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

// Null when the project did not opt in. Otherwise the probe's verdict, or why
// it did not run: not triggered (not high risk, no refactor claim) is a quiet
// skip; triggered but unable to run is "not examined", a failure when enforced.
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
  const why = settings.invalid || (!base ? "no merge base to take the diff's sites from" : null);
  const started = Date.now();
  const report = why ? { error: why } : runProbe(settings, base, currentTreeToken(cwd) || base, config);

  if (report.error) {
    return { ran: false, enforced, ok: !enforced, reason: `not examined — ${report.error}`, durationMs: Date.now() - started };
  }

  return judge(report, { enforced, storyDir, started });
}

module.exports = { evaluateMutation, mutationSettings };
