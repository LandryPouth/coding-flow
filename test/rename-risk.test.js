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

test('a file moved out of a high-risk path and edited is still scored high', (t) => {
  const dir = repo(t, 'rename-risk');
  moveAndEdit(dir);

  const preflight = run(dir, ['harness', 'preflight', '--story', STORY, '--json']);
  const risk = JSON.parse(preflight.output.slice(preflight.output.indexOf('{'))).risk;
  assert.equal(risk.level, 'high', preflight.output);
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

test('coverage still measures the moved file at its new path only', (t) => {
  const dir = repo(t, 'rename-risk-coverage');
  moveAndEdit(dir);

  const res = verify(dir);
  const changed = res.json.coverage.changedFiles;
  assert.ok(changed.includes('src/login.js'), JSON.stringify(res.json.coverage));
  assert.ok(!changed.includes('src/auth/login.js'), JSON.stringify(res.json.coverage));
});
