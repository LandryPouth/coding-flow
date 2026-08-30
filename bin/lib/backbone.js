"use strict";

// Parses an epic's `## Stories` list and its optional `### Story dependency
// tree` (both written by `/flow-plan`, see `skills/flow-plan/SKILL.md`) into
// a chain graph: which stories are a straight sequential build-on (same
// chain, same worktree) and which are parallel siblings (different chains,
// separate worktrees). Pure text in, pure data out — no I/O, no git.
//
// Two dependency-tree shapes are in real use (see docs/DOGFOODING.md,
// 2026-08-27): the indented box-drawing tree `flow-plan`'s own contract
// documents (`s1\n└── s2\n    ├── s3\n    └── s4`), and a flatter
// chain-per-line shape actually authored in practice
// (`s1 ── s2\ns3 ── s4 ── s5`). Both are supported. A consolidation/merge
// point (a story with more than one parent) is not: `worktree-plan.js`'s
// placement decision has no way to represent "wait for two chains, then
// continue on neither" yet, so a merge shape fails loudly here rather than
// guessing a placement — the same principle epic-02's `land` conflict-stop
// already applies to a real git conflict.

const STORIES_HEADING = /^##\s+Stories\s*$/i;
const BACKBONE_HEADING = /^##\s+Backbone\s*$/im;

// `## Stories` is a numbered list; position in it IS the `s<N>` label
// (`flow-plan`'s own convention — see SKILL.md: "the short s<number> label,
// matching the numbered ## Stories list"). Index 0 -> s1, index 1 -> s2, ...
function parseStoryDirs(indexMdText) {
  const lines = indexMdText.split(/\r?\n/);
  const start = lines.findIndex((line) => STORIES_HEADING.test(line.trim()));

  if (start === -1) {
    return [];
  }

  const dirs = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      break;
    }
    const match = lines[i].match(/^\d+\.\s+\*\*([^*]+)\*\*/);
    if (match) {
      dirs.push(match[1].trim());
    }
  }
  return dirs;
}

function labelForDir(storyDirs, dir) {
  const index = storyDirs.indexOf(dir);
  return index === -1 ? null : `s${index + 1}`;
}

function dirForLabel(storyDirs, label) {
  const index = Number(String(label).slice(1)) - 1;
  return Number.isInteger(index) && index >= 0 ? storyDirs[index] || null : null;
}

