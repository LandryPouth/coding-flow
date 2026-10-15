"use strict";

// What an install did for its platform, as durable evidence: a `kind: "platform"`
// record next to the verify/evidence ones. `enforcementTier` is the honest part —
// it says whether the platform got a real guard or only commands, so a missing
// guard is a visible fact in `ai-flow report`, never a silent claim.

const path = require("path");

const { writeJson } = require("../util");

function writePlatformEvidence(root, { target, detectionSource, commandsInstalled, enforcementTier }) {
  const generatedAt = new Date().toISOString();
  const file = path.join(
    root,
    ".coding-flow",
    "runs",
    `${generatedAt.replace(/[:.]/g, "-")}-platform-${target}.json`,
  );

  writeJson(file, { kind: "platform", generatedAt, target, detectionSource, commandsInstalled, enforcementTier });

  return file;
}

module.exports = { writePlatformEvidence };
