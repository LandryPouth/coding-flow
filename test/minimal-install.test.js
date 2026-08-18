'use strict';

// `init --minimal`: the smallest thing worth adopting. The enforcement layer
// alone — guard hook + proof layer — with none of the workflow. These tests pin
// the two properties that make it worth having: it lays down almost nothing, and
// everything downstream treats the result as a correct install rather than a
// broken one.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

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

function project(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const WORKFLOW_FILES = ['RULES.md', 'CLAUDE.md', 'docs', 'epics', '.claude/skills'];

test('a minimal install lays down the enforcement layer and nothing else', (t) => {
  const dir = project(t, 'min-install');
  const res = run(dir, ['init', '--minimal']);

  assert.equal(res.code, 0, res.output);
  assert.ok(fs.existsSync(path.join(dir, '.coding-flow', 'harness.json')), 'the policy is there');
  assert.ok(fs.existsSync(path.join(dir, '.coding-flow', 'config.json')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')), 'the guard is wired');

  for (const file of WORKFLOW_FILES) {
    assert.equal(
      fs.existsSync(path.join(dir, file)),
      false,
      `${file} must not be laid down by a minimal install`,
    );
  }

  const config = JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8'));
  assert.equal(config.install, 'minimal', 'the choice is recorded, not re-derived later');
});

test('the package.json of the project is left alone', (t) => {
  const dir = project(t, 'min-pkg');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { test: 'x' } }, null, 2));

  run(dir, ['init', '--minimal']);

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.scripts, { test: 'x' }, 'no flow:* scripts are injected');
});

test('doctor judges a minimal install against what it chose to install', (t) => {
  const dir = project(t, 'min-doctor');
  run(dir, ['init', '--minimal']);

  const res = run(dir, ['doctor']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /minimal/);

  const json = JSON.parse(run(dir, ['doctor', '--json']).output);
  assert.equal(json.ok, true, 'a missing RULES.md is correct here, not an error');
  assert.equal(json.install, 'minimal');
});

test('doctor --fix does not quietly upgrade a minimal install', (t) => {
  const dir = project(t, 'min-fix');
  run(dir, ['init', '--minimal']);

  const res = run(dir, ['doctor', '--fix']);
  assert.equal(res.code, 0, res.output);
  assert.equal(fs.existsSync(path.join(dir, 'RULES.md')), false, 'a diagnostic must not install a workflow');
  assert.match(res.output, /nothing to restore/);
});

test('verify works on a minimal install — no story, no scaffolding', (t) => {
  const dir = project(t, 'min-verify');
  run(dir, ['init', '--minimal']);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const res = run(dir, ['verify', '--json']);
  assert.equal(res.code, 0, res.output);
  assert.equal(JSON.parse(res.output).ok, true, 'the proof layer is the point of a minimal install');
});

test('a plain init grows a minimal project into the full workflow', (t) => {
  const dir = project(t, 'min-promote');
  run(dir, ['init', '--minimal']);

  const res = run(dir, ['init']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /promoted from minimal to full/);
  assert.ok(fs.existsSync(path.join(dir, 'RULES.md')));

  const config = JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8'));
  assert.equal(config.install, 'full');

  // And doctor now holds it to the full standard.
  assert.equal(JSON.parse(run(dir, ['doctor', '--json']).output).install, 'full');
});

test('--minimal --dry-run writes nothing', (t) => {
  const dir = project(t, 'min-dry');
  const res = run(dir, ['init', '--minimal', '--dry-run']);

  assert.equal(res.code, 0, res.output);
  assert.equal(fs.existsSync(path.join(dir, '.coding-flow', 'harness.json')), false);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
});

test('--minimal --no-guard installs the proof layer alone', (t) => {
  const dir = project(t, 'min-noguard');
  run(dir, ['init', '--minimal', '--no-guard']);

  assert.ok(fs.existsSync(path.join(dir, '.coding-flow', 'harness.json')));
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
});

test('--minimal --with-skills is refused rather than half-honoured', (t) => {
  const dir = project(t, 'min-contradict');
  const res = run(dir, ['init', '--minimal', '--with-skills']);

  assert.equal(res.code, 1);
  assert.match(res.output, /contradictory/);
});

test('a minimal install is idempotent', (t) => {
  const dir = project(t, 'min-twice');
  run(dir, ['init', '--minimal']);
  const res = run(dir, ['init', '--minimal']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Config: unchanged/);
  assert.match(res.output, /Harness config: unchanged/);
});
