'use strict';

// The guard's failure mode that matters most is the silent one: a hook that no
// longer runs, or that still runs an outdated command, while every other signal
// keeps saying "installed correctly" (see docs/design-decisions.md entry 2 — a
// dead daemon that stops protecting without saying so is worse than the latency
// it would have saved). `doctor` is the one thing that reads .claude/settings.json
// back and checks it against what the current install would wire today.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const SETTINGS = 'settings.json';

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function project(t, prefix, initArgs = ['init']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, initArgs).code, 0);
  return dir;
}

function settingsPath(dir) {
  return path.join(dir, '.claude', SETTINGS);
}

function readSettings(dir) {
  return JSON.parse(fs.readFileSync(settingsPath(dir), 'utf8'));
}

function writeSettings(dir, settings) {
  fs.writeFileSync(settingsPath(dir), JSON.stringify(settings, null, 2));
}

function doctorJson(dir) {
  const res = run(dir, ['doctor', '--json']);
  return JSON.parse(res.output);
}

test('a fresh install wires the guard correctly and doctor stays quiet about it', (t) => {
  const dir = project(t, 'guard-fresh');
  const report = doctorJson(dir);

  assert.ok(!report.errors.some((e) => e.code === 'guard_not_wired'));
  assert.ok(!report.warnings.some((w) => w.code === 'guard_hook_stale'));
});

test('doctor errors when the guard hook is entirely missing', (t) => {
  const dir = project(t, 'guard-missing');
  const settings = readSettings(dir);
  settings.hooks.PreToolUse = [];
  writeSettings(dir, settings);

  const report = doctorJson(dir);
  assert.equal(report.ok, false);

  const found = report.errors.find((e) => e.code === 'guard_not_wired');
  assert.ok(found, 'expected a guard_not_wired error');
  assert.match(found.message, /not protected/);
  assert.match(found.message, /ai-flow upgrade/);
});

test('doctor warns, but does not fail, when the guard hook is recognizable but stale', (t) => {
  const dir = project(t, 'guard-stale');
  const settings = readSettings(dir);
  // A command that still names this package and still calls `guard` — so
  // findGuardEntry recognizes it as ours — but points at a path an old
  // release would have resolved, the exact shape of the imob incident.
  settings.hooks.PreToolUse[0].hooks[0].command =
    "R='/some/old/stale/path/ai-flow.js'; if [ -f \"$R\" ]; then node \"$R\" guard; else npx --yes @landry_pouth/coding-flow@0.1.0 guard; fi";
  writeSettings(dir, settings);

  const report = doctorJson(dir);
  assert.equal(report.ok, true, 'a stale-but-recognized hook still enforces via its own npx fallback');

  const found = report.warnings.find((w) => w.code === 'guard_hook_stale');
  assert.ok(found, 'expected a guard_hook_stale warning');
  assert.match(found.message, /ai-flow upgrade/);
});

test('doctor does not recognize a completely foreign PreToolUse hook as the guard', (t) => {
  const dir = project(t, 'guard-foreign');
  const settings = readSettings(dir);
  settings.hooks.PreToolUse = [
    { matcher: 'Write', hooks: [{ type: 'command', command: 'echo not-the-guard', timeout: 5 }] },
  ];
  writeSettings(dir, settings);

  // A command with neither the package name nor "coding-flow" in it cannot be
  // told apart from a hook someone else installed — it reads the same as no
  // guard hook at all, which is the honest answer: this project's writes are
  // not protected by our guard, whatever that other hook does.
  const report = doctorJson(dir);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === 'guard_not_wired'));
});

test('a minimal install is held to the same guard-wiring check', (t) => {
  const dir = project(t, 'guard-minimal', ['init', '--minimal']);
  const settings = readSettings(dir);
  settings.hooks.PreToolUse = [];
  writeSettings(dir, settings);

  const report = doctorJson(dir);
  assert.equal(report.install, 'minimal');
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === 'guard_not_wired'));
});

test('a project with no .claude/settings.json yet is not flagged by this check', (t) => {
  // init always writes settings.json, so this is a hypothetical (a config
  // storage backend that skips it, or a manually assembled project) — the
  // point is that a missing settings.json is a different, already-covered
  // failure (missing_file), not something this check should also complain
  // about.
  const dir = project(t, 'guard-no-settings');
  fs.rmSync(settingsPath(dir), { force: true });

  const report = doctorJson(dir);
  assert.ok(!report.errors.some((e) => e.code === 'guard_not_wired'));
});
