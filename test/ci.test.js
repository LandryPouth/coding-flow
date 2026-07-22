'use strict';

// Tests de `ai-flow ci init` : scaffolde le workflow clean-room, non destructif,
// idempotent, --force réécrit, --dry-run n'écrit rien.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const WF = path.join('.github', 'workflows', 'coding-flow-verify.yml');

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

function project(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('ci init écrit le workflow clean-room avec verify + audit', (t) => {
  const dir = project(t, 'ci-init');
  const res = run(dir, ['ci', 'init']);
  assert.equal(res.code, 0, res.output);

  const wf = fs.readFileSync(path.join(dir, WF), 'utf8');
  assert.match(wf, /name: coding-flow verify/);
  assert.match(wf, /harness verify/);
  assert.match(wf, /audit --check/);
  assert.match(wf, /@landry_pouth\/coding-flow/, 'le workflow cible le paquet publié');
  assert.match(wf, /upload-artifact/, 'l’évidence est uploadée');
});

test('ci init est non destructif sans --force', (t) => {
  const dir = project(t, 'ci-noforce');
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, WF), 'custom: true\n');

  const res = run(dir, ['ci', 'init']);
  assert.equal(res.code, 0);
  assert.match(res.output, /already present/);
  assert.equal(fs.readFileSync(path.join(dir, WF), 'utf8'), 'custom: true\n', 'le fichier existant est préservé');
});

test('ci init --force réécrit le workflow', (t) => {
  const dir = project(t, 'ci-force');
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, WF), 'custom: true\n');

  run(dir, ['ci', 'init', '--force']);
  assert.match(fs.readFileSync(path.join(dir, WF), 'utf8'), /coding-flow verify/, '--force remplace le contenu');
});

test('ci init --dry-run n’écrit rien', (t) => {
  const dir = project(t, 'ci-dry');
  const res = run(dir, ['ci', 'init', '--dry-run']);
  assert.equal(res.code, 0);
  assert.match(res.output, /Would write/);
  assert.ok(!fs.existsSync(path.join(dir, WF)), '--dry-run ne doit écrire aucun fichier');
});
