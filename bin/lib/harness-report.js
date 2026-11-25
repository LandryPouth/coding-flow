"use strict";

// What the harness prints: the check report, the verify verdict with its
// coverage rung, weakened tests, open criteria and contrary signals.

const path = require("path");

const { cwd } = require("./context");
const { describeScope } = require("./diff-base");
const { coverageTier } = require("./coverage");
const { log, normalizePortable, printablePath } = require("./util");
const { resultStatus } = require("./validation-run");
const { NO_CONTRARY } = require("./coverage-gate");
const { describeGrowth } = require("./complexity");

function printHarnessReport(report) {
  if (report.ok) {
    log("Harness check passed.");
  } else {
    log("Harness check failed.");
  }

  log(`Files scanned: ${report.stats.filesScanned}`);

  if (report.errors.length > 0) {
    log("");
    log("Errors:");
    for (const error of report.errors) {
      log(`- ${error.file ? `${error.file}: ` : ""}${error.message}${error.line ? ` (line ${error.line})` : ""}`);
    }
  }

  if (report.warnings.length > 0) {
    log("");
    log("Warnings:");
    for (const warning of report.warnings) {
      log(`- ${warning.file ? `${warning.file}: ` : ""}${warning.message}${warning.line ? ` (line ${warning.line})` : ""}`);
    }
  }
}

// 41,42,43,47 -> "41-43, 47". Uncovered lines come in runs, and a run printed as
// a range is one glance instead of four.
function formatLineRanges(lines) {
  const ranges = [];
  let start = null;
  let previous = null;

  for (const line of lines) {
    if (start === null) {
      start = line;
    } else if (line !== previous + 1) {
      ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
      start = line;
    }

    previous = line;
  }

  if (start !== null) {
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  }

  return `lines ${ranges.join(", ")} not executed`;
}

// Only when it failed: a held red-at-base, or complexity that only warns, is
// printed with the passing verdict.
function printFailedProofs(evidence) {
  if (evidence.redAtBase && !evidence.redAtBase.ok) {
    printRedAtBase(evidence.redAtBase);
  }

  if (evidence.complexity && !evidence.complexity.ok) {
    printComplexity(evidence.complexity);
  }

  if (evidence.mutation && !evidence.mutation.ok) {
    printMutation(evidence.mutation);
  }
}

// Why a run whose commands, coverage and contrary signals held is still not a
// proof; empty when both held.
function notProvenBecause(evidence) {
  if (evidence.redAtBase && !evidence.redAtBase.ok) {
    return "the fix is not proven";
  }

  if (evidence.mutation && !evidence.mutation.ok) {
    return evidence.mutation.ran
      ? `${evidence.mutation.unexcused.length} mutant(s) survived the tests (mutation probe)`
      : "the mutation probe did not run";
  }

  if (!evidence.complexity || evidence.complexity.ok) {
    return "";
  }

  if (evidence.complexity.unavailable) {
    return "the complexity check did not run (functionSize.enforce)";
  }

  return evidence.complexity.items.length > 0
    ? "a touched function grew (functionSize.enforce)"
    : "a touched file was not measured (functionSize.enforce)";
}

// `complexity-grew`: touched functions that got longer or riskier. Labelled a
// heuristic every time, because the decisions and the end of a function are read
// from lcov, not from a parser.
function printComplexity(complexity) {
  if (complexity && complexity.invalidMax !== undefined) {
    log(`  Complexity: functionSize.max ${JSON.stringify(complexity.invalidMax)} is not a positive integer — ${complexity.max} lines used.`);
  }

  if (complexity && complexity.unavailable) {
    log(`  Complexity: not checked — ${complexity.unavailable}.`);
  }

  if (complexity && complexity.unlisted && complexity.unlisted.length > 0) {
    const verdict = complexity.enforced ? "FAILED (functionSize.enforce)" : "warning";
    log(`  Complexity not measured: ${verdict} — the lcov does not list ${complexity.unlisted.join(", ")} (no test loaded it).`);
  }

  if (!complexity || complexity.items.length === 0) {
    return;
  }

  const verdict = complexity.enforced ? "FAILED (functionSize.enforce)" : "warning";
  log(`  Complexity grew: ${verdict} — heuristic, from ${complexity.reports.join(", ")} ` +
    `(length over ${complexity.max} lines, CRAP over ${complexity.crapThreshold}):`);

  for (const item of complexity.items) {
    log(`    ${describeGrowth(item)}`);
  }

  if (complexity.scope) {
    log(`    (${complexity.scope})`);
  }
}

