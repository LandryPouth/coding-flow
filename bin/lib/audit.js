"use strict";

// `ai-flow audit` : agrège les évidences éparses (.coding-flow/runs/*.json) en un
// registre durable et exportable. Le ledger (.coding-flow/ledger.jsonl) est
// APPEND-ONLY — une ligne JSON par run, jamais réécrite : c'est la garantie
// d'intégrité (on n'efface pas l'historique de vérification). L'export docs/AUDIT.md
// est l'artefact qu'on montre à la compliance ; `--check` est le gate CI
// « pas de merge sans dernière évidence verte ».

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { cwd } = require("./context");
const { log, normalizePortable } = require("./util");

function runsDir(root) {
  return path.join(root, ".coding-flow", "runs");
}

function ledgerPath(root) {
  return path.join(root, ".coding-flow", "ledger.jsonl");
}

function auditExportPath(root) {
  return path.join(root, "docs", "AUDIT.md");
}

// Transforme un fichier de run en entrée de ledger. id = hash du contenu : deux
// passes sur le même run donnent le même id, donc pas de doublon.
function entryFromRunFile(file, root) {
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  const id = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  const type = file.endsWith("-verify.json") ? "verify" : "evidence";
  const git = data.provenance && data.provenance.git ? data.provenance.git : null;

  const ok =
    type === "verify"
      ? Boolean(data.ok)
      : Boolean(data.validation && data.validation.harnessCheck === "pass");

  let summary;
  if (type === "verify") {
    const count = data.commandsFound != null ? data.commandsFound : (data.results || []).length;
    summary = `${count} command(s) ${ok ? "passed" : "FAILED"} (${data.commandSource || "n/a"})`;
  } else {
    summary = `harness ${ok ? "pass" : "fail"}${data.risk ? `, risk ${data.risk.level}` : ""}`;
  }

  return {
    id,
    file: normalizePortable(path.relative(root, file)),
    type,
    generatedAt: data.generatedAt || null,
    ok,
    story: data.story || null,
    commandSource: data.commandSource || null,
    commit: git ? git.shortCommit || git.commit || null : null,
    branch: git ? git.branch || null : null,
    author: git && git.author ? git.author.name || null : null,
    summary,
  };
}

function collectRunEntries(root) {
  const dir = runsDir(root);

  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = [];

  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith("-verify.json") && !name.endsWith("-evidence.json")) {
      continue;
    }
    try {
      entries.push(entryFromRunFile(path.join(dir, name), root));
    } catch {
      // Un run illisible n'invalide pas le registre : on l'ignore.
    }
  }

  return entries;
}

function readLedger(root) {
  const file = ledgerPath(root);

  if (!fs.existsSync(file)) {
    return [];
  }

  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
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

// Union ledger + runs, dédupliquée par id, triée par date. Vue de lecture, ne
// mute rien.
function collectAll(root) {
  const byId = new Map();

  for (const entry of readLedger(root)) {
    if (entry && entry.id) {
      byId.set(entry.id, entry);
    }
  }
  for (const entry of collectRunEntries(root)) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, entry);
    }
  }

  return [...byId.values()].sort((a, b) => (a.generatedAt || "").localeCompare(b.generatedAt || ""));
}

