"use strict";

// `report` answers one question: "what went wrong in this repo, in a form the
// person it went wrong for can hand to someone else?"
//
// It exists because the alternative is a description. A user who hits a bad gate
// remembers that "it blocked something", not which pattern fired on which path
// at which risk level — and a tool whose whole argument is that executed proof
// beats assertion cannot collect its own bug reports by assertion. Everything
// here is read back from what the harness already recorded; nothing new is
// measured, and the command never writes to the project.
//
// It is redacted by default because the output travels. A report emailed by
// someone else's developer must not carry their home directory, their username,
// or a line of their source that happened to sit next to a failure. `--raw`
// turns that off for your own repositories.

const fs = require("fs");
const os = require("os");
const path = require("path");

const { cwd } = require("./context");
const { log, readJson, normalizePortable, selectFailureLines } = require("./util");

const MAX_DENIALS = 40;
const MAX_FAILURES = 15;
const MAX_TAIL_LINES = 12;

function codingFlowDir(root = cwd) {
  return path.join(root, ".coding-flow");
}

// Redaction is a pair of substitutions over free text, applied to anything that
// might carry a path: the project root becomes a placeholder before the home
// directory does, so a path inside the project stays readable and useful.
function makeRedactor({ root, raw }) {
  if (raw) {
    return (value) => value;
  }

  const home = os.homedir();
  const user = path.basename(home || "") || null;
  const replacements = [
    [root, "<project>"],
    ...(home && home !== root ? [[home, "<home>"]] : []),
  ];

  return (value) => {
    if (typeof value !== "string" || !value) {
      return value;
    }

    let out = value;

    for (const [needle, token] of replacements) {
      out = out.split(needle).join(token);
    }

    // A username survives in places a path substitution cannot reach: a git
    // remote, an email, a container path built from a different prefix.
    if (user && user.length > 2) {
      out = out.split(user).join("<user>");
    }

    return out;
  };
}

function readRuns(root) {
  const dir = path.join(codingFlowDir(root), "runs");

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const parsed = readJson(path.join(dir, name), null);
      return parsed ? { ...parsed, file: name, kind: name.includes("verify") ? "verify" : "evidence" } : null;
    })
    .filter(Boolean);
}

function readDenials(root) {
  const logPath = path.join(codingFlowDir(root), "denials.jsonl");

  if (!fs.existsSync(logPath)) {
    return [];
  }

  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// The interesting part of a failed command is the part that names the failure,
// not the hundred lines of progress output around it.
//
// `failureLines` is the good source: selected at capture time from the whole
// output, before all but the last 4 KB was thrown away. Runs recorded before
// that existed only have the tail, so the same selection is applied to it as a
// fallback — worse input, same rule. When neither yields anything, the raw tail
// goes in, because a failure that printed no recognisable reason is itself
// what the reader needs to see.
function failureTail(result) {
  if (Array.isArray(result.failureLines) && result.failureLines.length) {
    return result.failureLines.slice(-MAX_TAIL_LINES);
  }

  const text = `${result.stdoutTail || ""}\n${result.stderrTail || ""}`;
  const selected = selectFailureLines(text, { limit: MAX_TAIL_LINES });

  if (selected.length) {
    return selected;
  }

  return text.split(/\r?\n/).filter((line) => line.trim()).slice(-MAX_TAIL_LINES);
}

function countBy(items, pick) {
  const out = {};

  for (const item of items) {
    const key = pick(item);

    if (key !== null && key !== undefined) {
      out[key] = (out[key] || 0) + 1;
    }
  }

  return out;
}

function describeCounts(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([key, n]) => `${key} ${n}`).join(" · ") : "none recorded";
}

function buildReport({ root = cwd, raw = false } = {}) {
  const redact = makeRedactor({ root, raw });
  const runs = readRuns(root);
  const verifies = runs.filter((run) => run.kind === "verify");
  const evidence = runs.filter((run) => run.kind === "evidence");
  const denials = readDenials(root);
  const config = readJson(path.join(codingFlowDir(root), "config.json"), null);
  const harness = readJson(path.join(codingFlowDir(root), "harness.json"), null);
  const settings = readJson(path.join(root, ".claude", "settings.json"), null);

  const failures = [];

  for (const run of verifies) {
    for (const result of run.results || []) {
      if (result.ok) {
        continue;
      }

      failures.push({
        at: run.generatedAt || null,
        story: run.story ? redact(run.story) : null,
        command: redact(result.command || ""),
        exitCode: result.exitCode,
        timedOut: Boolean(result.timedOut),
        // A tool error means the harness could not observe the result at all.
        // That is a bug in this tool, not a red suite, and it is the single most
        // valuable row in this file.
        toolError: result.toolError ? redact(String(result.toolError)) : null,
        tail: failureTail(result).map(redact),
      });
    }
  }

  const durations = verifies
    .map((run) => (run.results || []).reduce((sum, result) => sum + (result.durationMs || 0), 0))
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);

  return {
    generatedAt: new Date().toISOString(),
    redacted: !raw,
    tool: {
      version: readJson(path.join(__dirname, "..", "..", "package.json"), {}).version || "unknown",
      node: process.version,
      platform: process.platform,
    },
    install: {
      mode: config ? config.install || "full" : "not installed",
      skills: config ? config.skills || null : null,
      declaredCommands: config && config.validation ? (config.validation.commands || []).length : 0,
      guardHookWired: Boolean(
        settings && settings.hooks && Array.isArray(settings.hooks.PreToolUse) && settings.hooks.PreToolUse.length,
      ),
      harnessConfig: Boolean(harness),
      frictionLog: fs.existsSync(path.join(root, "docs", "DOGFOODING.md")),
    },
    activity: {
      verifyRuns: verifies.length,
      verifyGreen: verifies.filter((run) => run.ok).length,
      verifyRed: verifies.filter((run) => !run.ok).length,
      evidenceRuns: evidence.length,
      medianVerifyMs: durations.length ? durations[Math.floor(durations.length / 2)] : null,
      riskLevels: countBy(evidence, (run) => (run.risk ? run.risk.level : null)),
      recommendedModes: countBy(evidence, (run) => run.recommendedMode || null),
      coverageTiers: countBy(verifies, (run) => (run.coverage ? run.coverage.mode || run.coverage.tier : null)),
    },
    denials: denials.slice(-MAX_DENIALS).map((entry) => ({
      at: entry.at || null,
      tool: entry.tool || null,
      path: entry.path ? redact(entry.path) : null,
      reason: redact(entry.reason || ""),
    })),
    denialsTotal: denials.length,
    failures: failures.slice(-MAX_FAILURES),
    failuresTotal: failures.length,
  };
}