// The mutation probe (story 15-05): what it killed, each survivor by
// `file:line`, and the limits, every time it ran. A quiet skip prints nothing.
function printMutation(mutation) {
  if (!mutation || mutation.skipped) {
    return;
  }

  const verdict = mutation.ok ? "warning" : "FAILED (strict)";

  if (!mutation.ran) {
    log(`  Mutation: ${verdict} — ${mutation.reason}.`);
    return;
  }

  const apart = Object.entries(mutation.apart).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`);
  log(`  Mutation: ${mutation.killed} killed, ${mutation.survived.length} survived` +
    `${apart.length > 0 ? ` (apart: ${apart.join(", ")})` : ""} — ${mutation.survived.length > 0 ? verdict : "ok"}, heuristic.`);

  for (const { file, line, operator } of mutation.survived) {
    const excused = !mutation.unexcused.includes(`${file}:${line}`);
    log(`    ${file}:${line}  ${operator}${excused ? "  (Mutation Exemption)" : ""}`);
  }

  if (mutation.exemption) {
    log(`    Mutation Exemption: "${mutation.exemption.split(/\r?\n/)[0]}"`);
  }

  log(`    Limits: ${mutation.limits}`);
}

// The fix-specific proof: what ran, where, and why it did or did not hold.
// Printed on success too — the point of the flag is that the negative evidence
// becomes a recorded fact, not a sentence the author wrote.
function printRedAtBase(red) {
  if (!red) {
    return;
  }

  const files = Array.isArray(red.files) ? red.files : [];
  const base = red.base ? red.base.slice(0, 7) : "the merge base";

  if (red.ok) {
    log(
      `  Red at base: ok — ${files.length} test file${files.length === 1 ? "" : "s"} failed at ${base} ` +
        `and passed at HEAD (${red.durationMs}ms).`,
    );
    return;
  }

  const first = String(red.reason || "the red-at-base check did not hold").split(/\r?\n/)[0];
  log(`  Red at base: FAILED — ${first}`);

  for (const line of String(red.reason || "").split(/\r?\n/).slice(1)) {
    if (line.trim()) {
      log(`    ${line}`);
    }
  }
}

// A verify that held: the coverage rung it reached, then everything that still
// deserves a look (weakened tests, open criteria, warnings), and the claims.
function printPassed(evidence, coverage, contrary) {
  const survivors = evidence.mutation && evidence.mutation.ran ? evidence.mutation.unexcused.length : 0;
  const warnings = [describeNotExamined(evidence.results), describeContraryWarnings(contrary), describeGrew(evidence.complexity), describeUncaptured(evidence),
    survivors > 0 ? `${survivors} mutant(s) survived` : "", evidence.mutation && evidence.mutation.ran === false && !evidence.mutation.skipped ? "mutation not examined" : ""]
    .filter(Boolean).join(", ");
  log(warnings
    ? `Harness verify passed, with warnings (${warnings}): ${evidence.results.length} command(s).`
    : `Harness verify passed (${evidence.results.length} command(s)).`);

  // Name the rung before the sentence. "Coverage: evidence — 1 test file(s)
  // changed" and "Coverage: verified — 92% of the added lines ran" now read as
  // the different claims they are; before this they read as one.
  const tier = coverage.tier || coverageTier(coverage);

  if (coverage.exemption) {
    log(`  Coverage: exempted — "${coverage.exemption.split(/\r?\n/)[0]}"`);
  } else if (coverage.required) {
    const reportCount = coverage.patch ? (coverage.patch.report.reports || []).length : 0;
    log(`  Coverage: ${tier} — ${coverage.reason}` +
      (tier === "verified" && reportCount > 1 ? ` (${reportCount} reports)` : ""));

    // The one rung worth explaining: it passed on a proxy, and the way to earn
    // the stronger word is a coverage report this run actually produced.
    if (tier === "evidence" && coverage.patch) {
      log("  Some changed files lie outside every coverage report's package, so they are");
      log("  unmeasured; emit a report in their package to get 'verified'.");
    } else if (tier === "evidence") {
      log("  A test file moved; no fresh coverage report was found, so nothing measured");
      log("  this change. Emit lcov.info or coverage-final.json to get 'verified'.");
    }
  }

  // Printed at every rung, including `verified`. A measured 92% next to three
  // deleted tests is still three deleted tests, and the reader decides what that
  // means — this only refuses to let a good number hide it.
  printTestDirection(coverage);
  printRedAtBase(evidence.redAtBase);
  printComplexity(evidence.complexity);
  printMutation(evidence.mutation);
  printOpenCriteria(evidence);
  printContraryFailures(contrary);
  printClaimHeld(evidence.claim);
  printUncaptured(evidence);
}

// story-26-07: never a failure; names each line and shows the shape to write.
function describeUncaptured(evidence) {
  const count = evidence.todoUncaptured ? evidence.todoUncaptured.length : 0;
  return count > 0 ? `todo.uncaptured: ${count} line(s)` : "";
}

function printUncaptured(evidence) {
  if (!evidence.todoUncaptured || evidence.todoUncaptured.length === 0) {
    return;
  }

  log("  todo.uncaptured — the Result says something only a human can do, and the story has no open `## Human to-do` item:");

  for (const entry of evidence.todoUncaptured) {
    log(`    ${entry.source}:${entry.line}: ${entry.text}`);
  }

  log("  Write it as: `## Human to-do` then `- [ ] (before: deploy|next-story|later) <the action>`.");
}

