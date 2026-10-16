'use strict';

// Contrary signals: deleted tests and open acceptance criteria stop sitting under
// a green verdict where the project asked for strictness, and are named as
// warnings where it did not.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-01/story-01-01-widget';

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

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function spec(criteria, extra = '') {
  return `# Widget\n\n## Acceptance Criteria\n\n${criteria.join('\n')}\n${extra}`;
}

function setHarness(dir, patch) {
  const file = path.join(dir, '.coding-flow', 'harness.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2));
}

const THREE_ASSERTIONS = "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n";

// main: a story, an old test, a test with three assertions. feat/widget: the
// caller edits from there.
function repo(t, prefix, { criteria = ['- [x] it works'], harness = {} } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  setHarness(dir, harness);

  write(dir, `${STORY}/spec.md`, spec(criteria));
  write(dir, `${STORY}/plan.md`, '# Plan\n');
  write(dir, 'src/old.test.ts', THREE_ASSERTIONS);
  write(dir, 'src/kept.test.ts', THREE_ASSERTIONS);
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/widget']);
  write(dir, 'src/widget.js', 'module.exports = 1;\n');

  return dir;
}

function commitAll(dir) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'work']);
}

function verify(dir, extra = []) {
  const res = run(dir, ['verify', '--no-cache', '--story', STORY, '--json', ...extra]);
  return { ...res, json: JSON.parse(res.output.slice(res.output.indexOf('{'))) };
}

test('strict: a deleted test file fails the run and the reason names it', (t) => {
  const dir = repo(t, 'cs-deleted', { harness: { mode: 'strict' } });
  fs.unlinkSync(path.join(dir, 'src', 'old.test.ts'));
  commitAll(dir);

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.equal(res.json.ok, false);
  assert.equal(res.json.commandsOk, true);
  assert.match(res.json.contrary.failures[0].detail, /src\/old\.test\.ts/);

  const text = run(dir, ['verify', '--no-cache', '--story', STORY]);
  assert.match(text.output, /NOT PROVEN/);
  assert.match(text.output, /src\/old\.test\.ts/);
});

test('strict: a Test Exemption that names the deleted file lets the run pass', (t) => {
  const dir = repo(t, 'cs-exempt', { harness: { mode: 'strict' } });
  fs.unlinkSync(path.join(dir, 'src', 'old.test.ts'));
  write(dir, `${STORY}/spec.md`, spec(['- [x] it works'], '\n## Test Exemption\n\nsrc/old.test.ts covered a removed endpoint.\n'));
  commitAll(dir);

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.deepEqual(res.json.contrary.warnings.deletedTests, []);
});

test('strict: an exemption that does not name the deleted file does not excuse it', (t) => {
  const dir = repo(t, 'cs-exempt-other', { harness: { mode: 'strict' } });
  fs.unlinkSync(path.join(dir, 'src', 'old.test.ts'));
  write(dir, `${STORY}/spec.md`, spec(['- [x] it works'], '\n## Test Exemption\n\nvendor bump.\n'));
  commitAll(dir);

  assert.equal(verify(dir).code, 1);
});

test('a renamed test file is not a deleted one', (t) => {
  const dir = repo(t, 'cs-rename', { harness: { mode: 'strict' } });
  git(dir, ['mv', 'src/old.test.ts', 'src/renamed.test.ts']);
  commitAll(dir);

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.deepEqual(res.json.contrary.warnings.deletedTests, []);
});

test('strict: assertions removed alone is a warning, not a failure', (t) => {
  const dir = repo(t, 'cs-assertions', { harness: { mode: 'strict' } });
  write(dir, 'src/kept.test.ts', 'expect(a).toBe(1);\n');
  commitAll(dir);

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.deepEqual(res.json.contrary.warnings.assertionsRemoved, ['src/kept.test.ts']);
});

test('strict: open criteria fail, and [~] plus [x] clear them', (t) => {
  const dir = repo(t, 'cs-criteria', { harness: { mode: 'strict' }, criteria: ['- [ ] first thing works', '- [ ] second thing works'] });
  commitAll(dir);

  const blocked = verify(dir);
  assert.equal(blocked.code, 1, blocked.output);
  assert.equal(blocked.json.contrary.warnings.openCriteria.length, 2);
  assert.match(blocked.json.contrary.failures[0].detail, /2 acceptance criterion/);

  write(dir, `${STORY}/spec.md`, spec(['- [~] first thing works', '- [x] second thing works']));
  commitAll(dir);

  const cleared = verify(dir);
  assert.equal(cleared.code, 0, cleared.output);
  assert.equal(cleared.json.acceptanceCriteria.deferred.length, 1);
});

test('strict: a Deferred Criteria section names a criterion it defers', (t) => {
  const dir = repo(t, 'cs-deferred-section', { harness: { mode: 'strict' }, criteria: ['- [ ] export to csv works'] });
  write(dir, `${STORY}/spec.md`, spec(['- [ ] export to csv works'], '\n## Deferred Criteria\n\n- export to csv works — moved to story 02\n'));
  commitAll(dir);

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.equal(res.json.contrary.warnings.openCriteria.length, 0);
});

test('a story with no criteria raises no criteria signal', (t) => {
  const dir = repo(t, 'cs-no-criteria', { harness: { mode: 'strict' } });
  write(dir, `${STORY}/spec.md`, '# Widget\n\nProse only.\n');
  commitAll(dir);

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.equal(res.json.contrary.warnings.openCriteria.length, 0);
});