function renderMarkdown(report) {
  const lines = [];
  const push = (line = "") => lines.push(line);

  push("# Coding Flow report");
  push();
  push(
    report.redacted
      ? "> Redacted: paths are relative to the project, home directory and username are masked, " +
          "and no secret value is ever recorded — only the name of the pattern that matched. " +
          "Re-run with `--raw` for the unredacted version."
      : "> **Unredacted** (`--raw`). This file may contain absolute paths and full command output.",
  );
  push();
  push(
    `Coding Flow ${report.tool.version} · Node ${report.tool.node} · ${report.tool.platform} · generated ${report.generatedAt}`,
  );
  push();

  push("## Install");
  push();
  push(`- Mode: **${report.install.mode}**`);
  push(`- Guard hook wired: **${report.install.guardHookWired ? "yes" : "no"}**`);
  push(`- Harness config: ${report.install.harnessConfig ? "present" : "missing"}`);
  push(`- Declared validation commands: ${report.install.declaredCommands || "none (falls back to package.json)"}`);
  push(`- Friction log: ${report.install.frictionLog ? "present" : "missing"}`);
  push();

  push("## Activity");
  push();
  push(`- Verify runs: **${report.activity.verifyRuns}** (${report.activity.verifyGreen} green, ${report.activity.verifyRed} red)`);
  push(
    `- Median verify: ${
      report.activity.medianVerifyMs ? `${(report.activity.medianVerifyMs / 1000).toFixed(1)}s` : "n/a"
    }`,
  );
  push(`- Risk levels: ${describeCounts(report.activity.riskLevels)}`);
  push(`- Recommended modes: ${describeCounts(report.activity.recommendedModes)}`);
  push(`- Coverage rungs: ${describeCounts(report.activity.coverageTiers)}`);
  push();

  push(`## Guard denials (${report.denialsTotal})`);
  push();

  if (!report.denials.length) {
    push("None recorded.");
  } else {
    push("| When | Tool | Path | Reason |");
    push("|---|---|---|---|");

    for (const denial of report.denials) {
      const when = denial.at ? denial.at.replace("T", " ").slice(0, 16) : "?";
      push(`| ${when} | ${denial.tool || "?"} | \`${denial.path || "?"}\` | ${denial.reason} |`);
    }
  }

  push();
  push(`## Verify failures (${report.failuresTotal})`);
  push();

  if (!report.failures.length) {
    push("None recorded.");
  } else {
    for (const failure of report.failures) {
      const when = failure.at ? failure.at.replace("T", " ").slice(0, 16) : "?";
      const label = failure.toolError
        ? `**tool error** — the harness could not observe the result`
        : failure.timedOut
          ? "timed out"
          : `exit ${failure.exitCode}`;

      push(`- \`${failure.command}\` — ${label}${failure.story ? ` · ${failure.story}` : ""} · ${when}`);

      if (failure.toolError) {
        push(`  - ${failure.toolError}`);
      }

      for (const line of failure.tail) {
        push(`  > ${line}`);
      }

      push();
    }
  }

  push("## What to do with this file");
  push();
  push(
    "Send it as-is. Every row above is something the tool observed, so there is nothing " +
      "to remember or reconstruct. If a denial in the table blocked a change that was not " +
      "actually risky, that is the most useful row in the file — say which one.",
  );

  return lines.join("\n");
}

function reportCommand({ getFlagValue, flags }) {
  const raw = flags.has("--raw");
  const report = buildReport({ raw });

  if (flags.has("--json")) {
    log(JSON.stringify(report, null, 2));
    return;
  }

  const markdown = renderMarkdown(report);
  const out = getFlagValue("--out", null);

  if (out) {
    const target = path.resolve(cwd, out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${markdown}\n`);
    log(`Report written to ${normalizePortable(path.relative(cwd, target))}`);
    return;
  }

  log(markdown);
}

module.exports = { reportCommand, buildReport, renderMarkdown };