function printVerify(evidence, outputPath) {
  const coverage = evidence.coverage || { required: false, ok: true };
  const coverageBlocked = evidence.commandsOk && !coverage.ok;
  const contrary = evidence.contrary || NO_CONTRARY;
  const contraryBlocked = evidence.commandsOk && coverage.ok && !contrary.ok;
  const claimBlocked = evidence.commandsOk && coverage.ok && evidence.claim && !evidence.claim.ok;
  const redBlocked = evidence.commandsOk && coverage.ok && contrary.ok && Boolean(notProvenBecause(evidence));

  if (evidence.refused) {
    log(`Harness verify REFUSED — ${evidence.refused}.`);
    log(`Nothing was executed (${evidence.commandsFound} command(s) found in plan.md).`);
  } else if (evidence.commandsFound === 0) {
    log("Harness verify: no validation commands found.");
    log("Declare them in plan.md under '## Commands' as a fenced code block, one command per line,");
    log("or in config.validation.commands.");
    printClaimFailures(evidence.claim);
  } else if (coverageBlocked) {
    // Every command passed. The proof still does not hold, and saying "FAILED"
    // here would send someone hunting a broken test that does not exist.
    log(`Harness verify NOT PROVEN — ${evidence.results.length} command(s) passed, coverage gate blocked.`);
    printCoverageBlocked(coverage);
    printClaimFailures(evidence.claim);
    printFailedProofs(evidence);
  } else if (claimBlocked) {
    log(`Harness verify NOT PROVEN — ${evidence.results.length} command(s) passed, but the ${evidence.claim.kind} claim does not hold.`);
    printClaimFailures(evidence.claim);
    printContraryFailures(contrary);
    printFailedProofs(evidence);
    printOpenCriteria(evidence);
  } else if (evidence.ok) {
    printPassed(evidence, coverage, contrary);
  } else if (redBlocked) {
    // The suite, the coverage gate and the contrary signals all held. What is
    // missing is the fix-specific claim: the test does not demonstrate the bug.
    log(`Harness verify NOT PROVEN — ${evidence.results.length} command(s) passed, but ${notProvenBecause(evidence)}.`);
    printFailedProofs(evidence);
    printOpenCriteria(evidence);
  } else if (contraryBlocked) {
    // The commands passed and the coverage gate held. What stops this is the
    // project's own strictness reading the story and the diff against the verdict.
    log(`Harness verify NOT PROVEN — ${evidence.results.length} command(s) passed, but the run contradicts itself.`);
    printContraryFailures(contrary);
    printTestDirection(coverage);
    printFailedProofs(evidence);
    printOpenCriteria(evidence);
    printClaimFailures(evidence.claim);
  } else {
    log("Harness verify FAILED.");
    printTestDirection(coverage);
    printClaimFailures(evidence.claim);
    printFailedProofs(evidence);
  }

  // Which commands ran, and why those. The silent fallback from a config that was
  // never found to whatever package.json happened to hold is exactly how a verify
  // ends up proving less than it claims; naming the source makes the drift visible
  // on the line above the results instead of only inside the JSON.
  if (evidence.commandsFound > 0) {
    log(`Commands from: ${evidence.commandSource}`);
  }

  // Which diff the coverage and risk verdicts above were measured on. "82 test
  // files" means one thing against the epic branch and another against main.
  const scopeLine = describeScope(
    evidence.diffBase,
    // A skipped coverage gate (low risk) never listed the files; "0 files" would lie.
    coverage.required !== false && Array.isArray(coverage.changedFiles) ? coverage.changedFiles.length : null,
  );

  if (scopeLine) {
    log(scopeLine);
  }

  printResults(evidence.results);
  printFixerWrites(evidence);

  if (outputPath) {
    log(`Evidence: ${normalizePortable(path.relative(cwd, outputPath))}`);
  }
}

