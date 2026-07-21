"use strict";

// Câblage du hook PreToolUse `guard` dans .claude/settings.json du projet cible.
// Un settings.json est un fichier de config utilisateur : on le FUSIONNE, jamais
// on ne l'écrase (contrairement aux templates copiés verbatim). Idempotent : si
// notre hook est déjà là, on ne le duplique pas. Non destructif : on ne touche à
// aucun autre hook ni réglage existant.

const fs = require("fs");
const path = require("path");

const { cwd, packageJson } = require("./context");
const { readJson, writeJson } = require("./util");

// Outils d'écriture que le guard doit intercepter (regex de matcher Claude Code).
const GUARD_MATCHER = "Write|Edit|MultiEdit|NotebookEdit";

// Commande exécutée par le hook : le paquet npm publié, résolu par npx et mis en
// cache après le premier appel. Construite depuis packageJson.name pour rester
// synchronisée avec le scope publié.
function guardCommandString() {
  return `npx --yes ${packageJson.name} guard`;
}

function settingsPath() {
  return path.join(cwd, ".claude", "settings.json");
}

function guardHookEntry() {
  return {
    matcher: GUARD_MATCHER,
    hooks: [{ type: "command", command: guardCommandString(), timeout: 30 }],
  };
}

// Notre hook est-il déjà câblé ? On reconnaît toute entrée PreToolUse dont une
// commande invoque `guard` sur notre paquet — tolérant aux variantes de matcher.
function hasGuardHook(settings) {
  const pre = settings && settings.hooks && Array.isArray(settings.hooks.PreToolUse)
    ? settings.hooks.PreToolUse
    : [];

  return pre.some(
    (entry) =>
      entry &&
      Array.isArray(entry.hooks) &&
      entry.hooks.some(
        (hook) =>
          hook &&
          typeof hook.command === "string" &&
          hook.command.includes(" guard") &&
          (hook.command.includes(packageJson.name) || hook.command.includes("coding-flow")),
      ),
  );
}

// Fusionne le hook guard dans settings.json. Crée le fichier s'il manque. Ne
// modifie rien d'autre. Renvoie l'état pour l'affichage de l'init.
function ensureHookSettings({ dryRun = false } = {}) {
  const target = settingsPath();
  const existed = fs.existsSync(target);
  const settings = readJson(target, null);

  // Fichier présent mais illisible : on n'y touche pas, on le signale.
  if (existed && (!settings || typeof settings !== "object" || Array.isArray(settings))) {
    return { status: "unparseable", path: target };
  }

  const next = settings && typeof settings === "object" ? settings : {};

  if (hasGuardHook(next)) {
    return { status: "unchanged", path: target };
  }

  if (!next.hooks || typeof next.hooks !== "object" || Array.isArray(next.hooks)) {
    next.hooks = {};
  }

  if (!Array.isArray(next.hooks.PreToolUse)) {
    next.hooks.PreToolUse = [];
  }

  next.hooks.PreToolUse.push(guardHookEntry());

  if (!dryRun) {
    writeJson(target, next);
  }

  return { status: existed ? "merged" : "created", path: target };
}

module.exports = { ensureHookSettings, hasGuardHook, guardCommandString, GUARD_MATCHER };
