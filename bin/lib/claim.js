"use strict";

// A declared claim narrows what a green verify is allowed to mean. So far there
// is one: `refactor` says behavior did not move. That is a different assertion
// from `fix`, which is proven by a test red at base, so it is checked rather
// than trusted — unchanged tests, no weakening, green commands, and the moved
// lines executed by a fresh coverage report.

const path = require("path");

const { cwd } = require("./context");
const { currentTreeToken } = require("./identity");
const { readStoryBundle, extractSection, storyPartPath } = require("./story");
const { defaultPolicyGlobs } = require("./harness-config");
const { parseTestsCommands } = require("./validation-run");
const { matchesPattern, normalizePortable } = require("./util");
const { readPolicyChanged } = require("./policy-drift");
const {
  classifyChangedFiles,
  scanTestWeakening,
  countSkipMarkers,
} = require("./coverage-gate");
const {
  loadCoverageReports,
  reportCandidates,
  measurePatchCoverage,
  coveredExtensions,
} = require("./coverage");
const {
  currentDiffBase,
  runGitList,
  changedLinesForCoverage,
  renamedFilesInDiff,
  isScopedOut,
  diffBaseFlag,
} = require("./diff-scope");
const { resolveDiffBase } = require("./diff-base");

const CLAIMS = new Set(["refactor"]);

// The excluded files a refactor may still touch: prose about the change, and
// type declarations erased before anything runs. Any other excluded file —
// build or test-runner config, a lockfile, generated output, a `.sql` — can
// change what runs or which tests run without a line of covered code moving,
// so a refactor that touches one is not shown to be one.
// Prose is matched by extension, not by directory: a `docs/conf.py` or a
// committed `coverage/lcov.info` is not prose.
// Files that decide which tests run, beyond the default policy globs: a
// `.mocharc.js` or `karma.conf.js` dropping a spec, a `conftest.py` with
// `collect_ignore`, a setup file stubbing a module. A code extension does not make
// them code: under the claim they are the bar.
const TEST_RUNNER_GLOBS = [
  "**/.mocharc*",
  "**/karma.conf.*",
  "**/conftest.py",
  "**/setupTests.*",
  "**/jest.setup.*",
  "**/vitest.setup.*",
  "**/playwright.config.*",
  "**/cypress.config.*",
];

const REFACTOR_PROSE_GLOBS = ["**/*.md", "**/*.mdx", "**/*.txt", "**/*.d.ts", ".gitignore"];