// Story 19-05: what the fixers rewrote, left in the tree for whoever commits.
function printFixerWrites(evidence) {
  printFixedFiles(evidence);
  printHarmlessWrites(evidence);
}

function printFixedFiles({ fixedFiles, fixerStrengthened = [] }) {
  if (fixerStrengthened.length > 0) {
    log(`Warning: ${fixerStrengthened.length} test file(s) counted as strengthened were rewritten by a fixer in this run: ${fixerStrengthened.map(printablePath).join(", ")}`);
    log("  a formatter's rewrite is not a stronger test; the gate's neutral rule is under review (story 19-08)");
  }

  if (fixedFiles === undefined) {
    return;
  }

  if (fixedFiles === null) {
    log("Fixed by the fixers: unknown (no git snapshot of the working tree).");
    return;
  }

  if (fixedFiles.length === 0) {
    log("Fixed by the fixers: nothing changed.");
    return;
  }

  log("Fixed by the fixers:");

  for (const file of fixedFiles) {
    log(`  - ${printablePath(file)}`);
  }

  log("  (left in the working tree, not committed)");
}

// Changed under `.coding-flow/` during the fixers, and no write: named, not hidden.
function printHarmlessWrites({ reformatted = [], guardLogs = [] }) {
  if (reformatted.length > 0) {
    log(`Reformatted, same value: ${reformatted.map(printablePath).join(", ")}`);
  }

  if (guardLogs.length > 0) {
    log(`Written by the guard during the fixers: ${guardLogs.map(printablePath).join(", ")}`);
  }
}

// One line per command, then what explains a non-green one.
function printResults(results) {
  for (const item of results) {
    const replay = item.cache === "full" || item.cache === "partial"
      ? `, replayed from cache${item.total ? `: ${item.cached}/${item.total} tasks` : ""}`
      : "";
    const kind = item.kind === "security" ? "security: " : item.kind === "fix" ? "fix: " : "";
    log(`- [${resultStatus(item)}] ${kind}${item.command} (${item.durationMs}ms${replay})`);

    if (item.outcome === "not-examined") {
      log(`    ${item.notExamined} — a scanner that did not run found nothing because it looked at nothing`);
      continue;
    }

    if (item.freshRequired) {
      log(`    ${item.freshRequired}`);
    }

    // Name the knob: a timeout is a limit the project can raise, not a failure of the code.
    if (item.timedOut) {
      log(`    timeout after ${Number((item.timeoutMs / 1000).toFixed(1))} s (validation.timeoutMs)`);
    }

    if (item.toolError) {
      log(`    ${item.toolError}`);
    }

    // Prefer the lines that name the failure over the tail of stderr. A runner
    // that reports on stdout — node:test, vitest, pytest — leaves stderr empty,
    // so the old branch printed nothing at all for the most common case and the
    // reader had to re-run the command to find out what broke.
    if (!item.ok) {
      const named = Array.isArray(item.failureLines) && item.failureLines.length
        ? item.failureLines.slice(-3)
        : String(item.stderrTail || "").trim()
          ? String(item.stderrTail).trim().split(/\r?\n/).slice(-3)
          : [];

      for (const line of named) {
        log(`    ${line}`);
      }
    }
  }
}

