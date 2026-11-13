'use strict';

// A file moved out of a high-risk directory keeps its risk: the diff is scored
// on both sides of a rename (story 13-08), while coverage still measures the
// file at its new path only.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-01/story-01-01-login';
const LOGIN = 'function login(user) {\n  return user.ok === true;\n}\n\nmodule.exports = { login };\n';

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

// main: a login module under src/auth/, failOnContrarySignals, and a story with
// one open criterion (the contrary signal). feat/login: the caller edits from there.
function repo(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const harnessPath = path.join(dir, '.coding-flow', 'harness.json');
  const harness = fs.existsSync(harnessPath) ? JSON.parse(fs.readFileSync(harnessPath, 'utf8')) : {};
  fs.writeFileSync(harnessPath, JSON.stringify({ ...harness, failOnContrarySignals: true, highRiskPaths: ['src/auth/**'] }, null, 2));

  write(dir, `${STORY}/spec.md`, '# Login\n\n## Acceptance Criteria\n\n- [ ] open one\n');
  write(dir, 'src/auth/login.js', LOGIN);
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/login']);
  return dir;
}

function moveAndEdit(dir) {
  git(dir, ['mv', 'src/auth/login.js', 'src/login.js']);
  write(dir, 'src/login.js', LOGIN.replace('user.ok === true', 'Boolean(user.ok)'));
  write(dir, 'src/login.test.js', "require('node:test');\n");
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'move login out of auth']);
}

function verify(dir) {
  const res = run(dir, ['verify', '--no-cache', '--story', STORY, '--json']);
  return { ...res, json: JSON.parse(res.output.slice(res.output.indexOf('{'))) };
}

function preflightRisk(dir) {
  const res = run(dir, ['harness', 'preflight', '--story', STORY, '--json']);
  return JSON.parse(res.output.slice(res.output.indexOf('{'))).risk;
}

test('a file moved out of a high-risk path and edited is still scored high', (t) => {
  const dir = repo(t, 'rename-risk');
  moveAndEdit(dir);

  const risk = preflightRisk(dir);
  assert.equal(risk.level, 'high', JSON.stringify(risk));
  assert.ok(risk.matchedPaths.includes('src/auth/login.js'), JSON.stringify(risk));
});

test('under failOnContrarySignals, a contrary signal on a moved high-risk file fails verify', (t) => {
  const dir = repo(t, 'rename-risk-fail');
  moveAndEdit(dir);

  const res = verify(dir);
  assert.equal(res.json.contrary.enforced, true, res.output);
  assert.equal(res.code, 1, res.output);
});

test('the same change without the move fails too, as the baseline', (t) => {
  const dir = repo(t, 'rename-risk-baseline');
  write(dir, 'src/auth/login.js', LOGIN.replace('user.ok === true', 'Boolean(user.ok)'));
  write(dir, 'src/login.test.js', "require('node:test');\n");
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'edit login in place']);

  const res = verify(dir);
  assert.equal(res.json.contrary.enforced, true, res.output);
  assert.equal(res.code, 1, res.output);
});

test('a pure move out of a high-risk path keeps the risk of its new path, and verify passes', (t) => {
  const dir = repo(t, 'rename-risk-pure');
  git(dir, ['mv', 'src/auth/login.js', 'src/login.js']);
  git(dir, ['commit', '-m', 'move login out of auth, unchanged']);

  const risk = preflightRisk(dir);
  assert.equal(risk.level, 'low', JSON.stringify(risk));
  const res = verify(dir);
  assert.equal(res.json.contrary.enforced, false, res.output);
  assert.equal(res.code, 0, res.output);
});

test('a move that only reorders lines is not pure: scored high', (t) => {
  const dir = repo(t, 'rename-risk-reorder');
  write(dir, 'src/auth/guard.js', 'if (!u.admin) throw new Error("no");\nreturn doPrivileged(u);\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'add guard on the branch']);
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['merge', '-q', 'feat/login']);
  git(dir, ['checkout', '-q', 'feat/login']);
  git(dir, ['mv', 'src/auth/guard.js', 'src/guard.js']);
  write(dir, 'src/guard.js', 'return doPrivileged(u);\nif (!u.admin) throw new Error("no");\n');
  git(dir, ['commit', '-am', 'move guard out of auth, lines swapped']);

  const risk = preflightRisk(dir);
  assert.equal(risk.level, 'high', JSON.stringify(risk));
  assert.ok(risk.matchedPaths.includes('src/auth/guard.js'), JSON.stringify(risk));
});

