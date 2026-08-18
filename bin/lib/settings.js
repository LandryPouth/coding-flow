"use strict";

// Wiring of the `guard` PreToolUse hook into the target project's .claude/settings.json.
// A settings.json is a user config file: we MERGE it, we never overwrite it
// (unlike the templates copied verbatim). Idempotent: if our hook is already
// there, we don't duplicate it. Non-destructive: we don't touch any other
// existing hook or setting.
//
// The hook command runs a LOCALLY-RESOLVED binary, not `npx` on every call.
// `npx --yes pkg guard` was the original wiring: it re-resolves against the
// registry on every Edit/Write (spawning npm, revalidating the cache, or
// hanging without a network) — fast enough once, catastrophic in the hot path.
// The package is already on disk whenever `init` runs (it IS the process doing
// the init), so we record its real path and the hook spawns it directly.

const fs = require("fs");
const path = require("path");

const { cwd, packageJson } = require("./context");
const { readJson, writeJson } = require("./util");

// Tools the guard must intercept (Claude Code matcher regex). `Bash` is in the
// list because a shell redirection writes to disk exactly like the Write tool
// does, and a policy that only watches one of the two doors is not a policy.
const GUARD_MATCHER = "Write|Edit|MultiEdit|NotebookEdit|Bash";

// Matchers WE have shipped as the default in an earlier version. An existing
// hook carrying one of these was never a user decision, so upgrading it to the
// current default is a fix, not an override — otherwise every project installed
// before this release would silently keep the narrower coverage forever. A
// matcher we never shipped IS a user decision and is left alone.
const KNOWN_DEFAULT_MATCHERS = new Set([
  "Write|Edit|MultiEdit|NotebookEdit",
  GUARD_MATCHER,
]);

// Hook timeout, in seconds. The resolved-binary fast path finishes in well under
// a second; 60s is insurance for the npx fallback's rare first download on a
// shared machine. A timed-out hook exits non-zero (not exit 2) and is therefore
// non-blocking — the write proceeds, the guard is skipped, latency is lost.
const GUARD_TIMEOUT = 60;

// Absolute path of the `ai-flow.js` entry point that is executing this code.
// Anchored to __dirname rather than argv so it is correct whether the package
// was installed via npx's cache, globally, or is this repo itself. realpathSync
// resolves npm's bin symlinks. Returns null if unresolvable (never happens in
// practice); the caller then emits an npx-only command.
function guardBinaryPath() {
  try {
    return fs.realpathSync(path.join(__dirname, "..", "ai-flow.js"));
  } catch {
    return null;
  }
}

// Characters that would break the path when single-quoted inside the shell
// command. npm/global install paths never contain these; if one ever does, we
// skip the fast path rather than emit a broken command.
function isShellSafePath(p) {
  return !/['"`$\\]/.test(p);
}

// Command run by the hook. Fast path: spawn the resolved local binary directly
// (`node <path> guard`, ~50ms, no network). Guarded by `[ -f ]` so a stale path
// on a machine that shares the settings.json falls back to npx — slow but it
// still enforces, preserving the guard's deterministic contract. The npx
// fallback is PINNED to the installed version (packageJson.name@version) so the
// guard the agent runs matches the tool the project was set up with, rather
// than silently following whatever npx resolves as latest.
//
// Deliberately an if/else, NOT `A && B || C`: a denied write makes guard exit 2
// (non-zero), and `||` would then ALSO run the npx fallback — which reads a
// stdin already consumed by the fast path, fails open, and masks the deny with
// an allow. if/else runs exactly one branch and preserves its exit code.
function guardCommandString() {
  const binary = guardBinaryPath();
  const fallback = `npx --yes ${packageJson.name}@${packageJson.version} guard`;

  if (binary && isShellSafePath(binary)) {
    return `R='${binary}'; if [ -f "$R" ]; then node "$R" guard; else ${fallback}; fi`;
  }
  return fallback;
}

function settingsPath() {
  return path.join(cwd, ".claude", "settings.json");
}

function guardHookEntry() {
  return {
    matcher: GUARD_MATCHER,
    hooks: [{ type: "command", command: guardCommandString(), timeout: GUARD_TIMEOUT }],
  };
}

// Returns the guard hook object within settings (a reference into the parsed
// object graph), or null. We recognize any PreToolUse hook whose command
// invokes `guard` on our package — tolerant of matcher variants. This is what
// lets ensureHookSettings UPGRADE an existing (older-format) guard hook in
// place instead of treating it as "already wired".
function findGuardEntry(settings) {
  const pre = settings && settings.hooks && Array.isArray(settings.hooks.PreToolUse)
    ? settings.hooks.PreToolUse
    : [];

  for (const entry of pre) {
    if (!entry || !Array.isArray(entry.hooks)) {
      continue;
    }
    const hook = entry.hooks.find(
      (h) =>
        h &&
        typeof h.command === "string" &&
        h.command.includes(" guard") &&
        (h.command.includes(packageJson.name) || h.command.includes("coding-flow")),
    );
    if (hook) {
      return { entry, hook };
    }
  }
  return null;
}

function findGuardHook(settings) {
  const found = findGuardEntry(settings);
  return found ? found.hook : null;
}

function hasGuardHook(settings) {
  return findGuardHook(settings) !== null;
}

// Merges the guard hook into settings.json. Creates the file if it's missing.
// Modifies nothing else. Returns the status for the init output.
//
// Statuses: "created" (file created), "merged" (added to an existing file),
// "upgraded" (an existing guard hook was replaced with the current fast
// command), "unchanged" (already wired with the current command), "unparseable".
function ensureHookSettings({ dryRun = false } = {}) {
  const target = settingsPath();
  const existed = fs.existsSync(target);
  const settings = readJson(target, null);

  // File present but unreadable: we don't touch it, we report it.
  if (existed && (!settings || typeof settings !== "object" || Array.isArray(settings))) {
    return { status: "unparseable", path: target };
  }

  const next = settings && typeof settings === "object" ? settings : {};

  const found = findGuardEntry(next);

  if (found) {
    const { entry, hook: existing } = found;
    const current = guardCommandString();
    // Only a matcher we ourselves shipped is rewritten; a customized one is the
    // user's call and survives untouched.
    const matcherIsOurs = KNOWN_DEFAULT_MATCHERS.has(entry.matcher);
    const matcherStale = matcherIsOurs && entry.matcher !== GUARD_MATCHER;

    if (existing.command === current && existing.timeout === GUARD_TIMEOUT && !matcherStale) {
      return { status: "unchanged", path: target };
    }

    // Upgrade in place: replace the command and timeout, keep every other hook
    // untouched.
    existing.command = current;
    existing.timeout = GUARD_TIMEOUT;

    if (matcherStale) {
      entry.matcher = GUARD_MATCHER;
    }

    if (!dryRun) {
      writeJson(target, next);
    }
    return { status: "upgraded", path: target };
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

module.exports = {
  ensureHookSettings,
  hasGuardHook,
  findGuardHook,
  findGuardEntry,
  guardCommandString,
  guardBinaryPath,
  GUARD_MATCHER,
  GUARD_TIMEOUT,
};
