"use strict";

// Contract tests for the backbone/dependency-tree parser (bin/lib/backbone.js).
// Fixtures mirror the real shapes found in the wild (docs/DOGFOODING.md,
// 2026-08-27): bethl epic-18's flat two-chain shape, epic-19's flat single
// chain, and this repo's own epic-02 indented branching tree.

const { test } = require("node:test");
const assert = require("node:assert");

const { parseBackbone, labelForDir, dirForLabel } = require("../bin/lib/backbone");

// Mirrors real epics: `## Backbone` (with its fenced tree, no subheading
// required — bethl's actual epic-18/19 have none) comes before `## Stories`.
function indexMd({ stories, tree }) {
  const storiesList = stories.map((dir, i) => `${i + 1}. **${dir}** — does a thing.`).join("\n");
  const backboneSection = tree
    ? `## Backbone\n\n\`Backbone: a journey\`\n\n\`\`\`text\n${tree}\n\`\`\`\n\n`
    : "";
  return `# Epic\n\n${backboneSection}## Stories\n\n${storiesList}\n`;
}

test("no dependency tree: every story is one plain chain", () => {
  const dirs = ["story-19-01-a", "story-19-02-b", "story-19-03-c", "story-19-04-d"];
  const { chainId, hasTree } = parseBackbone(indexMd({ stories: dirs, tree: null }));

  assert.equal(hasTree, false);
  assert.equal(chainId.get("s1"), "s1");
  assert.equal(chainId.get("s2"), "s1");
  assert.equal(chainId.get("s3"), "s1");
  assert.equal(chainId.get("s4"), "s1");
});

test("flat chain-per-line: a straight chain stays one chain", () => {
  const dirs = ["story-19-01-a", "story-19-02-b", "story-19-03-c", "story-19-04-d"];
  const { chainId } = parseBackbone(indexMd({ stories: dirs, tree: "s1 ── s2 ── s3 ── s4" }));

  assert.equal(chainId.get("s1"), "s1");
  assert.equal(chainId.get("s2"), "s1");
  assert.equal(chainId.get("s3"), "s1");
  assert.equal(chainId.get("s4"), "s1");
});

test("flat chain-per-line: two lines are two independent parallel chains", () => {
  const dirs = ["story-18-01-a", "story-18-02-b", "story-18-03-c", "story-18-04-d", "story-18-05-e"];
  const { chainId } = parseBackbone(
    indexMd({ stories: dirs, tree: "s1 ── s2\ns3 ── s4 ── s5" }),
  );

  assert.equal(chainId.get("s1"), "s1");
  assert.equal(chainId.get("s2"), "s1");
  assert.equal(chainId.get("s3"), "s3");
  assert.equal(chainId.get("s4"), "s3");
  assert.equal(chainId.get("s5"), "s3");
  assert.notEqual(chainId.get("s1"), chainId.get("s3"));
});

test("indented tree: a branch point starts a new chain per child", () => {
  const dirs = ["story-02-01-a", "story-02-02-b", "story-02-03-c", "story-02-04-d"];
  const tree = "s1\n└── s2\n    ├── s3\n    └── s4";
  const { chainId } = parseBackbone(indexMd({ stories: dirs, tree }));

  assert.equal(chainId.get("s1"), "s1");
  assert.equal(chainId.get("s2"), "s1", "s2 is a pure continuation of s1 (s1's only child)");
  assert.equal(chainId.get("s3"), "s3", "s3 is one of s2's two children: a new parallel chain");
  assert.equal(chainId.get("s4"), "s4", "s4 is the other of s2's two children: a different new chain");
});

test("an explicit ### Story dependency tree subheading (epic-02's own shape) still works", () => {
  const dirs = ["story-02-01-a", "story-02-02-b", "story-02-03-c", "story-02-04-d"];
  const withSubheading =
    "## Backbone\n\n`Backbone: a journey`\n\n### Story dependency tree\n\n```text\n" +
    "s1\n└── s2\n    ├── s3\n    └── s4\n```\n\n## Stories\n\n" +
    dirs.map((dir, i) => `${i + 1}. **${dir}** — does a thing.`).join("\n") +
    "\n";
  const { chainId } = parseBackbone(withSubheading);

  assert.equal(chainId.get("s2"), "s1");
  assert.equal(chainId.get("s3"), "s3");
  assert.equal(chainId.get("s4"), "s4");
});

test("mixed paragraphs in one fenced block: an indented pair plus a separate flat root (epic-03's own shape)", () => {
  const dirs = ["story-03-01-a", "story-03-02-b", "story-03-03-c"];
  const tree = "s1\n└── s2\n\ns3";
  const { chainId } = parseBackbone(indexMd({ stories: dirs, tree }));

  assert.equal(chainId.get("s1"), "s1");
  assert.equal(chainId.get("s2"), "s1", "s2 continues s1's chain");
  assert.equal(chainId.get("s3"), "s3", "s3 is its own independent chain, parallel to s1/s2");
});

test("a consolidation/merge point (more than one parent) fails loudly, not silently", () => {
  const dirs = ["story-x-01-a", "story-x-02-b", "story-x-03-c", "story-x-04-d", "story-x-05-e"];
  const tree = "s1\n├── s2 ──┐\n├── s3 ──┤\n└── s4 ──┴── s5";

  assert.throws(() => parseBackbone(indexMd({ stories: dirs, tree })), /consolidation|merge/);
});

test("a dependency tree referencing a label outside ## Stories fails loudly", () => {
  const dirs = ["story-x-01-a", "story-x-02-b"];
  const tree = "s1 ── s2 ── s3";

  assert.throws(() => parseBackbone(indexMd({ stories: dirs, tree })), /outside ## Stories/);
});

test("labelForDir / dirForLabel round-trip", () => {
  const dirs = ["story-03-01-a", "story-03-02-b", "story-03-03-c"];

  assert.equal(labelForDir(dirs, "story-03-02-b"), "s2");
  assert.equal(dirForLabel(dirs, "s3"), "story-03-03-c");
  assert.equal(labelForDir(dirs, "story-nope"), null);
  assert.equal(dirForLabel(dirs, "s99"), null);
});