// The first fenced code block found under `## Backbone`, before the next
// top-level (`##`) heading. Deliberately not anchored to a `### Story
// dependency tree` subheading: `flow-plan`'s own SKILL.md says the tree goes
// "directly under the Backbone line," and real epics follow that literally
// rather than adding the subheading — bethl's epic-18/epic-19 (the two
// epics that motivated this parser, see docs/DOGFOODING.md 2026-08-27) have
// no such subheading at all. A `###` subheading in between (this repo's own
// epic-02/epic-03) is transparently part of the same Backbone section, so it
// does not change what gets matched. Null means the epic has no tree — a
// plain chain, per `flow-plan`'s own convention of omitting it when there is
// nothing to branch.
function extractTreeBlock(indexMdText) {
  const backboneMatch = indexMdText.match(BACKBONE_HEADING);
  if (!backboneMatch) {
    return null;
  }

  const afterBackbone = indexMdText.slice(indexMdText.indexOf(backboneMatch[0]) + backboneMatch[0].length);
  const nextTopHeadingMatch = afterBackbone.match(/^##\s+\S/m);
  const scope = nextTopHeadingMatch ? afterBackbone.slice(0, nextTopHeadingMatch.index) : afterBackbone;

  const fenceMatch = scope.match(/```[^\n]*\n([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1] : null;
}

function implicitChainEdges(storyCount) {
  const edges = [];
  for (let i = 1; i < storyCount; i += 1) {
    edges.push({ from: `s${i}`, to: `s${i + 1}` });
  }
  return edges;
}

// `s1 ── s2` / `s3 ── s4 ── s5`: one chain per line, tokens in order. Lines
// are independent of each other (separate parallel chains).
function parseFlat(lines) {
  const edges = [];
  for (const line of lines) {
    const tokens = line.match(/s\d+/g) || [];
    for (let i = 0; i < tokens.length - 1; i += 1) {
      edges.push({ from: tokens[i], to: tokens[i + 1] });
    }
  }
  return edges;
}

// `s1\n└── s2\n    ├── s3\n    └── s4`: depth is a stack of "the node
// currently active at each indentation level," 4 characters (a space group
// or `│   `) per level. A merge target (`┴──`) or a line resolving to more
// than one label is rejected upstream, before this ever runs.
function parseIndented(lines) {
  const rootMatch = lines[0].trim().match(/^(s\d+)$/);
  if (!rootMatch) {
    throw new Error(
      `dependency tree's first line must be a single story label (e.g. "s1"), got: "${lines[0].trim()}"`,
    );
  }

  const stack = [rootMatch[1]];
  const edges = [];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const connectorIndex = line.search(/[├└]──/);
    if (connectorIndex === -1) {
      throw new Error(`dependency tree line has no recognizable connector: "${line}"`);
    }

    const depth = Math.floor(line.slice(0, connectorIndex).length / 4);
    const remainder = line.slice(connectorIndex).replace(/^[├└]──\s*/, "");
    const tokens = remainder.match(/s\d+/g) || [];

    if (tokens.length !== 1) {
      throw new Error(`dependency tree line does not resolve to exactly one story label: "${line}"`);
    }

    const parent = stack[depth];
    if (!parent) {
      throw new Error(`dependency tree line is indented deeper than its parent allows: "${line}"`);
    }

    edges.push({ from: parent, to: tokens[0] });
    stack[depth + 1] = tokens[0];
    stack.length = depth + 2;
  }

  return edges;
}

// Every `s<N>` token that literally appears in the tree text, regardless of
// shape or whether it takes part in an edge — a standalone single-story
// paragraph (epic-03's own `s3`, mentioned but with no edges) counts as
// "mentioned" too. Used to validate `## Stories` against the tree in both
// directions before any edge is trusted.
function extractMentionedLabels(treeText) {
  return new Set(treeText.match(/s\d+/g) || []);
}

// A tree and a `## Stories` list are two independently hand-maintained
// pieces of the same epic file — nothing stops them drifting apart (a story
// added to one and forgotten in the other). Checked in both directions
// before any edge is trusted, so a bad reference fails loudly instead of
// silently guessing a placement (the same principle a merge point or an
// out-of-range edge already gets): a label the tree mentions that is not a
// real story, and — the gap a prior review missed — a real story the tree
// never mentions at all, which would otherwise fall through to `parents.length
// === 0` in `buildChainIds` and get silently placed as its own lone chain,
// indistinguishable from a label genuinely authored as standalone.
function validateAgainstStories(treeText, labels) {
  const mentioned = extractMentionedLabels(treeText);
  const validLabels = new Set(labels);

  const outside = [...mentioned].find((label) => !validLabels.has(label));
  if (outside) {
    throw new Error(`dependency tree references a story label outside ## Stories: "${outside}"`);
  }

  const missing = labels.filter((label) => !mentioned.has(label));
  if (missing.length > 0) {
    throw new Error(
      `## Stories includes ${missing.length === 1 ? "a story" : "stories"} the dependency tree never mentions: ` +
        `${missing.join(", ")} — add ${missing.length === 1 ? "it" : "them"} to the tree (even as its own ` +
        "standalone line) rather than leaving placement to guess where it belongs.",
    );
  }
}

