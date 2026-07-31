"use strict";

// `ai-flow run`: the batch orchestrator. It resolves a set of prepared stories
// (all, one epic, or one story) and, for each, executes `harness verify` — the
// declared validation commands, run for real and captured verbatim — then emits
// ONE aggregated proof report over the whole batch.
//
// Design: the CLI orchestrates, a DRIVER executes. In this version the only
// driver is "none": it implements nothing and simply verifies work that was
// already done (by a human, or by an interactive `/run` session in Claude Code).
// The executor seam is deliberately visible — a future driver (an agent binary
// that implements each story before it is verified) becomes a purely additive
// change, not a rewrite. Same shape as the storage-backend seam: one name active,
// the rest declared and deferred.
//
// The auditable proof is the per-story *-verify.json that verify writes; the
// *-run.json this command emits is the human-facing rollup and is intentionally
// NOT ingested by the ledger (audit only reads *-verify.json / *-evidence.json).

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { log, fail, writeJson, normalizePortable } = require("./util");
const { getStorage } = require("./storage");
const { captureIdentity } = require("./identity");
const {
  verifyStoryOnce,
  writeVerifyEvidence,
  resolveValidationCommands,
  resolveStoryDir,
  captureEnvironment,
  harnessRunsDir,
} = require("./harness");

// Executors. "none" is the only one implemented; the rest are reserved names for
// the pluggable-driver seam (an agent that implements each story before verify).
// See docs/plans/pivot-unattended-proof.md (Batch 4b / multi-agent).
const RUN_DRIVERS = ["none"];

// Flattens the configured storage into a single list of story entries, each with
// the portable story-dir path that `verify` consumes as its --story.
function flattenStories() {
  const storage = getStorage(cwd);
  const stories = [];

  for (const epic of storage.listEpics()) {
    for (const story of epic.stories) {
      stories.push({
        epic: epic.name,
        name: story.name,
        title: story.title,
        path: story.path,
        status: story.status,
      });
    }
  }

  return stories;
}

// Selects which stories the run targets. Precedence: an explicit --story, then
// --epic, then all stories.
function selectStories(all, { story, epic }) {
  if (story) {
    const dir = resolveStoryDir(story);

    if (!dir) {
      fail(`--story "${story}" is not a story directory inside the project.`);
    }

    const rel = normalizePortable(path.relative(cwd, dir));
    const matched = all.filter((entry) => entry.path === rel);

    if (matched.length === 0) {
      fail(`--story "${story}" was not found under epics/.`);
    }

    return { kind: "story", ref: rel, stories: matched };
  }

  if (epic) {
    const matched = all.filter((entry) => entry.epic === epic || entry.epic.includes(epic));

    if (matched.length === 0) {
      fail(`--epic "${epic}" matched no stories under epics/.`);
    }

    return { kind: "epic", ref: epic, stories: matched };
  }

  return { kind: "all", ref: null, stories: all };
}

function printDryRun(target, driver, json) {
  const rows = target.stories.map((entry) => {
    const resolution = resolveValidationCommands({ storyDir: resolveStoryDir(entry.path) });
    return {
      story: entry.path,
      title: entry.title,
      commandSource: resolution.source,
      commands: resolution.commands,
    };
  });

  if (json) {
    log(JSON.stringify({ driver, target: { kind: target.kind, ref: target.ref }, stories: rows }, null, 2));
    return;
  }

  log(`Run — dry run (driver: ${driver}, target: ${target.kind}${target.ref ? ` ${target.ref}` : ""}). Nothing executed.`);

  for (const row of rows) {
    log(`- ${row.story}`);

    if (row.commands.length === 0) {
      log("    no validation commands (source: none) — would be skipped");
    } else {
      log(`    ${row.commands.length} command(s) from ${row.commandSource}: ${row.commands.join(" && ")}`);
    }
  }
}

