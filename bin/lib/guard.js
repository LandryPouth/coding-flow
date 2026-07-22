"use strict";

// `ai-flow guard` : le hook PreToolUse déterministe. Claude Code passe l'appel
// d'outil sur stdin AVANT l'écriture ; guard le refuse (exit 2 + décision "deny")
// si le fichier ciblé matche un chemin bloqué de la policy harnais, ou si le
// contenu écrit contient un secret. C'est le passage du garde-fou *conseillé*
// (harness check, après coup) au garde-fou *en code* (au bord de l'outil, avant
// l'écriture) : un secret ne PEUT pas fuiter, on n'espère plus qu'il ne fuie pas.
//
// Fail-open par conception : stdin vide/illisible, outil non-écrivain, ou config
// absente ⇒ allow. Un hook ne doit jamais casser un usage légitime ; il ne bloque
// que sur une correspondance déterministe et explicite.

const fs = require("fs");
const path = require("path");

const { defaultHarnessConfig, getSecretPatterns } = require("./harness");
const { matchesPattern, isAllowedEnvExample, normalizePortable } = require("./util");

// Outils qui écrivent sur le disque. Les autres (Read, Bash, Grep…) ne sont pas
// notre affaire ici : allow immédiat.
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function readHookInput({ inputFile = null } = {}) {
  try {
    if (inputFile) {
      return fs.readFileSync(inputFile, "utf8");
    }
    // fd 0 = stdin. En contexte hook, l'entrée est toujours pipée.
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseHookInput(raw) {
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Chemin ciblé par l'appel d'outil, selon la forme de tool_input.
function targetPath(toolInput) {
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  return toolInput.notebook_path || toolInput.file_path || null;
}

// Contenu qui serait écrit, agrégé selon l'outil (pour le scan de secret).
function writtenContent(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== "object") {
    return "";
  }

  if (toolName === "Write") {
    return typeof toolInput.content === "string" ? toolInput.content : "";
  }
  if (toolName === "Edit") {
    return typeof toolInput.new_string === "string" ? toolInput.new_string : "";
  }
  if (toolName === "NotebookEdit") {
    return typeof toolInput.new_source === "string" ? toolInput.new_source : "";
  }
  if (toolName === "MultiEdit" && Array.isArray(toolInput.edits)) {
    return toolInput.edits
      .map((edit) => (edit && typeof edit.new_string === "string" ? edit.new_string : ""))
      .join("\n");
  }
  return "";
}

// Charge la policy harnais depuis la racine résolue, sans dépendre du cwd du
// module (le hook fournit son propre cwd). Config absente/corrompue ⇒ défauts.
function loadPolicy(root) {
  const defaults = defaultHarnessConfig();
  const configFile = path.join(root, ".coding-flow", "harness.json");

  let config = null;
  try {
    if (fs.existsSync(configFile)) {
      config = JSON.parse(fs.readFileSync(configFile, "utf8").replace(/^﻿/, ""));
    }
  } catch {
    config = null;
  }

  const blockedPaths =
    config && Array.isArray(config.blockedPaths) ? config.blockedPaths : defaults.blockedPaths;

  return { blockedPaths };
}

// Décision pure : à partir de l'input hook + racine, renvoie allow/deny + raison.
function decide(hook, root) {
  if (!hook || typeof hook !== "object") {
    return { decision: "allow", reason: "no parseable hook input" };
  }

  const toolName = hook.tool_name;

  if (!WRITE_TOOLS.has(toolName)) {
    return { decision: "allow", reason: `tool ${toolName || "?"} is not a write tool` };
  }

  const toolInput = hook.tool_input;
  const filePath = targetPath(toolInput);

  // Contrôle 1 — chemin bloqué par la policy.
  if (filePath) {
    const relative = normalizePortable(path.relative(root, path.resolve(root, filePath)));

    if (!isAllowedEnvExample(relative)) {
      const { blockedPaths } = loadPolicy(root);
      const hit = blockedPaths.find((pattern) => matchesPattern(relative, pattern));

      if (hit) {
        return {
          decision: "deny",
          reason: `${relative} matches a blocked harness path (${hit}). Writing secrets or protected files at the tool boundary is refused by policy.`,
          path: relative,
        };
      }
    }
  }

  // Contrôle 2 — secret dans le contenu écrit.
  const content = writtenContent(toolName, toolInput);

  if (content) {
    const patterns = getSecretPatterns();
    const line = content.split(/\r?\n/).find((row) => patterns.some((p) => p.regex.test(row)));

    if (line) {
      const match = patterns.find((p) => p.regex.test(line));
      return {
        decision: "deny",
        reason: `Potential secret detected in written content (${match.name}). Refused before it can reach the disk.`,
        path: filePath ? normalizePortable(path.relative(root, path.resolve(root, filePath))) : null,
      };
    }
  }

  return { decision: "allow", reason: "no blocked path or secret detected" };
}

function guardCommand({ getFlagValue, flags }) {
  const inputFile = getFlagValue("--input", null);
  const raw = readHookInput({ inputFile });
  const hook = parseHookInput(raw);
  // Racine : cwd fourni par le hook s'il est présent, sinon le cwd du process.
  const root = hook && typeof hook.cwd === "string" && hook.cwd ? hook.cwd : process.cwd();

  const result = decide(hook, root);

  if (result.decision === "deny") {
    // Décision hook (stdout) + message bloquant (stderr) + exit 2 : on couvre les
    // deux voies documentées pour être robuste aux versions de Claude Code.
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
        },
        systemMessage: result.reason,
      })}\n`,
    );
    process.stderr.write(`coding-flow guard: ${result.reason}\n`);
    process.exit(2);
  }

  if (flags.has("--json")) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
        reason: result.reason,
      })}\n`,
    );
  }

  process.exit(0);
}

module.exports = { guardCommand, decide };