// The claim the story declares, either as an inline heading (`## Claim: refactor`)
// or as a section whose first line opens with the kind. A `## Claim` section
// that opens with prose ("We claim that…") declares nothing, rather than a claim
// named after its first word. A story without one declares nothing; the flag is
// the story-less path.
function readClaim(storyDir) {
  if (!storyDir) {
    return null;
  }

  const text = Object.values(readStoryBundle(storyDir)).join("\n\n");
  const inline = text.match(/^#{2,6}\s+Claim\s*:\s*([a-z-]+)\b/im);

  if (inline) {
    return inline[1].toLowerCase();
  }

  const firstLine = extractSection(text, "Claim").trim().split(/\r?\n/)[0].trim();
  const firstWord = firstLine.replace(/`/g, "").split(/[\s(—:.,]/)[0].toLowerCase();

  if (CLAIMS.has(firstWord)) {
    return firstWord;
  }

  // Not a known kind: a line that is a single word is a claim to refuse (a typo
  // must not drop it), a sentence is prose.
  const single = firstLine.match(/^`?([a-z-]+)`?\s*(?:\(.*\))?\.?$/i);

  return single ? single[1].toLowerCase() : null;
}

function resolveClaim({ storyDir, flagClaim = null }) {
  const declared = readClaim(storyDir);
  const kind = String(flagClaim || declared || "").trim().toLowerCase();

  return kind ? { kind, source: flagClaim ? "flag" : "story" } : null;
}

// Git answers diff paths from the repository root and untracked paths from the
// working directory. In a subdirectory install the two differ by the prefix, so
// every path the claim compares is brought to the project's frame first.
function gitPrefix() {
  const [prefix = ""] = runGitList(["rev-parse", "--show-prefix"]);
  return normalizePortable(prefix);
}

function toProjectFrame(files, prefix) {
  return [...new Set(files.map((file) => (prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file)))];
}

// A file is "existing" when the diff base (or HEAD, with no base to compare
// against) already tracked it. A test added on this branch is new even if it was
// committed earlier and edited again: the claim is about the tests that held the
// behavior before the refactor. `<rev>:./path` resolves from the working
// directory, the frame `toProjectFrame` produced.
function existedAt(base, file) {
  try {
    require("child_process").execFileSync("git", ["cat-file", "-e", `${base}:./${file}`], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

// The file names a coverage report is read from, globs reduced to their last
// literal segment: `packages/*/coverage/lcov.info` is still `lcov.info`.
function reportFileNames(config) {
  return [...new Set(reportCandidates(cwd, config.coverageReports)
    .map((candidate) => path.posix.basename(normalizePortable(candidate)))
    .filter((name) => name && !/[*?[\]{}]/.test(name)))];
}

function listFiles(files, max = 3) {
  return files.slice(0, max).join(", ") + (files.length > max ? ` (+${files.length - max} more)` : "");
}

// The moved lines must be executed by a report this run produced. A report that
// predates the run is ignored by `since`, and its absence is not a fallback to
// "a test file moved" — a refactor cannot be shown to be exercised at all.
function evaluateRefactorCoverage({ config, behaviorFiles, startedAt }) {
  if (behaviorFiles.length === 0) {
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
    return {
      ok: false,
      reason: `no added line in ${listFiles(behaviorFiles)} is measurable; ` +
        "a refactor cannot be shown to be exercised",
      files: behaviorFiles,
    };
  }

  const report = loadCoverageReports(cwd, {
    candidates: reportCandidates(cwd, config.coverageReports),
    since: startedAt,
  });

  if (!report) {
    return {
      ok: false,
      reason: "a refactor cannot be shown to be exercised without a coverage report",
      files: behaviorFiles,
    };
  }

  // A file of a kind the report never measures fails whether lines were added to
  // it or only removed: deleting a `posttest` script or a Makefile recipe line
  // drops a suite as surely as adding an ignore pattern does.
  const known = coveredExtensions(report);
  const foreign = behaviorFiles.filter((file) => !scoped[file] && !known.has(path.extname(file)));

  if (foreign.length > 0) {
    return {
      ok: false,
      reason: `${foreign.length} changed file(s) are of a kind no coverage report measures ` +
        `(configuration, scripts, data): ${listFiles(foreign)}; split them into their own change`,
      files: foreign,
    };
  }

  return judgePatch(measurePatchCoverage({ report, changedLinesByFile: scoped }), { config, report, scoped, behaviorFiles });
}

// What a measured patch says about the claim: every changed file measurable, the
// added lines measured, and enough of them executed.
function judgePatch(measured, { config, report, scoped, behaviorFiles }) {
  const min = Number.isFinite(config.minPatchCoverage) ? config.minPatchCoverage : 80;
  const unmeasured = measured.unmeasured;
  const uncovered = measured.uncovered.map((entry) => entry.file);
  const files = [...new Set([...unmeasured, ...uncovered])];

  // A file of a kind the report never measures — `package.json` (a `jest` key,
  // `scripts.test`), `.mocharc.yml`, `pytest.ini`, a template — is skipped by the
  // coverage gate. Under a refactor claim nothing may move unmeasured.
  if (measured.skippedFiles.length > 0) {
    return {
      ok: false,
      reason: `${measured.skippedFiles.length} changed file(s) are of a kind no coverage report measures ` +
        `(configuration, data, templates): ${listFiles(measured.skippedFiles)}; split them into their own change`,
      files: measured.skippedFiles,
      patch: { ...measured, min, report: pickReport(report) },
    };
  }

  // A code file the report knows the language of but never loaded: no test ran
  // it at all. Diluted into the percentage it hides under the tolerance; under
  // the claim it fails on its own.
  const notLoaded = measured.uncovered.filter((entry) => entry.absentFromReport).map((entry) => entry.file);

  if (notLoaded.length > 0) {
    return {
      ok: false,
      reason: `${notLoaded.length} changed file(s) were not loaded by any test: ${listFiles(notLoaded)}`,
      files: notLoaded,
      patch: { ...measured, min, report: pickReport(report) },
    };
  }

  if (unmeasured.length > 0) {
    return {
      ok: false,
      reason: `${unmeasured.length} file(s) lie outside every coverage report: ${listFiles(unmeasured)}`,
      files: unmeasured,
      patch: { ...measured, min, report: pickReport(report) },
    };
  }

  if (measured.totalLines === 0) {
    const added = Object.values(scoped).reduce((sum, lines) => sum + lines.length, 0);

    return {
      ok: false,
      reason: `the coverage report measured none of the ${added} added line(s) in ` +
        listFiles(behaviorFiles),
      files: behaviorFiles,
      patch: { ...measured, min, report: pickReport(report) },
    };
  }

  if (measured.percent < min) {
    return {
      ok: false,
      reason: `only ${measured.percent}% of the ${measured.totalLines} added line(s) are executed ` +
        `(min ${min}%) in ${listFiles(files.length > 0 ? files : behaviorFiles)}`,
      files: files.length > 0 ? files : behaviorFiles,
      patch: { ...measured, min, report: pickReport(report) },
    };
  }

  return {
    ok: true,
    files: [],
    patch: { ...measured, min, report: pickReport(report) },
  };
}

function pickReport(report) {
  return { path: report.path, format: report.format, reports: report.reports };
}

// The tests that held the behavior: tracked at the base, still there, untouched.
// Read from git rather than the disk, so an untracked `vendor/` or `.venv/` full
// of test files never stands in for the project's own suite.
function unchangedTestFiles(config, base, changedTests) {
  const changed = new Set(changedTests);

  return runGitList(["ls-tree", "-r", "--name-only", base])
    .map(normalizePortable)
    .filter((file) => !isScopedOut(file, config))
    .filter((file) => config.testGlobs.some((pattern) => matchesPattern(file, pattern)))
    .filter((file) => !changed.has(file)).length;
}

// The base the claim diffs from must be shared: on another branch too, not a
// commit of this one. `--base HEAD~1` or a `codingFlowBase` set past a test edit
// would otherwise drop that edit from the diff the claim reads.
//
// A `--base` or a recorded fork point may widen the diff, never narrow it: a base
// strictly after the one the branch would use without either drops this branch's
// earlier commits, whatever ref happens to hold it (an upstream pushed at that
// point, a backup branch). The fork point is a local git setting, outside the
// diff, so it is held to the same rule as the flag.
function narrowedBase(diffBase, story) {
  if (!diffBaseFlag() && diffBase.source !== "fork-point") {
    return null;
  }

  let wider = null;
  try {
    wider = resolveDiffBase(cwd, { story, flagBase: null, ignoreForkPoint: true });
  } catch {
    return null;
  }

  if (!wider.mergeBase || wider.mergeBase === diffBase.mergeBase) {
    return null;
  }

  try {
    require("child_process").execFileSync("git", ["merge-base", "--is-ancestor", wider.mergeBase, diffBase.mergeBase], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return wider;
  } catch {
    return null;
  }
}

function baseFailures(diffBase, story) {
  const { mergeBase } = diffBase;

  if (!mergeBase) {
    return [{
      signal: "no-base",
      detail: "a refactor claim needs a diff base to see what changed, and none was found; " +
        "run it on a branch started from the base, or pass --base <branch>",
      files: [],
    }];
  }

  // A ref holding one of this branch's own commits is this branch under another
  // name — its upstream once pushed, a copy — and holds the base trivially.
  const [ownFirst] = runGitList(["rev-list", "--reverse", `${mergeBase}..HEAD`]);
  const own = new Set(ownFirst
    ? runGitList(["for-each-ref", "--contains", ownFirst, "--format=%(refname)", "refs/heads", "refs/remotes"])
    : []);
  const [current = ""] = runGitList(["symbolic-ref", "-q", "HEAD"]);
  const holders = runGitList(["for-each-ref", "--contains", mergeBase, "--format=%(refname)", "refs/heads", "refs/remotes"])
    .filter((ref) => ref !== current && !own.has(ref));

  const wider = narrowedBase(diffBase, story);

  if (wider) {
    const how = diffBaseFlag() ? "--base" : `the recorded fork point (${diffBase.ref})`;

    return [{
      signal: "base-not-shared",
      detail: `${how} narrows the diff past ${mergeBase.slice(0, 12)}: earlier commits of this branch are left ` +
        `out of the claim; diff from the branch it started from (--base ${wider.ref})`,
      files: [],
    }];
  }

  return holders.length > 0
    ? []
    : [{
      signal: "base-not-shared",
      detail: `the diff base ${mergeBase.slice(0, 12)} is on no branch but this one, so earlier commits of this ` +
        "branch are left out of the claim; diff from the branch it started from",
      files: [],
    }];
}

// The tests this branch adds, tracked or not. The claim allows them, so they are
// read for the two ways a new test can hollow out the old ones: a skip marker
// (the diff scan never sees an untracked file) and the coverage report's name.
function scanNewTests({ config, base, prefix, changedFiles, isTest }) {
  const untracked = runGitList(["ls-files", "--others", "--exclude-standard"])
    .map(normalizePortable)
    .filter((file) => isTest(file) && !isScopedOut(file, config));
  const newTests = [...new Set([
    ...toProjectFrame(changedFiles, prefix).filter((file) => isTest(file) && !existedAt(base, file)),
    ...untracked,
  ])];
  const skipped = [];
  const reportNames = reportFileNames(config);
  const writesReport = [];

  for (const file of newTests) {
    let content = "";
    try {
      content = require("fs").readFileSync(path.join(cwd, file), "utf8");
    } catch {
      continue;
    }

    // The scan reads `git diff`, which never shows an untracked file — and a new
    // test file is exactly what the claim allows. A root-level `.only` in one
    // skips every existing test in a shared-process runner.
    const skips = untracked.includes(file) ? countSkipMarkers(content.split(/\r?\n/)) : 0;
    if (skips > 0) {
      skipped.push({ file, signal: "skipped", detail: `${skips} skip/only marker(s) in a new test file` });
    }

    if (reportNames.some((name) => content.includes(name))) {
      writesReport.push(file);
    }
  }

  return { skipped, writesReport };
}

function testIntegrityFailures(config, mergeBase, prefix, changedFiles) {
  const failures = [];

  const isTest = (file) => config.testGlobs.some((pattern) => matchesPattern(file, pattern));
  const base = mergeBase || "HEAD";
  const changedExistingTests = toProjectFrame(changedFiles, prefix).filter(
    (file) => isTest(file) && existedAt(base, file),
  );
  const renamedExistingTests = renamedFilesInDiff()
    .map((pair) => ({ from: toProjectFrame([pair.from], prefix)[0], to: toProjectFrame([pair.to], prefix)[0] }))
    .filter((pair) => isTest(pair.from));

  if (changedExistingTests.length > 0) {
    failures.push({
      signal: "test-changed",
      detail: `${changedExistingTests.length} existing test file(s) changed: ${listFiles(changedExistingTests)}`,
      files: changedExistingTests,
    });
  }

  if (renamedExistingTests.length > 0) {
    failures.push({
      signal: "test-renamed",
      detail: `${renamedExistingTests.length} existing test file(s) renamed: ` +
        listFiles(renamedExistingTests.map((pair) => `${pair.from} → ${pair.to}`)),
      files: renamedExistingTests.map((pair) => pair.to),
    });
  }

  const weakening = scanTestWeakening(config);
  const { skipped, writesReport } = scanNewTests({ config, base, prefix, changedFiles, isTest });
  weakening.findings.push(...skipped);

  // The report is the claim's only witness that the moved lines ran. A new test
  // naming it can write it, so it is read as a test that may forge the witness.
  // A name scan, not a proof: it catches the plain case, not an obfuscated one.
  if (writesReport.length > 0) {
    failures.push({
      signal: "test-names-report",
      detail: `${writesReport.length} new test file(s) name the coverage report the claim reads: ` +
        `${listFiles(writesReport)}; land them on their own change first`,
      files: writesReport,
    });
  }

  if (weakening.findings.length > 0) {
    failures.push({
      signal: "weakened-test",
      detail: `${weakening.findings.length} weakening signal(s): ` +
        listFiles(weakening.findings.map((finding) => `${finding.file} (${finding.detail})`)),
      files: [...new Set(weakening.findings.map((finding) => finding.file))],
    });
  }

  return failures;
}

// A refactor changes code and nothing else. Loosening the bar — `ignoredPaths`,
// `testGlobs`, `minPatchCoverage`, a test-runner config that skips a file — hides
// a test as surely as editing it, and in standard mode a policy change is only a
// warning. Under the claim it fails, and no `## Policy Change` clears it: the
// policy change goes in its own change, as a test change does.
function scopeFailures(config, { behaviorFiles, excluded }) {
  const failures = [];
  // The defaults always apply: `policyGlobs: []` written in the same diff would
  // otherwise switch this check off from inside the change it checks.
  const policyGlobs = [...new Set([...defaultPolicyGlobs(), ...TEST_RUNNER_GLOBS, ...(config.policyGlobs || [])])];
  const policy = readPolicyChanged({ ...config, policyGlobs });

  if (policy.length > 0) {
    failures.push({
      signal: "policy-changed",
      detail: `the bar moved in the same change: ${listFiles(policy)}; a refactor leaves the policy alone, split it`,
      files: policy,
    });
  }

  const notProse = excluded.filter(
    (file) => !REFACTOR_PROSE_GLOBS.some((pattern) => matchesPattern(file, pattern)) && !policy.includes(file),
  );

  if (notProse.length > 0) {
    failures.push({
      signal: "not-code",
      detail: `${notProse.length} changed file(s) are configuration, generated output or data, which no ` +
        `coverage report can show unchanged: ${listFiles(notProse)}; split them into their own change`,
      files: notProse,
    });
  }

  if (behaviorFiles.length === 0) {
    failures.push({
      signal: "no-code",
      detail: "no code file changed, so there is nothing for a refactor claim to prove",
      files: [],
    });
  }

  return failures;
}

// Commands written in the story's plan are as editable as the code: dropping a
// test from `## Commands` skips it without touching it. Every command the plan
// listed at the base must still run, wherever the commands come from now —
// deleting the `## Commands` section falls back to `package.json`, which must not
// be a way out. Run from the plan, a plan with no command at the base gives the
// claim nothing to hold the run to. Config- and package.json-sourced commands are
// otherwise covered by the policy and unmeasured-file rules.
function commandFailures({ storyDir, commandSource, commands, mergeBase }) {
  if (!storyDir || !mergeBase) {
    return [];
  }

  const planPath = normalizePortable(path.relative(cwd, storyPartPath(storyDir, "plan")));
  let baseCommands = [];
  try {
    const text = require("child_process").execFileSync("git", ["show", `${mergeBase}:./${planPath}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    baseCommands = parseTestsCommands(text);
  } catch {
    baseCommands = [];
  }

  if (baseCommands.length === 0 && commandSource !== "plan.md") {
    return [];
  }

  if (baseCommands.length === 0) {
    return [{
      signal: "commands-changed",
      detail: `${planPath} lists no command at the base, so nothing says which tests held the behavior; ` +
        "commit the plan's commands before the refactor, or declare them in .coding-flow/config.json",
      files: [planPath],
    }];
  }

  const current = new Set(commands || []);
  const dropped = baseCommands.filter((command) => !current.has(command));

  return dropped.length === 0
    ? []
    : [{
      signal: "commands-changed",
      detail: `${dropped.length} command(s) the plan ran at the base no longer run: ${listFiles(dropped)}`,
      files: [planPath],
    }];
}

function evaluateRefactor({ config, storyDir = null, commandSource = null, commands = [], commandsOk = true, startedAt = null }) {
  if (!currentTreeToken(cwd)) {
    return {
      kind: "refactor",
      ok: false,
      failures: [{
        signal: "no-git",
        detail: "a refactor claim is read from the diff, and this is not a git repository",
        files: [],
      }],
    };
  }

  const { changedFiles, behaviorFiles, excluded } = classifyChangedFiles(config);
  const diffBase = currentDiffBase(cwd);
  const { mergeBase } = diffBase;
  const prefix = gitPrefix();
  const story = storyDir ? normalizePortable(path.relative(cwd, storyDir)) : null;
  const failures = [
    ...baseFailures(diffBase, story),
    ...testIntegrityFailures(config, mergeBase, prefix, changedFiles),
    ...scopeFailures(config, { behaviorFiles, excluded }),
    ...commandFailures({ storyDir, commandSource, commands, mergeBase }),
  ];
  let coverage = null;

  if (!commandsOk) {
    failures.push({ signal: "commands", detail: "validation commands did not pass", files: [] });
  } else {
    coverage = evaluateRefactorCoverage({ config, behaviorFiles, startedAt });

    if (coverage && !coverage.ok) {
      failures.push({ signal: "coverage", detail: coverage.reason, files: coverage.files });
    }
  }

  const unchanged = unchangedTestFiles(config, mergeBase || "HEAD", toProjectFrame(changedFiles, prefix));

  if (unchanged === 0) {
    failures.push({
      signal: "no-unchanged-tests",
      detail: "no unchanged test file remains to hold the behavior",
      files: [],
    });
  }

  return {
    kind: "refactor",
    ok: failures.length === 0,
    failures,
    unchangedTestFiles: unchanged,
    changedFiles,
    behaviorFiles,
    ...(coverage && coverage.patch ? { patch: coverage.patch } : {}),
  };
}

function evaluateClaim({
  storyDir,
  config,
  flagClaim = null,
  commandSource = null,
  commands = [],
  commandsOk = true,
  startedAt = null,
}) {
  const resolved = resolveClaim({ storyDir, flagClaim });

  if (!resolved) {
    return null;
  }

  if (!CLAIMS.has(resolved.kind)) {
    return {
      kind: resolved.kind,
      ok: false,
      failures: [
        {
          signal: "unknown-claim",
          detail: `unknown claim "${resolved.kind}"; supported claims: ${[...CLAIMS].join(", ")}`,
          files: [],
        },
      ],
    };
  }

  return {
    ...evaluateRefactor({ config, storyDir, commandSource, commands, commandsOk, startedAt }),
    source: resolved.source,
  };
}

module.exports = {
  readClaim,
  resolveClaim,
  evaluateClaim,
};
