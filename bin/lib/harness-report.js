"use strict";

// What the harness prints: the check report, the verify verdict with its
// coverage rung, weakened tests, open criteria and contrary signals.

const path = require("path");

const { cwd } = require("./context");
const { describeScope } = require("./diff-base");
const { coverageTier } = require("./coverage");
const { log, normalizePortable } = require("./util");
const { resultStatus } = require("./validation-run");
const { NO_CONTRARY } = require("./coverage-gate");

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

function printVerify(evidence, outputPath) {
  const coverage = evidence.coverage || { required: false, ok: true };
  const coverageBlocked = evidence.commandsOk && !coverage.ok;
  const contrary = evidence.contrary || NO_CONTRARY;
  const contraryBlocked = evidence.commandsOk && coverage.ok && !contrary.ok;

  if (evidence.refused) {
    log(`Harness verify REFUSED — ${evidence.refused}.`);
    log(`Nothing was executed (${evidence.commandsFound} command(s) found in plan.md).`);
  } else if (evidence.commandsFound === 0) {
    log("Harness verify: no validation commands found.");
    log("Declare them in plan.md under '## Commands' as a fenced code block, one command per line,");
    log("or in config.validation.commands.");
  } else if (coverageBlocked) {
    // Every command passed. The proof still does not hold, and saying "FAILED"
    // here would send someone hunting a broken test that does not exist.
    log(`Harness verify NOT PROVEN — ${evidence.results.length} command(s) passed, coverage gate blocked.`);
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

    printWeakenedTests(coverage);
    if (coverage.floor) {
      log("  Emit a coverage report (lcov.info / coverage-final.json) so the added lines are measured,");
      log("  or declare a '## Test Exemption' section (or --test-exemption) to ship on a written reason.");
    } else {
      log("  Add a test that covers this change, declare a '## Test Exemption' section in the story,");
      log('  or re-run with --test-exemption "<reason>" if there is no story.');
    }
  } else if (evidence.ok) {
    const warnings = describeContraryWarnings(contrary);
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
    printWeakenedTests(coverage);
    printOpenCriteria(evidence);
    printContraryFailures(contrary);
  } else if (contraryBlocked) {
    // The commands passed and the coverage gate held. What stops this is the
    // project's own strictness reading the story and the diff against the verdict.
    log(`Harness verify NOT PROVEN — ${evidence.results.length} command(s) passed, but the run contradicts itself.`);
    printContraryFailures(contrary);
    printWeakenedTests(coverage);
    printOpenCriteria(evidence);
  } else {
    log("Harness verify FAILED.");
    printWeakenedTests(coverage);
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

  for (const item of evidence.results) {
    const replay = item.cache === "full" || item.cache === "partial"
      ? `, replayed from cache${item.total ? `: ${item.cached}/${item.total} tasks` : ""}`
      : "";
    log(`- [${resultStatus(item)}] ${item.command} (${item.durationMs}ms${replay})`);

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
        : item.stderrTail.trim()
          ? item.stderrTail.trim().split(/\r?\n/).slice(-3)
          : [];

      for (const line of named) {
        log(`    ${line}`);
      }
    }
  }

  if (outputPath) {
    log(`Evidence: ${normalizePortable(path.relative(cwd, outputPath))}`);
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

  return parts.join(", ");
}

module.exports = {
  printHarnessReport,
  printVerify,
};
