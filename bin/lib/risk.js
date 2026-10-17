"use strict";

// How risky a change is: read from the story text, from structural git signals
// in the added lines, and from the diff's paths, then combined. Prose alone
// caps at medium; the diff decides.

const { cwd } = require("./context");
const { readStoryBundle } = require("./story");
const { matchesPattern } = require("./util");
const { defaultTestGlobs, defaultHighRiskPaths } = require("./harness-config");
const { changedFilesForCoverage, addedLinesByFile } = require("./diff-scope");

// Whole words only. A naked `includes` made "auth" fire on "author", "token" on
// "design tokens", and "migration" on a story titled "color migration" — terms
// are configurable, so the pattern is escaped before it becomes a regex.
function mentionsTerm(text, term) {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

// Prose is a weak signal and it tops out at `medium` on purpose. A story names
// what it is *near* as readily as what it changes — "does not touch auth", a
// list of files, an acceptance criterion — so scanning it for scary words
// escalated 39 of 39 real stories to STRICT and left `scoreDiffRisk` unable to
// matter. Only the diff can reach `high`; the story can still raise a quiet
// change to `medium` (the coverage gate keeps firing), never to STRICT ceremony.
function scoreStoryRisk(storyText, config) {
  const matchedTerms = config.highRiskTerms.filter((term) => mentionsTerm(storyText, term));
  const mediumTerms = ["api", "crud", "form", "persistence", "integration", "config", "settings"]
    .filter((term) => mentionsTerm(storyText, term));

  if (matchedTerms.length > 0) {
    return {
      level: "medium",
      matchedTerms,
      reason:
        "Security-sensitive terms appear in the story text. Wording alone does not prove the " +
        "change reaches a trust boundary — the diff decides that.",
    };
  }

  if (mediumTerms.length > 0) {
    return {
      level: "medium",
      matchedTerms: mediumTerms,
      reason: "Integration or persistence terms were found.",
    };
  }

  return {
    level: "low",
    matchedTerms: [],
    reason: "No high-risk terms found.",
  };
}

// story-04-03: unconditional git-mutation calls added to a changed, non-test
// file — the same territory epic-03's own rationale already names as risky
// (deletes worktrees/branches, merges unattended) even when no path or prose
// term says "auth"/"payment"/"migration". Each pattern requires the call to be
// wrapped in this project's own `git(root, [...])` helper shape (see
// `worktree.js`'s `git()`), matching the exact call convention the real
// story-03-02 bug used — a bounded text signal, not a generic shell-command
// scanner.
const STRUCTURAL_GIT_SIGNALS = [
  { name: "git worktree remove", pattern: /\bgit\s*\([^;]*?\[\s*["'`]worktree["'`]\s*,\s*["'`]remove["'`]/ },
  { name: "git branch -D/-f (force branch delete)", pattern: /\bgit\s*\([^;]*?\[\s*["'`]branch["'`]\s*,\s*["'`]-[DdFf]["'`]/ },
  { name: "git reset --hard", pattern: /\bgit\s*\([^;]*?\[\s*["'`]reset["'`]\s*,\s*["'`]--hard["'`]/ },
  { name: "git merge", pattern: /\bgit\s*\([^;]*?\[\s*["'`]merge["'`]/ },
];

// A call already passing `{ allowFail: true }` (this project's own converted
// pattern, post story-03-02) returns a result instead of exiting the process —
// it is not "unattended" the way a default-path call is, so it must not be
// flagged. Checked over the specific call's own span (see `callSpanText`), not
// an arbitrary window of surrounding text — an `allowFail: true` belonging to a
// neighboring call on the same or an adjacent line must not leak onto a
// different, genuinely-unguarded call.
function isGuardedWindow(windowText) {
  return /allowFail\s*:\s*true/.test(windowText);
}

// How many lines a single `git(...)` call's own span is allowed to run over
// before the guard check gives up looking for its matching close paren. Real
// call sites in this project fit in 1-2 lines, but the guard check must not
// silently truncate a genuinely longer call and read that truncation as
// "unguarded" — a false positive the structural signal must never produce
// (see `scanStructuralGitSignals`). Generous on purpose: this only bounds a
// single call's own text, not how far the file is scanned overall.
const GUARD_SPAN_MAX_LINES = 20;

// Returns the text of the balanced-parens call starting at `matchStart` (the
// index of a `git` identifier) — i.e. `git(...)` up to its own matching close
// paren, not whatever text happens to follow it in a wider window. This is what
// scopes the `allowFail: true` guard check to the one call it actually guards:
// two `git(...)` calls on the same line, one guarded and one not, must not
// contaminate each other.
function callSpanText(text, matchStart) {
  const openIdx = text.indexOf("(", matchStart);
  if (openIdx === -1) return text.slice(matchStart);
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(matchStart, i + 1);
    }
  }
  return text.slice(matchStart);
}

// Non-test, non-doc files only: a mutation call rehearsed inside a test file
// is expected there (it is what proves the real call site is safe), not a
// production diff to escalate.
function structuralRiskCandidateFiles(changedFiles, config) {
  const testGlobs = Array.isArray(config.testGlobs) ? config.testGlobs : defaultTestGlobs();
  return changedFiles.filter(
    (file) =>
      /\.(js|mjs|cjs|ts)$/i.test(file) && !testGlobs.some((pattern) => matchesPattern(file, pattern)),
  );
}

function scanStructuralGitSignals(changedFiles, config, root) {
  const candidates = structuralRiskCandidateFiles(changedFiles, config);
  if (candidates.length === 0) return [];

  const addedByFile = addedLinesByFile(root, candidates);
  const matches = [];

  for (const [file, lines] of addedByFile) {
    for (let i = 0; i < lines.length; i += 1) {
      const window = lines.slice(i, i + 3).join("\n");
      // Separate from `window` above: `window` only needs to be wide enough
      // to recognize a multi-line call's own opening shape (`git(\n  root,\n
      // [...`). The guard check needs to see the call's own matching close
      // paren wherever it actually falls, which can be further away than the
      // 3-line signature window — capping the guard's own text to `window`
      // would truncate `callSpanText`'s balanced-parens walk mid-call and let
      // an `allowFail: true` sitting just past line 3 read as "not found",
      // false-flagging an already-guarded call as unguarded. `spanWindow`
      // shares the same starting text as `window` (both begin at line `i`),
      // so a `match.index` found in `window` is still valid inside it.
      const spanWindow = lines.slice(i, i + GUARD_SPAN_MAX_LINES).join("\n");
      for (const signal of STRUCTURAL_GIT_SIGNALS) {
        const re = new RegExp(signal.pattern.source, "g");
        let match;
        while ((match = re.exec(window))) {
          // Only accept a match that starts on this window's own first line
          // (offset 0) — otherwise the same call gets re-matched again from an
          // earlier iteration's window and reported once per overlapping
          // window instead of once.
          const offset = window.slice(0, match.index).split("\n").length - 1;
          if (offset !== 0) continue;
          const span = callSpanText(spanWindow, match.index);
          if (isGuardedWindow(span)) continue;
          matches.push({ file, signal: signal.name, line: lines[i].trim() });
        }
      }
    }
  }

  return matches;
}

// Risk read from the diff itself. Independent of any prose, so it holds on a
// change with no story at all — which is also what lets the proof layer work
// outside `epics/`. `root` defaults to this module's own `cwd` like the rest of
// harness.js's `root`-parameterized functions (see `harnessConfigPath`) — every
// existing call site already runs against a real checkout, so this only widens
// what a caller scoring a DIFFERENT worktree (`status.js`, `worktree-plan.js`)
// can pass.
function scoreDiffRisk(changedFiles, config, root = cwd) {
  const patterns = Array.isArray(config.highRiskPaths) ? config.highRiskPaths : defaultHighRiskPaths();
  const matchedPaths = changedFiles.filter((file) =>
    patterns.some((pattern) => matchesPattern(file, pattern)),
  );
  const structuralMatches = scanStructuralGitSignals(changedFiles, config, root);

  if (matchedPaths.length === 0 && structuralMatches.length === 0) {
    return { level: "low", matchedPaths: [], structuralSignals: [], reason: "no sensitive path in the diff." };
  }

  const reasons = [];
  if (matchedPaths.length > 0) {
    reasons.push(`the diff touches ${matchedPaths.slice(0, 3).join(", ")}${matchedPaths.length > 3 ? ", …" : ""}`);
  }
  if (structuralMatches.length > 0) {
    const named = structuralMatches
      .slice(0, 3)
      .map((m) => `an unguarded ${m.signal} in ${m.file}`)
      .join("; ");
    reasons.push(`${named}${structuralMatches.length > 3 ? "; …" : ""}`);
  }

  return {
    level: "high",
    matchedPaths,
    structuralSignals: structuralMatches,
    reason: `${reasons.join("; ")}.`,
  };
}

const RISK_RANK = { low: 0, medium: 1, high: 2 };

// The higher of the two wins, and both reasons are kept. A story that undersells
// what it touches cannot lower the score below what the files say; a story that
// declares a risk the paths do not show still counts, because intent the author
// stated is evidence too.
function combineRisk(storyRisk, diffRisk) {
  const storyWins = RISK_RANK[storyRisk.level] >= RISK_RANK[diffRisk.level];
  const winner = storyWins ? storyRisk : diffRisk;

  return {
    level: winner.level,
    source: storyWins ? (diffRisk.level === winner.level ? "story and diff" : "story") : "diff",
    matchedTerms: storyRisk.matchedTerms || [],
    matchedPaths: diffRisk.matchedPaths || [],
    reason:
      diffRisk.level === "high" && !storyWins
        ? `Sensitive paths changed: ${diffRisk.reason}`
        : winner.reason,
  };
}

// The story text and the diff, scored the way the coverage gate scores them.
function scoreCombinedRisk({ storyDir, config }) {
  const storyRisk = storyDir
    ? scoreStoryRisk(Object.values(readStoryBundle(storyDir)).join("\n"), config)
    : { level: "low", matchedTerms: [], reason: "no story to read." };

  return combineRisk(storyRisk, scoreDiffRisk(changedFilesForCoverage(), config));
}

module.exports = {
  scoreStoryRisk,
  scoreDiffRisk,
  combineRisk,
  scoreCombinedRisk,
};
