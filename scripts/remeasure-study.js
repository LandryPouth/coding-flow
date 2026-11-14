#!/usr/bin/env node
"use strict";

// story-15-06: re-takes the Uncle Bob study's "How to tell it worked" measures
// (docs/plans/uncle-bob-gauntlet.md) from recorded runs, so the next
// re-measure is one command instead of a scratch script.
//
// Usage:
//   node scripts/remeasure-study.js --runs <dir> --since <YYYY-MM-DD>
//     [--root <repo>] [--dogfooding <file>] [--json]
//
// - `--runs` is a `.coding-flow/runs/` directory; only `*-verify.json` and
//   `*-review.json` dated on or after `--since` (from the file name) are read.
// - A story's intensity (QUICK / STANDARD / STRICT) is read from its epic's
//   `index.md` entry, else from the first marker in its own files, under
//   `--root` (default: the current directory).
// - Review passes are counted twice: the review files recorded, and the passes
//   a review's accepted-risk text states ("3 independent reviews + 1
//   alignment review"). A story whose proof was lost with its worktree and
//   re-recorded after land has one file for several passes; both numbers are
//   printed, never merged.
// - "Caught by verify" is a proxy: a red verify whose commands passed (a gate
//   failed: coverage, contrary signals, complexity), against the P1s reviews
//   recorded. A red verify whose commands failed is counted apart: it mixes
//   real reds and timing flakes.
// - `--dogfooding` (default `<root>/docs/DOGFOODING.md`): rows of the log
//   table dated on or after `--since`; a row is about worktrees when its
//   Surface column names one.

const fs = require("fs");
const path = require("path");

const INTENSITY = /\b(QUICK|STANDARD|STRICT)\b/;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const STATED_PASSES = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:(?:independent|strict|subagent|adversarial|fresh|alignment)\s+)*(?:reviews?|review passes)\b/gi;

