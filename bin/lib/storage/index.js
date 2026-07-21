"use strict";

// Point d'entree du seam de stockage : choisit le backend selon la config du
// projet. Un seul backend actif a la fois (local OU github), jamais les deux —
// pas de synchro bidirectionnelle, pas de source de verite ambigue.

const { readConfig } = require("../config");
const { createLocalStorage } = require("./local");
const { createGithubStorage } = require("./github");

function getStorage(cwd, configOverride = null) {
  const config = configOverride || readConfig(cwd);

  if (config.storage === "github") {
    return createGithubStorage(cwd);
  }

  return createLocalStorage(cwd);
}

module.exports = { getStorage };