// Ajoute au ledger les runs pas encore enregistrés. Append-only : les lignes
// existantes ne sont jamais réécrites.
function syncLedger(root, { dryRun = false } = {}) {
  const known = new Set(readLedger(root).map((entry) => entry.id));
  const added = collectRunEntries(root).filter((entry) => !known.has(entry.id));

  if (added.length > 0 && !dryRun) {
    fs.mkdirSync(path.dirname(ledgerPath(root)), { recursive: true });
    fs.appendFileSync(ledgerPath(root), `${added.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  }

  return { added };
}

// Gate : dernière évidence VERIFY par story doit être verte. Pas de run = pas
// vérifié = échec. Utilisable en CI pour « pas de merge sans preuve verte ».
function gate(entries) {
  const verify = entries.filter((entry) => entry.type === "verify");

  if (verify.length === 0) {
    return { ok: false, reason: "no verify runs recorded", failing: [], latest: [] };
  }

  const byStory = new Map();
  for (const entry of verify) {
    const key = entry.story || "(repo)";
    const prev = byStory.get(key);
    if (!prev || (entry.generatedAt || "") > (prev.generatedAt || "")) {
      byStory.set(key, entry);
    }
  }

  const latest = [...byStory.values()];
  const failing = latest.filter((entry) => !entry.ok);

  return { ok: failing.length === 0, reason: null, failing, latest };
}

function buildAuditMarkdown(entries) {
  const lines = [
    "# Audit ledger",
    "",
    "> Généré par `ai-flow audit --export`. Registre chronologique des évidences",
    "> (`harness verify` / `harness evidence`) capturées sur ce dépôt. Source de",
    "> vérité : `.coding-flow/ledger.jsonl` (append-only).",
    "",
  ];

  if (entries.length === 0) {
    lines.push("_Aucune évidence enregistrée pour l'instant._", "");
    return lines.join("\n");
  }

  lines.push(
    "| Date | Type | Résultat | Story | Commit | Auteur | Source |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );

  for (const entry of entries) {
    lines.push(
      `| ${entry.generatedAt || "n/a"} | ${entry.type} | ${entry.ok ? "✅" : "❌"} | ${
        entry.story || "—"
      } | ${entry.commit ? `\`${entry.commit}\`` : "—"} | ${entry.author || "—"} | ${
        entry.commandSource || "—"
      } |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function audit({ json = false, exportMd = false, check = false, since = null, dryRun = false } = {}) {
  const root = cwd;

  // Le gate CI est en lecture seule : il ne doit pas muter le ledger.
  if (check) {
    let entries = collectAll(root);
    if (since) {
      entries = entries.filter((entry) => entry.generatedAt && entry.generatedAt >= since);
    }
    const result = gate(entries);

    if (json) {
      log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      log(`Audit check passed — ${result.latest.length} story/scope(s), latest verify green.`);
    } else if (result.reason) {
      log(`Audit check FAILED — ${result.reason}.`);
    } else {
      log("Audit check FAILED — latest verify is red for:");
      for (const entry of result.failing) {
        log(`- ${entry.story || "(repo)"}: ${entry.summary}`);
      }
    }

    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const sync = syncLedger(root, { dryRun });
  let entries = collectAll(root);
  if (since) {
    entries = entries.filter((entry) => entry.generatedAt && entry.generatedAt >= since);
  }

  if (exportMd) {
    const target = auditExportPath(root);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buildAuditMarkdown(entries));
    }
    log(`${dryRun ? "Would export" : "Exported"} ${entries.length} entr(ies) to ${normalizePortable(path.relative(root, target))}`);
  }

  if (json) {
    log(JSON.stringify(entries, null, 2));
    return;
  }

  const passed = entries.filter((entry) => entry.ok).length;
  log(`Audit ledger: ${entries.length} entr(ies), ${passed} passed, ${entries.length - passed} failed.`);
  log(`${dryRun ? "Would append" : "Appended"} ${sync.added.length} new run(s) to ${normalizePortable(path.relative(root, ledgerPath(root)))}.`);
  if (!exportMd) {
    log("Run `ai-flow audit --export` to write docs/AUDIT.md, or `--check` to gate on the latest verify.");
  }
}

function auditCommand({ getFlagValue, flags }) {
  audit({
    json: flags.has("--json"),
    exportMd: flags.has("--export"),
    check: flags.has("--check"),
    since: getFlagValue("--since", null),
    dryRun: flags.has("--dry-run"),
  });
}

module.exports = {
  auditCommand,
  collectAll,
  syncLedger,
  gate,
  buildAuditMarkdown,
  entryFromRunFile,
};