function parseArgs(argv) {
  const opts = { root: process.cwd(), json: false };
  const names = { "--runs": "runs", "--since": "since", "--root": "root", "--dogfooding": "dogfooding" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") {
      opts.json = true;
    } else if (names[argv[i]] && argv[i + 1] !== undefined) {
      opts[names[argv[i]]] = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown or incomplete option: ${argv[i]}`);
    }
  }
  if (!opts.runs || !/^\d{4}-\d{2}-\d{2}$/.test(opts.since || "")) {
    throw new Error("usage: remeasure-study.js --runs <dir> --since <YYYY-MM-DD> [--root <repo>] [--dogfooding <file>] [--json]");
  }
  opts.dogfooding = opts.dogfooding || path.join(opts.root, "docs", "DOGFOODING.md");
  return opts;
}

function readRuns(dir, since) {
  const runs = { verify: [], review: [] };
  for (const name of fs.readdirSync(dir).sort()) {
    const match = name.match(/^(\d{4}-\d{2}-\d{2})T.*-(verify|review)\.json$/);
    if (!match || match[1] < since) continue;
    try {
      runs[match[2]].push({ file: name, ...JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) });
    } catch {
      // An unreadable run is skipped, not guessed.
    }
  }
  return runs;
}

function intensityOf(root, story) {
  if (!story) return "none";
  const storyName = path.basename(story);
  const index = path.join(root, path.dirname(story), "index.md");
  if (fs.existsSync(index)) {
    const lines = fs.readFileSync(index, "utf8").split("\n");
    const at = lines.findIndex((line) => line.includes(`**${storyName}**`));
    if (at >= 0) {
      const entry = [lines[at]];
      for (let i = at + 1; i < lines.length && !/^\d+\.\s|^#/.test(lines[i]); i += 1) entry.push(lines[i]);
      const found = entry.join(" ").match(INTENSITY);
      if (found) return found[1];
    }
  }
  for (const file of ["story.md", "spec.md", "plan.md"]) {
    const full = path.join(root, story, file);
    const found = fs.existsSync(full) && fs.readFileSync(full, "utf8").match(INTENSITY);
    if (found) return found[1];
  }
  return "unknown";
}

function statedPasses(text) {
  let total = 0;
  for (const match of String(text || "").matchAll(STATED_PASSES)) {
    total += NUMBER_WORDS[match[1].toLowerCase()] || Number(match[1]);
  }
  return total;
}

function storyRow(rows, story) {
  if (!rows.has(story)) {
    rows.set(story, { story, verifies: 0, verified: 0, gateReds: 0, commandReds: 0, reviewFiles: 0, statedPasses: 0, p1: 0, survivors: null });
  }
  return rows.get(story);
}

function addVerify(row, run) {
  row.verifies += 1;
  if (run.coverage && run.coverage.tier === "verified") row.verified += 1;
  if (run.ok === false && run.commandsOk === true) row.gateReds += 1;
  if (run.ok === false && run.commandsOk === false) row.commandReds += 1;
  const survived = run.mutation && Array.isArray(run.mutation.survived) ? run.mutation.survived.length : null;
  if (survived !== null) row.survivors = (row.survivors || 0) + survived;
}

function addReview(row, run) {
  row.reviewFiles += 1;
  row.statedPasses = Math.max(row.statedPasses, statedPasses(run.acceptedRisk));
  row.p1 += Number((run.findingCounts && run.findingCounts.p1) || 0);
}

function byStory(runs, root) {
  const rows = new Map();
  for (const run of runs.verify) addVerify(storyRow(rows, run.story || "(no story)"), run);
  // The same review captured twice (a re-record after a failed land) is one
  // review: same story, verdict, counts and text.
  const seen = new Set();
  for (const run of runs.review) {
    const key = JSON.stringify([run.story, run.verdict, run.findingCounts, run.acceptedRisk || ""]);
    if (seen.has(key)) continue;
    seen.add(key);
    addReview(storyRow(rows, run.story || "(no story)"), run);
  }
  for (const row of rows.values()) row.intensity = intensityOf(root, row.story === "(no story)" ? null : row.story);
  return [...rows.values()].sort((a, b) => a.story.localeCompare(b.story));
}

function tiers(verifies) {
  const counts = {};
  for (const run of verifies) {
    const tier = (run.coverage && run.coverage.tier) || "no tier";
    counts[tier] = (counts[tier] || 0) + 1;
  }
  return counts;
}

function dogfoodingRows(file, since) {
  if (!fs.existsSync(file)) return { total: 0, worktree: 0, worktreeOpen: 0, mentionsWorktree: 0, rows: [] };
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[1] || "") || cells[1] < since) continue;
    const worktree = /worktree/i.test(cells[3] || "");
    const open = /^open\b/i.test(cells[cells.length - 2] || "");
    const mentions = /worktree/i.test(cells.slice(4).join(" "));
    rows.push({ date: cells[1], surface: cells[3], worktree, mentions, open });
  }
  const worktreeRows = rows.filter((row) => row.worktree);
  return {
    total: rows.length,
    worktree: worktreeRows.length,
    worktreeOpen: worktreeRows.filter((row) => row.open).length,
    mentionsWorktree: rows.filter((row) => !row.worktree && row.mentions).length,
    rows: worktreeRows,
  };
}

function share(part, whole) {
  return whole ? Math.round((part / whole) * 1000) / 10 : null;
}

function measure(opts) {
  const runs = readRuns(opts.runs, opts.since);
  const stories = byStory(runs, opts.root);
  const reviewed = stories.filter((row) => row.reviewFiles > 0);
  const gateReds = stories.reduce((sum, row) => sum + row.gateReds, 0);
  const reviewP1 = stories.reduce((sum, row) => sum + row.p1, 0);
  const verifiedCount = runs.verify.filter((run) => run.coverage && run.coverage.tier === "verified").length;
  const green = runs.verify.filter((run) => run.ok === true).length;
  return {
    since: opts.since,
    verifies: { total: runs.verify.length, tiers: tiers(runs.verify), green, verifiedShare: share(verifiedCount, runs.verify.length), verifiedShareOfGreen: share(verifiedCount, green) },
    reviews: {
      files: runs.review.length,
      reviewers: runs.review.reduce((acc, run) => ({ ...acc, [run.reviewer || "unknown"]: (acc[run.reviewer || "unknown"] || 0) + 1 }), {}),
      stories: reviewed.map((row) => ({ story: path.basename(row.story), intensity: row.intensity, reviewFiles: row.reviewFiles, statedPasses: row.statedPasses, p1: row.p1 })),
    },
    catches: { gateReds, commandReds: stories.reduce((sum, row) => sum + row.commandReds, 0), reviewP1, verifyShare: share(gateReds, gateReds + reviewP1) },
    mutation: stories.filter((row) => row.survivors !== null).map((row) => ({ story: path.basename(row.story), survivors: row.survivors })),
    dogfooding: dogfoodingRows(opts.dogfooding, opts.since),
    stories,
  };
}

function percent(value) {
  return value === null ? "n/a" : `${value} %`;
}

function render(result) {
  const lines = [`Runs since ${result.since}`];
  const v = result.verifies;
  lines.push(`Verifies: ${v.total} (${v.green} green); at verified: ${v.tiers.verified || 0} (${percent(v.verifiedShare)} of all, ${percent(v.verifiedShareOfGreen)} of green); tiers ${JSON.stringify(v.tiers)}`);
  lines.push(`Reviews: ${result.reviews.files} file(s); reviewers ${JSON.stringify(result.reviews.reviewers)}`);
  for (const row of result.reviews.stories) {
    lines.push(`  ${row.intensity} ${row.story}: ${row.reviewFiles} review file(s), ${row.statedPasses || "no"} pass(es) stated, ${row.p1} P1`);
  }
  const c = result.catches;
  lines.push(`Caught by a verify gate: ${c.gateReds}; P1 recorded by review: ${c.reviewP1}; verify share ${percent(c.verifyShare)}; red on commands (incl. flakes): ${c.commandReds}`);
  lines.push(result.mutation.length
    ? `Mutation survivors: ${result.mutation.map((row) => `${row.story} ${row.survivors}`).join(", ")}`
    : "Mutation survivors: no verify ran the probe");
  const d = result.dogfooding;
  lines.push(`DOGFOODING rows: ${d.total}; about worktrees: ${d.worktree} (${d.worktreeOpen} open); other rows naming a worktree: ${d.mentionsWorktree}`);
  return lines.join("\n") + "\n";
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = measure(opts);
    process.stdout.write(opts.json ? JSON.stringify(result, null, 2) + "\n" : render(result));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}

module.exports = { measure, statedPasses };