test('a move with a mode change is not pure: scored high', (t) => {
  const dir = repo(t, 'rename-risk-chmod');
  git(dir, ['mv', 'src/auth/login.js', 'src/login.js']);
  fs.chmodSync(path.join(dir, 'src/login.js'), 0o755);
  git(dir, ['commit', '-am', 'move login out of auth, executable']);

  const risk = preflightRisk(dir);
  assert.equal(risk.level, 'high', JSON.stringify(risk));
  assert.ok(risk.matchedPaths.includes('src/auth/login.js'), JSON.stringify(risk));
});

test('a move, then an edit in a later commit, is scored high: the branch diff is cumulative', (t) => {
  const dir = repo(t, 'rename-risk-later-edit');
  git(dir, ['mv', 'src/auth/login.js', 'src/login.js']);
  git(dir, ['commit', '-m', 'move login out of auth, unchanged']);
  write(dir, 'src/login.js', LOGIN.replace('user.ok === true', 'Boolean(user.ok)'));
  git(dir, ['commit', '-am', 'edit the moved login']);

  const risk = preflightRisk(dir);
  assert.equal(risk.level, 'high', JSON.stringify(risk));
  assert.ok(risk.matchedPaths.includes('src/auth/login.js'), JSON.stringify(risk));
});

test('an unstaged move and edit is scored high: the old path reads as a deletion', (t) => {
  const dir = repo(t, 'rename-risk-unstaged');
  fs.renameSync(path.join(dir, 'src/auth/login.js'), path.join(dir, 'src/login.js'));
  write(dir, 'src/login.js', LOGIN.replace('user.ok === true', 'Boolean(user.ok)'));

  const risk = preflightRisk(dir);
  assert.equal(risk.level, 'high', JSON.stringify(risk));
  assert.ok(risk.matchedPaths.includes('src/auth/login.js'), JSON.stringify(risk));
});

test('a base that names the high-risk path still scores the move high when the tree drops it', (t) => {
  const dir = repo(t, 'rename-risk-base');
  const harnessPath = path.join(dir, '.coding-flow', 'harness.json');
  const harness = JSON.parse(fs.readFileSync(harnessPath, 'utf8'));
  fs.writeFileSync(harnessPath, JSON.stringify({ ...harness, highRiskPaths: [] }, null, 2));
  moveAndEdit(dir);

  const res = verify(dir);
  assert.equal(res.json.contrary.enforced, true, res.output);
  assert.equal(res.code, 1, res.output);
});

test('status marks a done story with a moved and edited high-risk file as review required', (t) => {
  const dir = repo(t, 'rename-risk-status');
  write(dir, `${STORY}/tasks.md`, '# Tasks\n\n## Status: done\n');
  moveAndEdit(dir);

  const res = run(dir, ['status', '--json']);
  const json = JSON.parse(res.output.slice(res.output.indexOf('{')));
  const story = json.epics.flatMap((epic) => epic.stories).find((s) => s.name === 'story-01-01-login');
  assert.equal(story.reviewRequired, true, res.output);
});

// Coverage runs here whatever the rename does (another file under src/auth/ is
// edited), so the old path leaking into the coverage scope would show.
test('coverage still measures the moved file at its new path only', (t) => {
  const dir = repo(t, 'rename-risk-coverage');
  write(dir, 'src/auth/session.js', 'module.exports = 2;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'add session on main']);
  moveAndEdit(dir);

  const res = verify(dir);
  const changed = res.json.coverage.changedFiles;
  assert.ok(changed.includes('src/login.js'), JSON.stringify(res.json.coverage));
  assert.ok(!changed.includes('src/auth/login.js'), JSON.stringify(res.json.coverage));
});