function printReport(report, reportPath) {
  const { target } = report;
  log(`Run report — driver: ${report.driver}, target: ${target.kind}${target.ref ? ` ${target.ref}` : ""}`);

  for (const entry of report.stories) {
    if (!entry.executed) {
      log(`- [skip] ${entry.story} — no validation commands`);
      continue;
    }

    const duration = entry.results.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    log(`- [${entry.ok ? "pass" : "FAIL"}] ${entry.story} (${entry.commandsFound} cmd(s), ${duration}ms)`);

    if (!entry.ok) {
      const firstFail = entry.results.find((item) => !item.ok);

      if (firstFail) {
        const why = firstFail.timedOut ? "timeout" : `exit ${firstFail.exitCode}`;
        log(`    ${firstFail.command} — ${why}`);
      }
    }
  }

  const { summary } = report;
  log("");
  log(`${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped of ${summary.total}.`);
  log(`Run report: ${normalizePortable(path.relative(cwd, reportPath))}`);

  if (!report.ok && summary.executed === 0) {
    log(
      "No story was verifiable (no validation commands). Declare them in " +
        "config.validation.commands or each plan.md '## Commands'.",
    );
  }
}

function run({ story = null, epic = null, driver = "none", json = false, dryRun = false } = {}) {
  if (!RUN_DRIVERS.includes(driver)) {
    fail(
      `driver "${driver}" is not available yet. Only ${RUN_DRIVERS.map((name) => `"${name}"`).join(", ")} ` +
        "is supported for now — the executor seam is in place (see docs/plans/pivot-unattended-proof.md).",
    );
  }

  const all = flattenStories();

  if (all.length === 0) {
    fail("no stories found under epics/. Create one with `/plan` first.");
  }

  const target = selectStories(all, { story, epic });

  if (dryRun) {
    printDryRun(target, driver, json);
    return;
  }

  const stories = [];

  for (const entry of target.stories) {
    // Driver "none" implements nothing — it verifies work already done. A future
    // driver would implement the story here, before it is verified.
    const evidence = verifyStoryOnce({ story: entry.path });
    const executed = evidence.commandsFound > 0;
    // Only persist an auditable verify when something actually ran: recording a
    // not-yet-ready story as a failed verify would wrongly mark it blocked.
    const evidencePath = executed ? writeVerifyEvidence(evidence) : null;

    stories.push({
      story: entry.path,
      title: entry.title,
      implemented: false,
      commandSource: evidence.commandSource,
      commandsFound: evidence.commandsFound,
      executed,
      ok: evidence.ok,
      results: evidence.results,
      evidencePath: evidencePath ? normalizePortable(path.relative(cwd, evidencePath)) : null,
    });
  }

  const executed = stories.filter((entry) => entry.executed);
  const failed = executed.filter((entry) => !entry.ok);
  const skipped = stories.filter((entry) => !entry.executed);
  // Green iff at least one story was verifiable and none of those failed. Skipped
  // (not-yet-verifiable) stories are loud in the summary but do not turn it red.
  const ok = executed.length > 0 && failed.length === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    root: cwd,
    provenance: captureIdentity(cwd),
    driver,
    target: { kind: target.kind, ref: target.ref },
    environment: captureEnvironment(),
    stories,
    summary: {
      total: stories.length,
      executed: executed.length,
      passed: executed.length - failed.length,
      failed: failed.length,
      skipped: skipped.length,
    },
    ok,
  };

  fs.mkdirSync(harnessRunsDir(), { recursive: true });
  const reportPath = path.join(harnessRunsDir(), `${new Date().toISOString().replace(/[:.]/g, "-")}-run.json`);
  writeJson(reportPath, report);

  if (json) {
    log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, reportPath);
  }

  if (!ok) {
    process.exitCode = 1;
  }
}

function runCommand({ getFlagValue, flags }) {
  run({
    story: getFlagValue("--story", null),
    epic: getFlagValue("--epic", null),
    driver: getFlagValue("--driver", "none"),
    json: flags.has("--json"),
    dryRun: flags.has("--dry-run"),
  });
}

module.exports = { runCommand, run, RUN_DRIVERS };
