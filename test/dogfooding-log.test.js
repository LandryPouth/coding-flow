'use strict';

// The friction log ships with the install. A tool that wants to know where it
// costs more than it returns cannot wait for someone to volunteer that: the file
// has to be there, and the rule that fills it has to be in the always-loaded
// rulebook, or the metric is whatever two incidents anyone still remembers.
//
// The rule these tests defend hardest is the one about disabling a check. A gate
// that gets switched off protects nothing, and an unlogged switch-off is the
// exact data point the log exists to capture.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const TEMPLATES = path.join(__dirname, '..', 'templates');
const LOG = 'docs/DOGFOODING.md';

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

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

// --- it arrives with the install --------------------------------------------

test('a full install lays down the friction log', (t) => {
  const dir = project(t, 'dog-full');
  assert.equal(run(dir, ['init']).code, 0);

  const log = path.join(dir, LOG);
  assert.ok(fs.existsSync(log), 'the log must exist before anyone needs it');
  assert.match(fs.readFileSync(log, 'utf8'), /\| Date \| Surface \|/, 'an empty table, ready to append to');
});

test('the log is tracked, so upgrade never overwrites what was written in it', (t) => {
  const dir = project(t, 'dog-manifest');
  assert.equal(run(dir, ['init']).code, 0);

  const manifest = JSON.parse(read(dir, '.coding-flow', 'manifest.json'));
  assert.ok(manifest.files[LOG], 'the log is in the manifest');

  // A file whose whole purpose is to be edited. The hash is what tells `upgrade`
  // it was touched; losing rows to a template refresh would end the practice.
  const before = read(dir, LOG);
  fs.writeFileSync(path.join(dir, LOG), `${before}| 2026-08-18 | guard | noise | low | none | open |\n`);

  assert.equal(run(dir, ['upgrade']).code, 0);
  assert.match(read(dir, LOG), /2026-08-18 \| guard \| noise/, 'the row survived the upgrade');
});

test('a minimal install still installs nothing but the enforcement layer', (t) => {
  // The log is documentation. `--minimal` promises the guard and the harness and
  // no files beyond them, and a friction log does not get to be the exception.
  const dir = project(t, 'dog-minimal');
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  assert.equal(fs.existsSync(path.join(dir, LOG)), false);
});

// --- the rule that fills it -------------------------------------------------

test('the always-loaded rulebook carries the trigger', () => {
  const rules = read(TEMPLATES, 'RULES.md');

  assert.match(rules, /### Tooling Friction/);
  assert.match(rules, /docs\/DOGFOODING\.md/);
  assert.match(rules, /in the same pass/, 'written as it happens, not reconstructed later');
});

test('disabling a check is the row the rule insists on', () => {
  const rules = read(TEMPLATES, 'RULES.md');
  assert.match(rules, /disabled, relaxed, or exempted/);
});

test('the rule keeps ordinary failures out of the log', () => {
  // Without this line the log fills with red suites and stops being a measure of
  // anything about the tool.
  const rules = read(TEMPLATES, 'RULES.md');
  assert.match(rules, /A failing test, or a gate that rightly demanded one, is the tool\s+working/);
});

test('the rulebook stays a pointer — the criteria live in the file itself', () => {
  // RULES.md is paid on every turn; DOGFOODING.md is read only when a row is
  // written. Splitting them this way is what kept the rule inside the budget.
  const rules = read(TEMPLATES, 'RULES.md');
  const doc = read(TEMPLATES, 'docs', 'DOGFOODING.md');

  const section = rules.slice(rules.indexOf('### Tooling Friction'), rules.indexOf('### Communication'));
  assert.ok(section.split(/\s+/).filter(Boolean).length < 100, 'the trigger, not the manual');

  for (const owned of ['Severity', 'Workaround', 'Resolution', 'false positive']) {
    assert.match(doc, new RegExp(owned, 'i'), `${owned} is the log's to define`);
  }
});

test('flow-run raises it at the moment friction happens', () => {
  const skill = read(TEMPLATES, '.claude', 'skills', 'flow-run', 'SKILL.md');

  assert.match(skill, /docs\/DOGFOODING\.md/);
  assert.match(skill, /disable,\s+relax, or exempt/);
});
