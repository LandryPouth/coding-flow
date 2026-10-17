"use strict";

// Whether the proof reaches this change: patch coverage against the floor,
// tests weakened in the diff, open acceptance criteria and contrary signals —
// on top of coverage.js, which parses and measures the reports.

const path = require("path");

const { cwd } = require("./context");
const { currentTreeToken } = require("./identity");
const {
  loadCoverageReports,
  reportCandidates,
  packageOfFile,
  measurePatchCoverage,
  coverageTier,
  tierRank,
  resolveCoverageFloor,
} = require("./coverage");
const { readStoryPart, readStoryBundle, extractSection } = require("./story");
const { matchesPattern } = require("./util");
const {
  currentDiffBase,
  isScopedOut,
  changedFilesForCoverage,
  runGitText,
  changedLinesForCoverage,
  parseChangedText,
  deletedFilesInDiff,
} = require("./diff-scope");
const {
  scoreStoryRisk,
  scoreDiffRisk,
  combineRisk,
  scoreCombinedRisk,
} = require("./risk");

// An escape hatch that leaves a mark. Some real changes cannot carry a test (a
// config-only cutover, a vendor bump); refusing them outright would only teach
// people to turn the gate off globally. So the story may declare an exemption —
// and it is copied verbatim into the evidence, printed on the verify, and carried
// into the PR body. The machine cannot judge the reason; it can make sure the
// claim is permanent and visible instead of silent.
function readTestExemption(storyDir) {
  if (!storyDir) {
    return null;
  }

  const bundle = readStoryBundle(storyDir);
  const text = extractSection(Object.values(bundle).join("\n\n"), "Test Exemption");

  return text.trim() ? text.trim() : null;
}

// A story's acceptance criteria are its claims. `verify` proves that the
// commands ran and passed; it has never had anything to say about the claims,
// so a story can go green with every criterion unimplemented. This does not fix
// that — it makes it visible. No gate, no verdict, no new configuration: the
// unticked claims are printed next to the green checkmark, and the reader
// decides.
//
// Deliberately NOT a binding from a criterion to a named test. That binding
// would be written by the same agent that writes the code, so it could only
// ever raise what the tool asserts on the agent's own word. The tool can accept
// a declaration that lowers its claim (`## Test Exemption`); it must not accept
// one that raises it. See docs/design-decisions.md entry 9.
function readAcceptanceCriteria(storyDir) {
  if (!storyDir) {
    return null;
  }

  const section = extractSection(readStoryPart(storyDir, "spec"), "Acceptance Criteria");

  if (!section.trim()) {
    return null;
  }

  const items = [];

  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s*\[([ xX~])\]\s*(.+?)\s*$/);

    if (match) {
      items.push({ state: match[1] === "~" ? "deferred" : match[1] === " " ? "open" : "done", text: match[2] });
    }
  }

  // A criteria section written as prose rather than as a checklist is not a
  // defect to report — there is simply nothing countable in it.
  if (items.length === 0) {
    return null;
  }

  // A criterion is deferred on purpose when its line says `[~]` (the convention
  // `tasks.md` already uses) or when a `## Deferred Criteria` section names it.
  const named = deferredCriteriaNames(storyDir);
  const isDeferred = (item) =>
    item.state === "deferred" ||
    (item.state === "open" && named.some((name) => matchesDeferredName(name, normalizeCriterion(item.text))));

  return {
    total: items.length,
    unchecked: items.filter((item) => item.state !== "done" && !isDeferred(item)).map((item) => item.text),
    deferred: items.filter((item) => item.state !== "done" && isDeferred(item)).map((item) => item.text),
  };
}

// The criterion must appear in the deferred line (or equal it), never the other
// way round: a generic line such as "performance" must not defer every criterion
// that mentions it, and a one-word criterion must not hide inside any line.
function matchesDeferredName(name, criterion) {
  return name === criterion || (criterion.length >= 8 && name.includes(criterion));
}

