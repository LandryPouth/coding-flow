"use strict";

// Identifies the rules a verdict was computed under: a proof made under other
// rules is a different proof. Kept apart from the tree token on purpose
// (`identity.js` ignores `harness.json`): the token says "the code changed", this
// says "the policy changed", and `status` / `audit` report them differently.

const crypto = require("crypto");
const path = require("path");

const { readConfig } = require("./config");
const { readHarnessConfig, SHOWN_HARNESS_DEFAULTS } = require("./harness-config");
const { remember } = require("./read-memo");
const packageJson = require("../../package.json");

// Key order and whitespace must not matter: serialise with sorted keys.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value === undefined ? null : value);
}

// A verdict computed by different gate code is a different proof, but a patch
// release is the same gate: only major.minor counts.
function majorMinor(version) {
  return String(version || "").split(".").slice(0, 2).join(".");
}

// Story 26-08: a key a fresh harness.json shows only to make a default visible
// (`coverageFloor`, `failOnContrarySignals`) is not policy while it holds that
// default: the readers resolve the same value without it. Leaving it out keeps
// every proof recorded before the file showed it valid, in every checkout.
function withoutShownDefaults(harness) {
  const policy = { ...harness };
  for (const [key, value] of Object.entries(SHOWN_HARNESS_DEFAULTS)) {
    if (canonicalJson(policy[key]) === canonicalJson(value)) {
      delete policy[key];
    }
  }
  return policy;
}

// Read once per checkout while a read-only report is built (read-memo.js).
function policyFingerprint(root, version = packageJson.version) {
  return remember("policyFingerprint", `${path.resolve(root)}\0${version}`, () => computePolicyFingerprint(root, version));
}

function computePolicyFingerprint(root, version) {
  const config = readConfig(root);
  const policy = {
    harness: withoutShownDefaults(readHarnessConfig(root).config),
    validation: config.validation || null,
    baseBranch: config.baseBranch || null,
    version: majorMinor(version),
  };

  return crypto.createHash("sha1").update(canonicalJson(policy)).digest("hex");
}

// Both sides must exist: evidence from before the field is never judged stale
// for it (it is simply not reusable for the verify cache).
function policyChanged(recorded, current) {
  return Boolean(recorded && current && recorded !== current);
}

module.exports = { policyFingerprint, policyChanged, canonicalJson };
