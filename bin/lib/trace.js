"use strict";

// `ai-flow trace` : la chaîne complète story ↔ commits ↔ PR ↔ évidence ↔ tests.
// Répond en une commande à « montre-moi que cette exigence est réellement livrée
// ET vérifiée ». Différenciateur vs les outils de spec (Spec Kit, BMAD) : eux
// spécifient, trace PROUVE la livraison. Pur lecture, best-effort, non-fatal.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { cwd } = require("./context");
const { log, normalizePortable, toPortable } = require("./util");
const { getStorage } = require("./storage");
const { readConfig } = require("./config");
const { collectAll } = require("./audit");

function gitLines(args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Table markdown sous "## Acceptance Traceability" : chaque ligne de données mappe
// un critère d'acceptation à un test (`file::test`).
function parseTraceabilityTable(md) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Acceptance Traceability/i.test(line.trim()));

  if (start === -1) {
    return [];
  }

  const tableRows = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("## ")) {
      break;
    }
    if (trimmed.startsWith("|")) {
      tableRows.push(trimmed.split("|").slice(1, -1).map((cell) => cell.trim()));
    }
  }

  // Ligne 0 = en-tête ; on retire aussi les séparateurs (--- / :---:).
  const data = tableRows
    .slice(1)
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell) || cell === ""));

  return data.map((cells) => {
    const criterion = cells[0] || "";
    const test = (cells[1] || "").replace(/`/g, "").trim();
    return { criterion, test, mapped: Boolean(criterion) && Boolean(test) };
  });
}

// PR liée, best-effort : la branche nommée d'après le dossier de la story (même
// convention sans état que `worktree add --story` / `status`). gh absent → null.
function prForBranch(branch) {
  if (!branch) {
    return null;
  }
  try {
    const raw = execFileSync("gh", ["pr", "view", branch, "--json", "number,url,state"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(raw);
    return typeof parsed.number === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function buildChain(storyRel, ancestry) {
  const storyDir = path.resolve(cwd, storyRel);
  const exists = fs.existsSync(storyDir) && fs.statSync(storyDir).isDirectory();
  const chain = {
    story: normalizePortable(storyRel),
    exists,
    criteria: [],
    commands: [],
    commits: [],
    pr: null,
    evidence: null,
    gaps: [],
  };

  if (!exists) {
    chain.gaps.push("story directory not found");
    return chain;
  }

  // story → tests (traçabilité + commandes)
  const testsPath = path.join(storyDir, "tests.md");
  if (fs.existsSync(testsPath)) {
    chain.criteria = parseTraceabilityTable(fs.readFileSync(testsPath, "utf8"));
  } else {
    chain.gaps.push("no tests.md");
  }

  const unmapped = chain.criteria.filter((row) => !row.mapped);
  if (chain.criteria.length === 0) {
    chain.gaps.push("no acceptance traceability rows");
  } else if (unmapped.length > 0) {
    chain.gaps.push(`${unmapped.length} criterion/criteria without a mapped test`);
  }

  // story → commits (qui touchent le dossier de la story)
  chain.commits = gitLines(["log", "--oneline", "-n", "20", "--", storyRel]);
  if (chain.commits.length === 0) {
    chain.gaps.push("no commits touch this story");
  }

  // story → PR (branche nommée d'après la story)
  chain.pr = prForBranch(path.basename(storyRel));

  // story → évidence (dernier verify du registre pour cette story)
  const verifyEntries = ancestry.filter(
    (entry) => entry.type === "verify" && entry.story === normalizePortable(storyRel),
  );
  chain.evidence = verifyEntries.length > 0 ? verifyEntries[verifyEntries.length - 1] : null;

  if (!chain.evidence) {
    chain.gaps.push("no verify evidence recorded");
  } else if (!chain.evidence.ok) {
    chain.gaps.push("latest verify evidence is red");
  }

  return chain;
}

function discoverStories() {
  const storage = getStorage(cwd, readConfig(cwd));
  const stories = [];
  for (const epic of storage.listEpics()) {
    for (const story of epic.stories) {
      stories.push(story.path);
    }
  }
  return stories;
}

function printChain(chain) {
  log(chain.story + (chain.exists ? "" : " (missing)"));

  log(`  tests    : ${chain.criteria.length} criterion/criteria, ${chain.criteria.filter((c) => c.mapped).length} mapped to a test`);
  for (const row of chain.criteria) {
    log(`    ${row.mapped ? "✓" : "✗"} ${row.criterion || "(empty)"}${row.test ? ` → ${row.test}` : ""}`);
  }

  log(`  commits  : ${chain.commits.length}`);
  for (const commit of chain.commits.slice(0, 5)) {
    log(`    ${commit}`);
  }

  log(`  pr       : ${chain.pr ? `#${chain.pr.number} (${chain.pr.state || "?"}) ${chain.pr.url || ""}` : "—"}`);

  if (chain.evidence) {
    log(`  evidence : ${chain.evidence.ok ? "✅" : "❌"} ${chain.evidence.summary} @ ${chain.evidence.commit || "?"}`);
  } else {
    log("  evidence : —");
  }

  if (chain.gaps.length > 0) {
    log("  gaps     :");
    for (const gap of chain.gaps) {
      log(`    - ${gap}`);
    }
  }

  log("");
}

function trace({ json = false, story = null } = {}) {
  const ancestry = collectAll(cwd);
  const storyRels = story ? [toPortable(story)] : discoverStories();

  const chains = storyRels.map((storyRel) => buildChain(storyRel, ancestry));

  if (json) {
    log(JSON.stringify({ stories: chains }, null, 2));
    return;
  }

  if (chains.length === 0) {
    log("No stories found. Create one under epics/ or pass --story <dir>.");
    return;
  }

  for (const chain of chains) {
    printChain(chain);
  }

  const fullyProven = chains.filter((chain) => chain.exists && chain.gaps.length === 0).length;
  log(`Traceable & proven: ${fullyProven}/${chains.length} story/stories with no gaps.`);
}

function traceCommand({ getFlagValue, flags }) {
  trace({ json: flags.has("--json"), story: getFlagValue("--story", null) });
}

module.exports = { traceCommand, parseTraceabilityTable, buildChain };
