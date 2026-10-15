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

// The tier a probe result earns: "sandbox" only when a probe actually ran and the
// write was denied — never from config presence alone. Anything else falls back to
// what is merely installed.
function tierFor(baseTier, probe) {
  return probe && probe.ran && probe.ok === true ? "sandbox" : baseTier;
}

function sameProbe(a, b) {
  const x = a || null;
  const y = b || null;

  return (x && x.ran) === (y && y.ran) && (x ? x.ok : null) === (y ? y.ok : null) && (x ? x.detail : null) === (y ? y.detail : null);
}

function writePlatformEvidence(root, { target, detectionSource, commandsInstalled, enforcementTier, signals, probe = null }) {
  const generatedAt = new Date().toISOString();
  const runsDir = path.join(root, ".coding-flow", "runs");
  const previous = latestPlatformRecord(runsDir, target);

  // An idempotent re-run changes nothing, so it records nothing: otherwise every
  // `init` adds an identical row to `## Platform coverage`.
  if (
    previous &&
    previous.detectionSource === detectionSource &&
    previous.commandsInstalled === commandsInstalled &&
    previous.enforcementTier === enforcementTier &&
    JSON.stringify(previous.signals || null) === JSON.stringify(signals || null) &&
    sameProbe(previous.probe, probe)
  ) {
    return null;
  }

  const file = path.join(runsDir, `${generatedAt.replace(/[:.]/g, "-")}-platform-${target}.json`);

  const record = { kind: "platform", generatedAt, target, detectionSource, commandsInstalled, enforcementTier };

  // Only an unrecognized install carries signals: they are what makes it informative.
  if (signals) {
    record.signals = signals;
  }

  if (probe) {
    record.probe = probe;
  }

  writeJson(file, record);

  return file;
}

// `doctor` re-checks enforcement on its own: carry the newest install record
// forward with the fresh probe, so the report shows what was actually verified.
function recordProbeEvidence(root, { target, probe, baseTier }) {
  const previous = latestPlatformRecord(path.join(root, ".coding-flow", "runs"), target);

  return writePlatformEvidence(root, {
    target,
    detectionSource: previous ? previous.detectionSource : "doctor",
    commandsInstalled: previous && typeof previous.commandsInstalled === "number" ? previous.commandsInstalled : null,
    enforcementTier: tierFor(baseTier, probe),
    probe,
  });
}

module.exports = { writePlatformEvidence, recordProbeEvidence, tierFor };
