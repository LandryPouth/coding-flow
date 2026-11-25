'use strict';

// Story 26-08: a fresh `harness.json` shows `coverageFloor` and
// `failOnContrarySignals`, and writing them never makes a recorded proof stale —
// in this checkout, in another checkout of the same repository, or for a
// project in a subdirectory of its repository. The fingerprint is computed in
// a child process from each checkout, the way `status` and `land` compute it.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-flow.js');
const FINGERPRINT = path.join(ROOT, 'bin', 'lib', 'policy-fingerprint.js');

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-26-08-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
}

function repo(t) {
  const dir = tmp(t);
  git(dir, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

function cli(cwd, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}`, stdout: res.stdout };
}

// The fingerprint as a process started in `cwd` computes it (the readers use
// the process's directory).
function fingerprint(cwd) {
  const code = `process.stdout.write(require(${JSON.stringify(FINGERPRINT)}).policyFingerprint(process.cwd()))`;
  return execFileSync(process.execPath, ['-e', code], { cwd, encoding: 'utf8' });
}

function written(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'harness.json'), 'utf8'));
}

// Criterion 2, this checkout: an initialised project whose harness.json is
// missing (deleted, or never committed). `init` writing config.json for the
// first time moves the fingerprint on its own (its `validation` block), which
// predates this story, so the project starts with its config.json.
for (const args of [['init', '--minimal'], ['harness', 'init']]) {
  test(`${args.join(' ')} on a project with no harness.json leaves the fingerprint unchanged`, (t) => {
    const dir = repo(t);
    assert.equal(cli(dir, ['init', '--minimal']).code, 0);
    fs.rmSync(path.join(dir, '.coding-flow', 'harness.json'));
    const before = fingerprint(dir);
    const res = cli(dir, args);
    assert.equal(res.code, 0, res.out);
    assert.equal(written(dir).failOnContrarySignals, false, 'the key is written');
    assert.equal(fingerprint(dir), before);
  });
}

// Criterion 2, another checkout: init runs in a linked worktree, the new file is
// committed and merged; the primary checkout's proofs keep their fingerprint.
// Then the same with the project in a subdirectory of the repository.
for (const sub of ['', 'packages/app']) {
  test(`a harness.json written in a linked worktree keeps the primary's fingerprint${sub ? ' (project in a subdirectory)' : ''}`, (t) => {
    const primary = repo(t);
    const project = path.join(primary, sub);
    fs.mkdirSync(project, { recursive: true });
    const before = fingerprint(project);

    const linked = path.join(tmp(t), 'wt');
    git(primary, ['worktree', 'add', '-q', '-b', 'story', linked]);
    const linkedProject = path.join(linked, sub);
    fs.mkdirSync(linkedProject, { recursive: true });
    const res = cli(linkedProject, ['harness', 'init']);
    assert.equal(res.code, 0, res.out);
    assert.deepEqual(written(linkedProject).coverageFloor, { high: 'auto', medium: 'evidence', low: 'not-required' });
    git(linked, ['add', '-A']);
    git(linked, ['commit', '-qm', 'harness']);

    git(primary, ['merge', '-q', '--ff-only', 'story']);
    assert.ok(fs.existsSync(path.join(project, '.coding-flow', 'harness.json')), 'the file reached the primary checkout');
    assert.equal(fingerprint(project), before);
  });
}

// Criterion 2, `--force` on an existing file: unchanged fingerprint (26-06's test
// pins that it adds nothing); here a file that already carries the two keys.
test('harness init --force on a file that already shows the keys keeps the fingerprint', (t) => {
  const dir = repo(t);
  assert.equal(cli(dir, ['harness', 'init']).code, 0);
  const before = fingerprint(dir);
  const res = cli(dir, ['harness', 'init', '--force']);
  assert.equal(res.code, 0, res.out);
  assert.equal(fingerprint(dir), before);
});

// The keys still count when they say something: a non-default value is policy.
test('a non-default coverageFloor or failOnContrarySignals still moves the fingerprint', (t) => {
  const dir = repo(t);
  assert.equal(cli(dir, ['harness', 'init']).code, 0);
  const base = fingerprint(dir);
  const file = path.join(dir, '.coding-flow', 'harness.json');

  const contrary = { ...written(dir), failOnContrarySignals: true };
  fs.writeFileSync(file, JSON.stringify(contrary));
  assert.notEqual(fingerprint(dir), base, 'failOnContrarySignals: true');

  const floor = { ...written(dir), failOnContrarySignals: false, coverageFloor: { high: 'verified', medium: 'evidence', low: 'not-required' } };
  fs.writeFileSync(file, JSON.stringify(floor));
  assert.notEqual(fingerprint(dir), base, 'coverageFloor.high: verified');
});

// Criterion 3: what init writes is what the readers accept.
test('after init, no rule says its project value is ignored', (t) => {
  const dir = repo(t);
  assert.equal(cli(dir, ['init', '--minimal']).code, 0);
  const res = cli(dir, ['rules', '--json']);
  assert.equal(res.code, 0, res.out);
  const ignored = JSON.parse(res.stdout).rules.filter((rule) => /ignored/.test(String(rule.source)));
  assert.deepEqual(ignored.map((rule) => rule.key), []);
});