test('standard: the same inputs pass with warnings, and status exposes them', (t) => {
  const dir = repo(t, 'cs-standard', { criteria: ['- [ ] one', '- [ ] two'] });
  fs.unlinkSync(path.join(dir, 'src', 'old.test.ts'));
  commitAll(dir);

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.equal(res.json.contrary.enforced, false);

  const text = run(dir, ['verify', '--no-cache', '--story', STORY]);
  assert.equal(text.code, 0, text.output);
  assert.match(text.output, /passed, with warnings \(1 deleted test file, 2 open criteria\)/);

  const status = JSON.parse(run(dir, ['status', '--json']).output);
  const story = status.epics[0].stories[0];
  assert.deepEqual(story.warnings, { deletedTests: 1, openCriteria: 2 });
});

test('standard: warnings of a stale proof are not shown by status', (t) => {
  const dir = repo(t, 'cs-stale', { criteria: ['- [ ] one'] });
  assert.equal(verify(dir).code, 0);
  fs.writeFileSync(path.join(dir, 'src', 'later.js'), 'module.exports = 1;\n');
  commitAll(dir);

  const status = JSON.parse(run(dir, ['status', '--json']).output);
  assert.equal(status.epics[0].stories[0].warnings, undefined);
});

test('a clean pass keeps the plain summary line', (t) => {
  const dir = repo(t, 'cs-clean');
  commitAll(dir);

  const text = run(dir, ['verify', '--no-cache', '--story', STORY]);
  assert.match(text.output, /Harness verify passed \(1 command\(s\)\)/);
});

test('failOnContrarySignals enforces on a high-risk story only', (t) => {
  const high = repo(t, 'cs-fail-high', { harness: { failOnContrarySignals: true }, criteria: ['- [ ] open one'] });
  write(high, 'src/auth.js', 'module.exports = 1;\n');
  write(high, 'src/auth.test.js', "require('node:test');\n");
  commitAll(high);
  const blocked = verify(high);
  assert.equal(blocked.code, 1, 'high risk, flag on');
  assert.equal(blocked.json.contrary.enforced, true);

  const low = repo(t, 'cs-fail-low', { harness: { failOnContrarySignals: true }, criteria: ['- [ ] open one'] });
  commitAll(low);
  assert.equal(verify(low).code, 0, 'low risk, flag on');

  const off = repo(t, 'cs-fail-off', { criteria: ['- [ ] open one'] });
  write(off, 'src/auth.js', 'module.exports = 1;\n');
  write(off, 'src/auth.test.js', "require('node:test');\n");
  commitAll(off);
  assert.equal(verify(off).code, 0, 'high risk, flag off');
});

test('editing the contrary policy invalidates an earlier green proof', (t) => {
  const dir = repo(t, 'cs-reuse', { criteria: ['- [ ] open one'] });
  commitAll(dir);

  assert.equal(run(dir, ['verify', '--story', STORY]).code, 0, 'green under standard');
  setHarness(dir, { mode: 'strict' });

  const res = run(dir, ['verify', '--story', STORY]);
  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /already proved/);
});

test('strict: a bare file name excuses a deletion only when it is unambiguous', (t) => {
  const dir = repo(t, 'cs-basename', { harness: { mode: 'strict' } });
  // Committed on main so the deletion on the branch is visible against the base.
  git(dir, ['checkout', 'main']);
  write(dir, 'src/a/index.test.ts', THREE_ASSERTIONS);
  write(dir, 'src/b/index.test.ts', THREE_ASSERTIONS);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'two index tests']);
  git(dir, ['checkout', 'feat/widget']);
  git(dir, ['rebase', 'main']);
  fs.unlinkSync(path.join(dir, 'src', 'a', 'index.test.ts'));
  fs.unlinkSync(path.join(dir, 'src', 'b', 'index.test.ts'));
  write(dir, `${STORY}/spec.md`, spec(['- [x] it works'], '\n## Test Exemption\n\nremoved index.test.ts for the legacy router.\n'));
  commitAll(dir);

  const ambiguous = verify(dir);
  assert.equal(ambiguous.code, 1, ambiguous.output);
  assert.deepEqual(ambiguous.json.contrary.warnings.deletedTests.sort(), ['src/a/index.test.ts', 'src/b/index.test.ts']);

  write(dir, `${STORY}/spec.md`, spec(['- [x] it works'], '\n## Test Exemption\n\nremoved src/a/index.test.ts and src/b/index.test.ts.\n'));
  commitAll(dir);
  assert.equal(verify(dir).code, 0, 'full paths name both');
});

test('strict: a longer file name does not hide inside another in the exemption', (t) => {
  const dir = repo(t, 'cs-substring', { harness: { mode: 'strict' } });
  fs.unlinkSync(path.join(dir, 'src', 'old.test.ts'));
  write(dir, `${STORY}/spec.md`, spec(['- [x] it works'], '\n## Test Exemption\n\nremoved src/bold.test.ts.\n'));
  commitAll(dir);

  assert.equal(verify(dir).code, 1);
});

test('strict: a generic Deferred Criteria line does not defer every criterion that mentions it', (t) => {
  const dir = repo(t, 'cs-deferred-generic', { harness: { mode: 'strict' } });
  write(dir, `${STORY}/spec.md`, spec(['- [ ] works', '- [ ] performance budget is met under load'], '\n## Deferred Criteria\n\n- performance budget is met under load, see story 02\n- performance\n'));
  commitAll(dir);

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.deepEqual(res.json.contrary.warnings.openCriteria, ['works']);
});
