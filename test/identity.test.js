'use strict';

// Tests de provenance : captureIdentity peuple l'identité git (commit, branche,
// auteur, dirty) dans un dépôt, reste non-fatal hors dépôt, et l'évidence
// verify/evidence embarque désormais un bloc `provenance`.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { captureIdentity } = require('../bin/lib/identity');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function initRepo(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Ada Lovelace']);
  git(dir, ['config', 'user.email', 'ada@example.com']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
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

test('captureIdentity peuple git (commit, branche, auteur) dans un dépôt propre', (t) => {
  const dir = initRepo(t, 'identity-clean');
  const id = captureIdentity(dir);

  assert.ok(id.git, 'git ne doit pas être null dans un dépôt');
  assert.match(id.git.commit, /^[0-9a-f]{40}$/);
  assert.equal(id.git.shortCommit.length, 7);
  assert.equal(id.git.branch, 'main');
  assert.equal(id.git.author.name, 'Ada Lovelace');
  assert.equal(id.git.author.email, 'ada@example.com');
  assert.equal(id.git.dirty, false);
  assert.ok(typeof id.capturedAt === 'string');
  assert.ok(id.host && typeof id.host.platform === 'string');
});

test('captureIdentity détecte un working tree sale', (t) => {
  const dir = initRepo(t, 'identity-dirty');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const id = captureIdentity(dir);
  assert.equal(id.git.dirty, true);
});

test('captureIdentity est non-fatal hors dépôt git', (t) => {
  const dir = tmp('identity-nogit');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = captureIdentity(dir);
  assert.equal(id.git, null);
  assert.ok(id.gitReason, 'une raison doit expliquer l’absence de git');
  assert.equal(id.pr, null);
  assert.ok(id.host, 'host reste renseigné hors git');
});

test('verify --json embarque un bloc provenance', (t) => {
  const dir = initRepo(t, 'identity-verify');
  run(dir, ['init']);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const { code, output } = run(dir, ['harness', 'verify', '--json']);
  assert.equal(code, 0, output);
  const evidence = JSON.parse(output);
  assert.ok(evidence.provenance, 'l’évidence verify doit porter provenance');
  assert.ok(evidence.provenance.git, 'provenance.git renseigné dans un dépôt');
  assert.equal(evidence.provenance.git.branch, 'main');
});