// Why the coverage gate blocked a suite that passed: where the number came from,
// which lines are missing, and the two ways forward — measure it or declare it.
function printCoverageBlocked(coverage) {
  log(`  ${coverage.reason}`);

  // Naming WHY this counted as risky matters: "the diff touches src/auth.js"
  // is checkable, "the story mentioned auth" is arguable.
  if (coverage.riskSource === "diff" && coverage.riskPaths && coverage.riskPaths.length > 0) {
    log(`  Risk read from the diff, not the story: ${coverage.riskPaths.slice(0, 3).join(", ")}`);
  }

  // Line-level: name the lines. "80% of the diff is uncovered" sends someone
  // reading the whole change; "src/auth.js:41-46" sends them to the code.
  if (coverage.patch) {
    const reports = coverage.patch.report.reports || [];
    log(reports.length > 1
      ? `  Measured from ${reports.length} reports: ${reports.map((r) => r.path).join(", ")}.`
      : `  Measured from ${coverage.patch.report.path} (${coverage.patch.report.format}).`);

    for (const entry of coverage.patch.uncovered.slice(0, 5)) {
      const detail = entry.absentFromReport
        ? "not executed at all (absent from the report)"
        : formatLineRanges(entry.lines);
      log(`  - ${entry.file}: ${detail}`);
    }
  } else if (coverage.behaviorFiles) {
    log(`  Changed without a test: ${coverage.behaviorFiles.slice(0, 5).join(", ")}` +
      (coverage.behaviorFiles.length > 5 ? ` (+${coverage.behaviorFiles.length - 5} more)` : ""));
  }

  printTestDirection(coverage);

  if (coverage.floor) {
    log("  Emit a coverage report (lcov.info / coverage-final.json) so the added lines are measured,");
    log("  or declare a '## Test Exemption' section (or --test-exemption) to ship on a written reason.");
  } else {
    log("  Add a test that covers this change, declare a '## Test Exemption' section in the story,");
    log('  or re-run with --test-exemption "<reason>" if there is no story.');
  }
}

// A held claim is the sentence the run was asked to prove: behavior did not
// move, and the tests that say so did not move either. The coverage is the whole
// suite's, new characterization tests included — said, so the sentence does not
// read as "the unchanged tests alone reach every moved line".
function printClaimHeld(claim) {
  if (!claim || !claim.ok) {
    return;
  }

  const files = claim.unchangedTestFiles === 1 ? "test file" : "test files";
  log(`  Claim held — ${claim.kind}: ${claim.unchangedTestFiles} ${files} from the base untouched, none skipped or weakened.`);

  if (claim.patch) {
    log(`    ${claim.patch.percent}% of the ${claim.patch.totalLines} added line(s) ran under the whole suite, new tests included.`);
  }
}

function printClaimFailures(claim) {
  if (!claim || claim.ok) {
    return;
  }

  log(`  Claim: ${claim.kind} does NOT hold:`);

  for (const failure of claim.failures.slice(0, 5)) {
    log(`    - ${failure.detail}`);
  }

  if (claim.failures.length > 5) {
    log(`    - … and ${claim.failures.length - 5} more`);
  }
}

function printTestDirection(coverage) {
  printWeakenedTests(coverage);
  printNeutralTests(coverage);
}

// Story 19-08: a test file changed without a new test or assertion is named, so
// a reformat that earned nothing says so instead of passing for coverage.
function printNeutralTests(coverage) {
  const files = (coverage && coverage.neutralTests) || [];

  if (!files.length) {
    return;
  }

  log(`  Tests changed without a new test or assertion (neutral) (${files.length}):`);

  for (const file of files.slice(0, 5)) {
    log(`    - ${printablePath(file)}`);
  }

  if (files.length > 5) {
    log(`    - … and ${files.length - 5} more`);
  }
}