function normalizeCriterion(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// The lines of a `## Deferred Criteria` section, normalised for matching. Too
// short a line is skipped: "a" would otherwise "name" every criterion.
function deferredCriteriaNames(storyDir) {
  const text = extractSection(Object.values(readStoryBundle(storyDir)).join("\n\n"), "Deferred Criteria");

  return text
    .split(/\r?\n/)
    .map((line) => normalizeCriterion(line.replace(/^\s*[-*]\s*(\[[ xX~]\]\s*)?/, "")))
    .filter((line) => line.length >= 8);
}

// The line-level verdict, or null when it cannot be established — in which case
// the caller keeps the test-file heuristic. Never guesses: a missing report, an
// unparseable one, or one written before this run all mean "no line-level
// answer", not "uncovered".
function evaluatePatchCoverage({ config, behaviorFiles, testFiles = [], startedAt }) {
  // `testFiles` here are the ones that count as proof: strengthened or neutral,
  // never weakened-only (see scanTestWeakening).
  // Freshness is per report: a package whose report predates the run is ignored
  // on its own, and the others still count. A months-old lcov quietly waving a
  // change through is the failure this guards against.
  const report = loadCoverageReports(cwd, {
    candidates: reportCandidates(cwd, config.coverageReports),
    since: startedAt,
  });

  if (!report) {
    return null;
  }

  const changedLines = changedLinesForCoverage();
  const scoped = {};

  for (const file of behaviorFiles) {
    if (changedLines[file]) {
      scoped[file] = changedLines[file];
    }
  }

  if (Object.keys(scoped).length === 0) {
    return null;
  }

  const measured = measurePatchCoverage({
    report,
    changedLinesByFile: scoped,
  });

  // A behaviour file outside every report's package falls back to the test-file
  // rule for ITS package; the run's rung is the weakest of the two parts.
  const unprovenUnmeasured = measured.unmeasured.filter((file) => {
    const pkg = packageOfFile(cwd, file);
    return !testFiles.some((test) => packageOfFile(cwd, test) === pkg);
  });

  // Nothing executable changed and nothing unmeasured (comments, formatting) —
  // no line-level claim to make, so defer to the heuristic rather than report a
  // vacuous 100%.
  if (measured.totalLines === 0 && measured.unmeasured.length === 0) {
    return null;
  }

  const min = Number.isFinite(config.minPatchCoverage) ? config.minPatchCoverage : 80;

  return {
    ...measured,
    min,
    ok: measured.totalLines === 0 ? true : measured.percent >= min,
    unprovenUnmeasured,
    report: {
      path: report.path,
      format: report.format,
      reports: report.reports,
    },
  };
}

// --- Weakened tests -------------------------------------------------------
//
// The `evidence` rung is earned when a behaviour file and a test file both appear
// in the diff. Until now the *direction* of the test change was never read, so the
// cheapest way past the gate was to touch a test — and deleting an assertion,
// adding `.skip`, or removing the file outright all count as touching one. That is
// a hole in the proof, not a missing feature, and an agent does not have to be
// adversarial to fall into it: "the test was failing, so I removed the assertion"
// is an ordinary move.
//
// These are regexes over a diff, not a parse. They cannot tell a weakened test
// from a legitimately refactored one, which is why the result never blocks on its
// own — it only withholds the `evidence` rung from a diff whose test changes are
// *exclusively* weakening, and reports what it saw at every other rung.

// `.only` is deliberately in this list. It does not skip the test it marks; it
// silently skips every other test in the file, which is worse and easier to spot.
const SKIP_MARKERS = [
  /\.skip\s*\(/,
  /\.only\s*\(/,
  /\b(?:xit|xdescribe|xtest|xcontext)\s*\(/,
  /\b(?:it|test|describe)\.todo\s*\(/,
  /@pytest\.mark\.skip/,
  /@unittest\.skip/,
  /#\[ignore\]/,
  /\bt\.Skip(?:Now)?\s*\(/,
  /@(?:Ignore|Disabled)\b/,
];

const ASSERTION_MARKERS = [
  /\bexpect\s*\(/,
  /\bassert(?:_\w+|[A-Z]\w*)?\s*[(.]/,
  /\bshould\b/,
  /\bXCTAssert\w*\s*\(/,
  /\b(?:EXPECT|ASSERT)_\w+\s*\(/,
  /\brequire\.\w+\s*\(/,
  /\bt\.(?:is|deepEqual|throws|truthy|falsy)\s*\(/,
];

const countMatching = (lines, patterns) =>
  lines.filter((line) => patterns.some((pattern) => pattern.test(line))).length;

// Per test file: did this diff make it stronger, weaker, or neither?
function scanTestWeakening(config) {
  const isTest = (file) => config.testGlobs.some((pattern) => matchesPattern(file, pattern));
  const byFile = {};
  const { mergeBase } = currentDiffBase(cwd);
  const diffs = [["diff", "--find-renames"], ["diff", "--find-renames", "--cached"]];

  if (mergeBase) {
    diffs.push(["diff", "--find-renames", mergeBase]);
  }

  for (const argsForGit of diffs) {
    for (const [file, change] of Object.entries(parseChangedText(runGitText(argsForGit)))) {
      if (!isTest(file) || isScopedOut(file, config)) {
        continue;
      }

      if (!byFile[file]) {
        byFile[file] = { added: [], removed: [] };
      }

      byFile[file].added.push(...change.added);
      byFile[file].removed.push(...change.removed);
    }
  }

  const findings = [];

  for (const file of deletedFilesInDiff()) {
    if (isTest(file)) {
      findings.push({ file, signal: "deleted", detail: "the test file was removed" });
      delete byFile[file];
    }
  }

  const strengthened = [];

  for (const [file, change] of Object.entries(byFile)) {
    const skipsAdded = countMatching(change.added, SKIP_MARKERS) - countMatching(change.removed, SKIP_MARKERS);
    const assertionDelta =
      countMatching(change.added, ASSERTION_MARKERS) - countMatching(change.removed, ASSERTION_MARKERS);

    if (skipsAdded > 0) {
      findings.push({
        file,
        signal: "skipped",
        detail: `${skipsAdded} skip/only marker(s) added`,
      });
    }

    if (assertionDelta < 0) {
      findings.push({
        file,
        signal: "assertions-removed",
        detail: `${Math.abs(assertionDelta)} more assertion(s) removed than added`,
      });
    }

    // Neutral counts as strengthened: renaming a test or fixing a typo is not a
    // weakening, and the gate is about direction, not about effort.
    if (skipsAdded <= 0 && assertionDelta >= 0) {
      strengthened.push(file);
    }
  }

  return { findings, strengthened, weakenedFiles: [...new Set(findings.map((f) => f.file))] };
}

// `ctx.riskLevel` is null until the risk is scored: a result returned before that
// point (coverage off, no diff) has no level, so no floor applies to it.
function evaluateCoverageResult({ storyDir, config, exemption = null, startedAt = null }, ctx = { riskLevel: null }) {
  const skip = (reason) => ({ required: false, ok: true, reason, changedFiles: [], testFiles: [] });

  if (!config.requireTestChange) {
    return skip("disabled by harness config (requireTestChange: false)");
  }

  if (!currentTreeToken(cwd)) {
    return skip("not a git repository; the diff cannot be read");
  }

  const changedFiles = changedFilesForCoverage();

  if (changedFiles.length === 0) {
    return skip("no diff visible against the base branch or the working tree");
  }

  // No story is not "no risk". The diff answers on its own, which is what makes
  // this usable on a branch that never adopted the epics/ layout.
  const storyRisk = storyDir
    ? scoreStoryRisk(Object.values(readStoryBundle(storyDir)).join("\n"), config)
    : { level: "low", matchedTerms: [], reason: "no story to read." };
  const risk = combineRisk(storyRisk, scoreDiffRisk(changedFiles, config));
  ctx.riskLevel = risk.level;

  if (risk.level === "low") {
    return skip(`risk is low (${risk.reason})`);
  }

  const testFiles = changedFiles.filter((file) =>
    config.testGlobs.some((pattern) => matchesPattern(file, pattern)),
  );
  const behaviorFiles = changedFiles.filter(
    (file) =>
      !config.nonBehaviorGlobs.some((pattern) => matchesPattern(file, pattern)) &&
      !testFiles.includes(file),
  );

  if (behaviorFiles.length === 0) {
    return {
      required: true,
      ok: true,
      mode: "none",
      reason: "no behavior file changed (docs, story, or lockfile only)",
      changedFiles,
      testFiles,
    };
  }

  // Read once and attach to every outcome below, including the green ones. A
  // measured 92% next to three deleted tests is a fact the reader needs; hiding
  // it because the number was good is the dishonesty the rungs exist to prevent.
  const weakening = scanTestWeakening(config);
  const withWeakening = (result) =>
    weakening.findings.length ? { ...result, weakenedTests: weakening.findings } : result;

  // Line-level proof when the suite produced a coverage report, the test-file
  // heuristic otherwise. The stronger measure always supersedes the weaker one:
  // "a test file moved" is a proxy for "the change is covered", and a proxy is
  // only worth using while the real thing is unavailable.
  const patch = evaluatePatchCoverage({ config, behaviorFiles, testFiles: weakening.strengthened, startedAt });

  if (patch) {
    const unmeasuredNote = patch.unmeasured.length
      ? `${patch.unmeasured.length} file(s) outside every coverage report are unmeasured: ` +
        patch.unmeasured.slice(0, 3).join(", ") +
        (patch.unmeasured.length > 3 ? ` (+${patch.unmeasured.length - 3} more)` : "")
      : "";

    if (patch.ok && patch.unprovenUnmeasured.length === 0) {
      // The weakest part decides the rung: with unmeasured files in the diff the
      // run is `evidence` (a test file moved in their package), never `verified`.
      if (patch.unmeasured.length > 0) {
        return {
          required: true,
          ok: true,
          mode: "test-file",
          reason:
            (patch.totalLines > 0
              ? `${patch.percent}% of the ${patch.totalLines} measured added line(s) are executed; `
              : "") + `${unmeasuredNote}, with a test file changed in their package`,
          riskSource: risk.source,
          changedFiles,
          testFiles,
          patch,
        };
      }

      return {
        required: true,
        ok: true,
        mode: "diff-lines",
        reason: `${patch.percent}% of the ${patch.totalLines} added line(s) are executed by the suite (min ${patch.min}%)`,
        riskSource: risk.source,
        changedFiles,
        testFiles,
        patch,
      };
    }

    const declaredForPatch = readTestExemption(storyDir) || (exemption && exemption.trim() ? exemption.trim() : null);

    if (declaredForPatch) {
      return {
        required: true,
        ok: true,
        mode: "diff-lines",
        reason: "declared test exemption",
        exemption: declaredForPatch,
        riskSource: risk.source,
        changedFiles,
        testFiles,
        patch,
      };
    }

    return {
      required: true,
      ok: false,
      mode: "diff-lines",
      reason: patch.ok
        ? `${unmeasuredNote}, and no test file changed in their package. ` +
          "No report reaches them; a green suite elsewhere proves nothing about them."
        : `only ${patch.percent}% of the ${patch.totalLines} added line(s) are executed by the suite ` +
          `(min ${patch.min}%). The suite ran; it did not reach this change.`,
      riskSource: risk.source,
      riskPaths: risk.matchedPaths,
      changedFiles,
      testFiles,
      behaviorFiles,
      patch,
    };
  }

  // The direction of the test change decides. A diff whose test files were only
  // weakened — assertions dropped, `.skip` added, the file deleted — has not shown
  // that anything covers this change, so it lands exactly where a diff with no test
  // change lands, and reaches the same exemption path. Neutral edits (a rename, a
  // typo) count as strengthening: this reads direction, not effort.
  if (weakening.strengthened.length > 0) {
    return withWeakening({
      required: true,
      ok: true,
      mode: "test-file",
      reason: `${weakening.strengthened.length} test file(s) strengthened alongside ${behaviorFiles.length} behavior file(s)`,
      riskSource: risk.source,
      changedFiles,
      testFiles,
    });
  }

  if (testFiles.length > 0 && weakening.findings.length === 0) {
    return withWeakening({
      required: true,
      ok: true,
      mode: "test-file",
      reason: `${testFiles.length} test file(s) changed alongside ${behaviorFiles.length} behavior file(s)`,
      riskSource: risk.source,
      changedFiles,
      testFiles,
    });
  }

  // Two ways to declare the same thing: a section in the story (the normal path)
  // or `--test-exemption` on the command (the path for work with no story). Both
  // end up recorded verbatim in the evidence — that is the whole point.
  const declared = readTestExemption(storyDir) || (exemption && exemption.trim() ? exemption.trim() : null);

  if (declared) {
    return withWeakening({
      required: true,
      ok: true,
      mode: "test-file",
      reason: "declared test exemption",
      exemption: declared,
      riskSource: risk.source,
      changedFiles,
      testFiles,
      behaviorFiles,
    });
  }

  return withWeakening({
    required: true,
    ok: false,
    mode: "test-file",
    reason: weakening.findings.length
      ? `${behaviorFiles.length} behavior file(s) changed and every test file in the diff was ` +
        "weakened. Touching a test is not the same as covering a change."
      : `${behaviorFiles.length} behavior file(s) changed and no test file did. A green suite ` +
        "that was already green proves nothing about this change.",
    riskSource: risk.source,
    riskPaths: risk.matchedPaths,
    changedFiles,
    testFiles,
    behaviorFiles,
  });
}

// The verdict, plus the name of the rung it landed on. Stamped in one place so
// no return path can forget it, and so `mode` stays what it has always been —
// how the answer was obtained — while `tier` says how strong the answer is.
function evaluateCoverage(options) {
  const ctx = { riskLevel: null };
  const result = evaluateCoverageResult(options, ctx);
  const floored = applyCoverageFloor(result, ctx.riskLevel, options.config);

  // A run held back by its floor keeps the rung it reached; `ok: false` and
  // `floor` say it is not enough.
  return { ...floored, tier: floored.floor ? floored.floor.reached : coverageTier(floored) };
}

// A run can pass its checks and still sit below the rung this project asks of
// its risk level. Only a measured-or-proxy pass is judged: an exemption is a
// written reason and satisfies any floor, and "not-required" never reached the
// bar to begin with. The reached rung is kept; only `ok` and the reason change.
function applyCoverageFloor(result, riskLevel, config) {
  if (!result.required || !result.ok || result.exemption || !riskLevel) {
    return result;
  }

  const reached = coverageTier(result);
  const required = resolveCoverageFloor(config)[riskLevel];

  if (reached === "not-required" || tierRank(reached) >= tierRank(required)) {
    return result;
  }

  return {
    ...result,
    ok: false,
    floor: { required, reached },
    reason:
      `coverage reached '${reached}' but ${riskLevel} risk requires '${required}' ` +
      `(coverageFloor.${riskLevel}). ${result.reason}`,
  };
}

// Executes the declared validation commands for one story and returns the
// evidence. Pure: it runs the commands and captures their results verbatim but
// writes nothing — the caller decides whether to persist it (writeVerifyEvidence)
// and what a red result means for its own flow. Shared by `harness verify` (a
// single story) and `run` (a batch), so both produce identical evidence.
//
// `skipCoverage`: for callers with no single story to attribute the change to
// (`worktree land`'s post-merge re-verify, story: null). The coverage gate reads
// the diff from the default branch to HEAD — for a re-verify run *after* a merge
// onto a long-lived epic branch, that is every story's accumulated diff since
// main, not just the one that was just landed, and `readTestExemption` cannot
// find a story-scoped exemption a landed story already earned. Judging the
// combined result on the commands it actually declares, not on a heuristic
// scoped to the wrong diff, is what "the same source `ai-flow verify` reads"
// (spec.md) means here — coverage stays a per-story concern.
// True when harness.json `freshTestsFor` lists this story's risk level. Risk is
// scored the way the coverage gate scores it: the story text and the diff.
function freshTestsRequired({ storyDir, config }) {
  if (!Array.isArray(config.freshTestsFor) || config.freshTestsFor.length === 0) {
    return false;
  }

  return config.freshTestsFor.includes(scoreCombinedRisk({ storyDir, config }).level);
}

// Signals that contradict a green verdict: tests deleted from the diff, and
// acceptance criteria the story itself still lists as open. Always collected;
// they only change `ok` where the project asked for strictness — `mode: strict`,
// or a high-risk story with `failOnContrarySignals: true`. Elsewhere they are
// warnings, so a project that never opted in sees a different summary line and
// the same verdict.
//
// `assertions-removed` is a warning even when enforced: refactors move
// assertions, and the detector is a regex over a diff.
//
// A written reason lowers the claim and is accepted: a deleted test file is
// excused by a Test Exemption that names it, an open criterion by `[~]` or a
// `## Deferred Criteria` section. Nothing here raises what the tool asserts.
const NO_CONTRARY = Object.freeze({
  enforced: false,
  ok: true,
  failures: Object.freeze([]),
  warnings: Object.freeze({ deletedTests: Object.freeze([]), openCriteria: Object.freeze([]), assertionsRemoved: Object.freeze([]) }),
});

// What the verdict depends on besides the tree: the mode, the flag, and the risk
// inputs that decide whether "high" applies. `.coding-flow/` is outside the tree
// token, so an edit to any of them must change this key to re-run a proof.
function contraryPolicy(config) {
  return {
    strict: config.mode === "strict",
    failOnContrarySignals: config.failOnContrarySignals === true,
    riskTerms: config.highRiskTerms || null,
    riskPaths: config.highRiskPaths || null,
  };
}

// `text` names `target` when it appears as a whole path token: `index.test.ts`
// is not named by `reindex.test.ts`, and `a.test.ts` is not inside `data.test.ts`.
function mentionsPath(text, target) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`(^|[^\\w./-])${escaped}($|[^\\w-]|\\.(?!\\w))`).test(text);
}

function evaluateContrarySignals({ storyDir, config, exemption = null, criteria = null }) {
  const policy = contraryPolicy(config);
  const weakening = currentTreeToken(cwd) ? scanTestWeakening(config) : { findings: [] };
  const declared = [readTestExemption(storyDir), exemption && exemption.trim()].filter(Boolean).join("\n");
  const deletedFiles = weakening.findings.filter((finding) => finding.signal === "deleted").map((finding) => finding.file);
  const excused = (file) => {
    const base = path.posix.basename(file);
    // The full path always counts. A bare file name counts only when no other
    // deleted file shares it, so "index.test.ts" cannot excuse three of them.
    const uniqueBase = deletedFiles.filter((other) => path.posix.basename(other) === base).length === 1;

    return mentionsPath(declared, file) || (uniqueBase && mentionsPath(declared, base));
  };
  const deletedTests = deletedFiles.filter((file) => !excused(file));
  const assertionsRemoved = weakening.findings
    .filter((finding) => finding.signal === "assertions-removed")
    .map((finding) => finding.file);
  const openCriteria = criteria ? criteria.unchecked : [];

  if (deletedTests.length === 0 && openCriteria.length === 0 && assertionsRemoved.length === 0) {
    return NO_CONTRARY;
  }

  const enforced = policy.strict || (policy.failOnContrarySignals && scoreCombinedRisk({ storyDir, config }).level === "high");
  const failures = [];

  if (enforced && deletedTests.length > 0) {
    failures.push({
      signal: "deleted-tests",
      detail: `${deletedTests.length} test file(s) deleted, and no Test Exemption names them: ${deletedTests.slice(0, 5).join(", ")}`,
      items: deletedTests,
    });
  }

  if (enforced && openCriteria.length > 0) {
    failures.push({
      signal: "open-criteria",
      detail:
        `${openCriteria.length} acceptance criterion(a) still open: ${openCriteria.slice(0, 5).join("; ")}` +
        `${openCriteria.length > 5 ? "; …" : ""}. Mark each [x], defer it with [~] or a '## Deferred Criteria' section`,
      items: openCriteria,
    });
  }

  return { enforced, ok: failures.length === 0, failures, warnings: { deletedTests, openCriteria, assertionsRemoved } };
}

module.exports = {
  readTestExemption,
  readAcceptanceCriteria,
  matchesDeferredName,
  normalizeCriterion,
  deferredCriteriaNames,
  evaluatePatchCoverage,
  SKIP_MARKERS,
  ASSERTION_MARKERS,
  countMatching,
  scanTestWeakening,
  evaluateCoverageResult,
  evaluateCoverage,
  applyCoverageFloor,
  freshTestsRequired,
  NO_CONTRARY,
  contraryPolicy,
  mentionsPath,
  evaluateContrarySignals,
};
