"use strict";

// Entry point of the storage seam: picks the backend from the project config.
// Only one backend active at a time (local OR github), never both — no
// two-way sync, no ambiguous source of truth.

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