// Reported, never silently swallowed. These are regexes over a diff, so the
// wording stays descriptive — "assertions removed", not "test weakened on purpose".
function printWeakenedTests(coverage) {
  const findings = (coverage && coverage.weakenedTests) || [];

  if (!findings.length) {
    return;
  }

  log(`  Tests weakened in this diff (${findings.length}):`);

  for (const finding of findings.slice(0, 5)) {
    log(`    - ${finding.file}: ${finding.detail}`);
  }

  if (findings.length > 5) {
    log(`    - … and ${findings.length - 5} more`);
  }
}

// Only on a green verify, and only when something is still unticked. On a red
// one the failing command is the message, and on a fully ticked story there is
// nothing to say. The closing line is not filler: without it, a list printed
// under a passing verdict reads like a new gate, and the next thing someone
// does is look for the flag that turns it off.
function printOpenCriteria(evidence) {
  const criteria = evidence.acceptanceCriteria;

  if (!criteria || criteria.unchecked.length === 0) {
    return;
  }

  const deferred = criteria.deferred || [];
  const ticked = criteria.total - criteria.unchecked.length - deferred.length;

  log(`  Acceptance criteria: ${ticked}/${criteria.total} ticked in the story` +
    (deferred.length > 0 ? ` (${deferred.length} deferred)` : "") + ". Still open:");

  for (const text of criteria.unchecked.slice(0, 5)) {
    log(`    - [ ] ${text}`);
  }

  if (criteria.unchecked.length > 5) {
    log(`    - … and ${criteria.unchecked.length - 5} more`);
  }

  if (evidence.contrary && evidence.contrary.enforced) {
    log("  The commands passed, but this project is strict: open criteria block the verdict.");
    return;
  }

  log("  The commands passed. These are the story's own claims, unproven either way —");
  log("  this changes no verdict and blocks nothing.");
}

function printContraryFailures(contrary) {
  for (const failure of contrary.failures) {
    log(`  ${failure.detail}`);
  }

  if (contrary.failures.some((failure) => failure.signal === "deleted-tests")) {
    log("  Restore the test, or name the deleted file in a '## Test Exemption' section with the reason.");
  }
}

// "3 deleted test files, 5 open criteria" — what a passing run still carries.
// Only reached on a passing verdict, so these are the non-strict warnings.
function describeNotExamined(results) {
  const count = (results || []).filter((item) => item.outcome === "not-examined").length;

  return count > 0 ? `${count} security command${count === 1 ? "" : "s"} not examined` : "";
}

function describeGrew(complexity) {
  const count = complexity ? complexity.items.length : 0;
  const unlisted = complexity && complexity.unlisted ? complexity.unlisted.length : 0;

  return [
    count > 0 ? `${count} function${count === 1 ? "" : "s"} grew (heuristic)` : "",
    unlisted > 0 ? `${unlisted} touched file${unlisted === 1 ? "" : "s"} not measured` : "",
    complexity && complexity.invalidMax !== undefined ? "functionSize.max ignored" : "",
  ].filter(Boolean).join(", ");
}

function describeContraryWarnings(contrary) {
  const w = contrary && contrary.warnings;
  const parts = [];

  if (w && w.deletedTests.length > 0) {
    parts.push(`${w.deletedTests.length} deleted test file${w.deletedTests.length === 1 ? "" : "s"}`);
  }

  if (w && w.openCriteria.length > 0) {
    parts.push(`${w.openCriteria.length} open criteri${w.openCriteria.length === 1 ? "on" : "a"}`);
  }

  if (w && w.assertionsRemoved && w.assertionsRemoved.length > 0) {
    parts.push(`assertions removed in ${w.assertionsRemoved.length} test file${w.assertionsRemoved.length === 1 ? "" : "s"}`);
  }

  if (w && w.criteriaChanged && w.criteriaChanged.length > 0) {
    parts.push(`${w.criteriaChanged.length} criteria changed: ${w.criteriaChanged.slice(0, 3).join("; ")}`);
  }

  if (w && w.specInDiff) {
    parts.push("spec born in this diff");
  }

  if (w && w.policyChanged && w.policyChanged.length > 0) {
    parts.push(`policy changed: ${w.policyChanged.slice(0, 3).join(", ")}`);
  }

  return parts.join(", ");
}

module.exports = {
  printHarnessReport,
  printVerify,
};