function parseEdges(treeText) {
  if (/[┴┤]/.test(treeText)) {
    throw new Error(
      "dependency tree contains a consolidation/merge point (┴ or ┤) — not supported for automatic " +
        "placement yet; place these stories manually with `ai-flow worktree add --story <dir>`.",
    );
  }

  // Blank-line-separated paragraphs are independent sub-trees (e.g. a
  // branching chain plus a lone parallel root, as in epic-03's own tree) —
  // format is detected per paragraph, not for the whole block, so mixing an
  // indented paragraph with a single-token flat one in the same fenced block
  // parses correctly instead of one format's rules leaking into the other.
  const paragraphs = treeText
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.split(/\r?\n/).filter((line) => line.trim().length > 0))
    .filter((lines) => lines.length > 0);

  const edges = [];
  for (const lines of paragraphs) {
    const indented = lines.some((line) => /[├└│]/.test(line));
    edges.push(...(indented ? parseIndented(lines) : parseFlat(lines)));
  }
  return edges;
}

// A chain id per label: the root of the straight 1-to-1 path the label sits
// on. A branch point (a parent with more than one child) starts a new chain
// for each child. `storyLabels` must already be in topological order —
// `## Stories` position already guarantees this by convention (a later
// story only ever builds on an earlier one) — but the tree text is
// hand-authored separately and nothing stops an edge from being typed
// backwards (`s2 ── s1` instead of `s1 ── s2`). Left unchecked, the chainId
// loop below looks up `chainId.get(parent)` before `parent` has necessarily
// been visited, silently producing `undefined` for the child instead of
// failing — exactly the "guess a placement" failure this parser exists to
// avoid. Checked explicitly before any edge is trusted, same principle as
// `validateAgainstStories`.
function validateEdgeOrder(edges, storyLabels) {
  const indexOf = new Map(storyLabels.map((label, i) => [label, i]));
  for (const { from, to } of edges) {
    if (indexOf.get(from) >= indexOf.get(to)) {
      throw new Error(
        `dependency tree edge "${from} -> ${to}" is out of order — "${to}" must come after "${from}" in ` +
          "## Stories (a later story only ever builds on an earlier one); check the tree for a reversed edge.",
      );
    }
  }
}

function buildChainIds(edges, storyLabels) {
  validateEdgeOrder(edges, storyLabels);

  const parentsOf = new Map();
  const childrenOf = new Map();
  for (const label of storyLabels) {
    parentsOf.set(label, []);
    childrenOf.set(label, []);
  }

  // Every edge's `from`/`to` is guaranteed to be a valid story label here —
  // `parseBackbone` already ran `validateAgainstStories` against the same
  // tree text edges are parsed from, before this function is ever called.
  for (const { from, to } of edges) {
    parentsOf.get(to).push(from);
    childrenOf.get(from).push(to);
  }

  for (const label of storyLabels) {
    if (parentsOf.get(label).length > 1) {
      throw new Error(
        `story "${label}" has more than one parent in the dependency tree — consolidation/merge points ` +
          "are not supported for automatic placement.",
      );
    }
  }

  const chainId = new Map();
  for (const label of storyLabels) {
    const parents = parentsOf.get(label);
    if (parents.length === 0) {
      chainId.set(label, label);
      continue;
    }
    const parent = parents[0];
    const parentIsPureContinuation = childrenOf.get(parent).length === 1;
    chainId.set(label, parentIsPureContinuation ? chainId.get(parent) : label);
  }

  return chainId;
}

// Parses an epic's index.md into { storyDirs, edges, chainId, hasTree }.
// `chainId` maps every `s<N>` label to its chain's root label — two stories
// with the same chain id share a location; two different chain ids are
// parallel siblings.
function parseBackbone(indexMdText) {
  const storyDirs = parseStoryDirs(indexMdText);
  const labels = storyDirs.map((_, i) => `s${i + 1}`);
  const treeText = extractTreeBlock(indexMdText);

  if (treeText) {
    validateAgainstStories(treeText, labels);
  }

  const edges = treeText ? parseEdges(treeText) : implicitChainEdges(storyDirs.length);
  const chainId = buildChainIds(edges, labels);

  return { storyDirs, labels, edges, chainId, hasTree: Boolean(treeText) };
}

module.exports = { parseBackbone, parseStoryDirs, labelForDir, dirForLabel };
