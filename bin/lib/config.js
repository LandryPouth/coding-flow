"use strict";

// Configuration du projet : .coding-flow/config.json. Ce fichier retient les
// decisions prises a l'install (backend de stockage, policy de branche) pour que
// toutes les commandes lisent la meme source. JSON et pas YAML : le projet reste
// zero-dependance (parser du YAML demanderait une lib).

const fs = require("fs");
const path = require("path");

const { readJson, writeJson } = require("./util");

// Backends de stockage connus. "local" = epics/stories en fichiers versionnes
// (defaut). "github" = issues/sub-issues GitHub (seam en place, voir
// storage/github.js — implementation differee tant qu'un vrai besoin n'existe pas).
const STORAGE_BACKENDS = ["local", "github"];

function configPath(cwd) {
  return path.join(cwd, ".coding-flow", "config.json");
}

function defaultConfig() {
  return {
    version: 1,
    storage: "local",
    branchPerEpic: true,
    // Commandes de validation exécutées par `ai-flow harness verify`. Vide par
    // défaut : la commande retombe alors sur le bloc "## Commands" de tests.md,
    // puis sur les scripts package.json. Déclarer ici rend la validation
    // explicite et indépendante du langage.
    validation: { commands: [] },
  };
}

// Lit la config en fusionnant avec les defauts et en validant les valeurs
// connues. Une config absente ou corrompue retombe proprement sur les defauts.
function readConfig(cwd) {
  const defaults = defaultConfig();
  const existing = readJson(configPath(cwd), null);

  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return { ...defaults };
  }

  const storage = STORAGE_BACKENDS.includes(existing.storage) ? existing.storage : defaults.storage;

  const validation =
    existing.validation && Array.isArray(existing.validation.commands)
      ? { commands: existing.validation.commands.filter((c) => typeof c === "string" && c.trim()) }
      : defaults.validation;

  return {
    ...defaults,
    ...existing,
    storage,
    branchPerEpic:
      typeof existing.branchPerEpic === "boolean" ? existing.branchPerEpic : defaults.branchPerEpic,
    validation,
  };
}

// Cree la config si elle n'existe pas encore. Ne l'ecrase jamais : les decisions
// deja prises restent stables entre upgrades.
function ensureConfig(cwd, { dryRun = false, storage = "local", branchPerEpic = true } = {}) {
  const target = configPath(cwd);

  if (fs.existsSync(target)) {
    return { created: false, path: target, config: readConfig(cwd) };
  }

  const config = { ...defaultConfig(), storage, branchPerEpic };

  if (!dryRun) {
    writeJson(target, config);
  }

  return { created: true, path: target, config };
}

module.exports = {
  STORAGE_BACKENDS,
  configPath,
  defaultConfig,
  readConfig,
  ensureConfig,
};
