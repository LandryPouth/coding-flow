"use strict";

// What an install did for its platform, as durable evidence: a `kind: "platform"`
// record next to the verify/evidence ones. `enforcementTier` is the honest part —
// it says whether the platform got a real guard or only commands, so a missing
// guard is a visible fact in `ai-flow report`, never a silent claim.

const fs = require("fs");
const path = require("path");

const { writeJson, readJson } = require("../util");

// The newest record already on disk for this target, or null.
function latestPlatformRecord(runsDir, target) {
  let names = [];

  try {
    names = fs.readdirSync(runsDir).filter((n) => n.endsWith(`-platform-${target}.json`)).sort();
  } catch {
    return null;
  }

  return names.length ? readJson(path.join(runsDir, names[names.length - 1]), null) : null;
}

function writePlatformEvidence(root, { target, detectionSource, commandsInstalled, enforcementTier }) {
  const generatedAt = new Date().toISOString();
  const runsDir = path.join(root, ".coding-flow", "runs");
  const previous = latestPlatformRecord(runsDir, target);

  // An idempotent re-run changes nothing, so it records nothing: otherwise every
  // `init` adds an identical row to `## Platform coverage`.
  if (
    previous &&
    previous.detectionSource === detectionSource &&
    previous.commandsInstalled === commandsInstalled &&
    previous.enforcementTier === enforcementTier
  ) {
    return null;
  }

  const file = path.join(runsDir, `${generatedAt.replace(/[:.]/g, "-")}-platform-${target}.json`);

  writeJson(file, { kind: "platform", generatedAt, target, detectionSource, commandsInstalled, enforcementTier });

  return file;
}

module.exports = { writePlatformEvidence };
