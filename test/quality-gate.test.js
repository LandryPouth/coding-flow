'use strict';

// Contract tests for executed code quality (Tier 1 of the code-quality plan).
//
// Deterministic quality — lint, format:check, duplication (jscpd/similarity) — is
// not a new pillar. It rides the existing proof pipeline: a project declares its
// quality commands in `config.validation.quality`, `verify` runs them and captures
// the exit codes verbatim, and a red quality command blocks exactly like a red
// test (verify red -> audit --check red). No linter is bundled; the harness only
// executes what the project declared. We prove the green/red toggle end-to-end
// through the CLI, never by reasoning.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readConfig } = require('../bin/lib/config');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
}

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

function initProject(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  return dir;
}

function setValidation(dir, validation) {
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = validation;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function latestVerify(dir) {
  const runsDir = path.join(dir, '.coding-flow', 'runs');
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('-verify.json'));
  assert.ok(files.length > 0, 'a -verify.json file must exist');
  return JSON.parse(fs.readFileSync(path.join(runsDir, files.sort().pop()), 'utf8'));
}

// --- config seam: the quality bucket is parsed and preserved ------------------

test('readConfig exposes a validation.quality bucket, cleaned like commands', (t) => {
  const dir = initProject(t, 'quality-config');
  setValidation(dir, {
    commands: ['npm test', 42, ''],
    quality: ['npm run lint', '  ', 'npx jscpd src'],
  });

  const config = readConfig(dir);
  assert.deepEqual(config.validation.commands, ['npm test']);
  assert.deepEqual(config.validation.quality, ['npm run lint', 'npx jscpd src']);
});

test('a project with no quality declared still parses to an empty bucket', (t) => {
  const dir = initProject(t, 'quality-default');
  const config = readConfig(dir);
  assert.deepEqual(config.validation.quality, []);
});

// --- executed: quality commands flow through verify ---------------------------

test('a green quality command rides verify to a passing, captured result', (t) => {
  const dir = initProject(t, 'quality-green');
  setValidation(dir, { commands: ['node -e "process.exit(0)"'], quality: ['node -e "process.exit(0)"'] });

  const { code } = run(dir, ['harness', 'verify']);
  assert.equal(code, 0, 'both correctness and quality green -> verify green');

  const evidence = latestVerify(dir);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.commandsFound, 2, 'both buckets execute');
  assert.equal(evidence.commandSource, 'config');
});

test('a red quality command blocks verify exactly like a red test', (t) => {
  const dir = initProject(t, 'quality-red');
  // Correctness passes; only the quality gate (a failing "duplication" run) is red.
  setValidation(dir, { commands: ['node -e "process.exit(0)"'], quality: ['node -e "process.exit(2)"'] });

  const { code, output } = run(dir, ['harness', 'verify']);
  assert.equal(code, 1, 'a red quality command must fail verify');
  assert.match(output, /FAILED/);

  const evidence = latestVerify(dir);
  assert.equal(evidence.ok, false);
  const qualityResult = evidence.results.find((r) => r.command === 'node -e "process.exit(2)"');
  assert.ok(qualityResult, 'the quality command is captured verbatim');
  assert.equal(qualityResult.exitCode, 2, 'its real exit code is recorded');
});

test('quality alone (no correctness commands) still gates verify', (t) => {
  const dir = initProject(t, 'quality-only');
  setValidation(dir, { commands: [], quality: ['node -e "process.exit(5)"'] });

  const { code } = run(dir, ['harness', 'verify']);
  assert.equal(code, 1, 'a declared quality bucket runs even with no test commands');
  assert.equal(latestVerify(dir).results[0].exitCode, 5);
});

// --- the CI gate covers quality for free --------------------------------------

test('audit --check fails on a red quality run and passes once it is green', (t) => {
  const dir = initProject(t, 'quality-audit');
  const storyRel = 'epics/epic-01-x/story-01-01-y';
  fs.mkdirSync(path.join(dir, storyRel), { recursive: true });
  fs.writeFileSync(path.join(dir, storyRel, 'story.md'), '# Story 01.01\n');

  setValidation(dir, { commands: [], quality: ['node -e "process.exit(1)"'] });
  run(dir, ['harness', 'verify', '--story', storyRel]);
  assert.equal(run(dir, ['audit', '--check']).code, 1, 'a red quality verify fails the CI gate');

  setValidation(dir, { commands: [], quality: ['node -e "process.exit(0)"'] });
  run(dir, ['harness', 'verify', '--story', storyRel]);
  assert.equal(run(dir, ['audit', '--check']).code, 0, 'turning quality green clears the gate');
});

// --- package.json fallback treats quality scripts as first-class --------------

test('the package.json fallback auto-detects a format:check quality script', (t) => {
  const dir = initProject(t, 'quality-pkg');
  const pkgPath = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.scripts = { ...(pkg.scripts || {}), 'format:check': 'node -e "process.exit(0)"' };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const { output } = run(dir, ['harness', 'verify', '--dry-run', '--json']);
  const plan = JSON.parse(output);
  assert.equal(plan.commandSource, 'package.json');
  assert.ok(
    plan.commands.includes('npm run format:check'),
    'a conventional quality script is picked up as a first-class check',
  );
});
