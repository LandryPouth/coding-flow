'use strict';

// Criteria drift: a story's acceptance criteria are compared with the diff base.
// Ticks are silent; a removed or reworded criterion, or a story born in the same
// diff as its code, is a contrary signal a `## Spec Change` section can explain.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-01/story-01-01-widget';
const DENY = '- [ ] Given X then deny';
const WARN = '- [ ] Given X then warn';

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

// main holds the story (unless `storyOnMain` is false); feat/widget is the branch.
function repo(t, prefix, { criteria = [DENY], strict = false, storyOnMain = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  if (strict) {
    const harness = path.join(dir, '.coding-flow', 'harness.json');
    const current = fs.existsSync(harness) ? JSON.parse(fs.readFileSync(harness, 'utf8')) : {};
    fs.writeFileSync(harness, JSON.stringify({ ...current, mode: 'strict' }, null, 2));
  }

  if (storyOnMain) {
    write(dir, `${STORY}/spec.md`, spec(criteria));
    write(dir, `${STORY}/plan.md`, '# Plan\n');
  }
  write(dir, 'src/kept.test.js', 'assert(1);\nassert(2);\nassert(3);\n');
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/widget']);
  write(dir, 'src/widget.js', 'module.exports = 1;\n');
  write(dir, 'src/widget.test.js', 'assert(1);\nassert(2);\nassert(3);\n');

  return dir;
}

function verify(dir) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'work']);
  const res = run(dir, ['verify', '--no-cache', '--story', STORY, '--json']);
  return { ...res, json: JSON.parse(res.output.slice(res.output.indexOf('{'))) };
}

test('a reworded criterion is criteria-changed and lists both texts', (t) => {
  const dir = repo(t, 'cd-reword');
  write(dir, `${STORY}/spec.md`, spec([WARN]));

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  const [entry] = res.json.contrary.warnings.criteriaChanged;
  assert.match(entry, /Given X then deny/);
  assert.match(entry, /Given X then warn/);
});

test('only ticks between base and HEAD raise no signal', (t) => {
  const dir = repo(t, 'cd-ticks', { criteria: [DENY, '- [ ] Given Y then allow'] });
  write(dir, `${STORY}/spec.md`, spec(['- [x] Given X then deny', '- [~] Given Y then allow']));

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.criteriaChanged, []);
  assert.equal(res.json.contrary.warnings.specInDiff, false);
});

test('a story born in the same branch as its code is spec-in-diff, a warning', (t) => {
  const dir = repo(t, 'cd-born', { storyOnMain: false });
  write(dir, `${STORY}/spec.md`, spec(['- [x] Given X then deny']));

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.equal(res.json.contrary.warnings.specInDiff, true);
});

test('strict: criteria-changed fails, and a Spec Change section lets it pass with the reason', (t) => {
  const dir = repo(t, 'cd-strict', { strict: true });
  write(dir, `${STORY}/spec.md`, spec(['- [x] Given X then warn']));

  const failed = verify(dir);
  assert.equal(failed.code, 1, failed.output);
  assert.ok(failed.json.contrary.failures.some((f) => f.signal === 'criteria-changed'));

  write(dir, `${STORY}/spec.md`, spec(['- [x] Given X then warn'], '\n## Spec Change\n\nDeny broke the import path.\n'));
  const passed = verify(dir);
  assert.equal(passed.code, 0, passed.output);
  assert.equal(passed.json.contrary.ok, true);
  assert.match(passed.json.contrary.specChange, /Deny broke the import path/);
});

test('a renamed story is compared with its content before the rename', (t) => {
  const dir = repo(t, 'cd-rename');
  const renamed = 'epics/epic-01/story-01-01-gadget';
  git(dir, ['mv', STORY, renamed]);
  git(dir, ['commit', '-m', 'rename']);
  const res = run(dir, ['verify', '--no-cache', '--story', renamed, '--json']);
  const json = JSON.parse(res.output.slice(res.output.indexOf('{')));

  assert.equal(json.contrary.warnings.specInDiff, false);
  assert.deepEqual(json.contrary.warnings.criteriaChanged, []);
});

test('a removed criterion is listed as removed', (t) => {
  const dir = repo(t, 'cd-removed', { criteria: [DENY, '- [ ] Given Y then allow'] });
  write(dir, `${STORY}/spec.md`, spec([DENY]));

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.deepEqual(res.json.contrary.warnings.criteriaChanged, ['Given Y then allow → (removed)']);
});

test('strict: spec-in-diff fails, and a Spec Change section lets it pass', (t) => {
  const dir = repo(t, 'cd-born-strict', { strict: true, storyOnMain: false });
  write(dir, `${STORY}/spec.md`, spec(['- [x] Given X then deny']));

  const failed = verify(dir);
  assert.equal(failed.code, 1, failed.output);
  assert.ok(failed.json.contrary.failures.some((f) => f.signal === 'spec-in-diff'));

  write(dir, `${STORY}/spec.md`, spec(['- [x] Given X then deny'], '\n## Spec Change\n\nPlanned and coded in one sitting.\n'));
  const passed = verify(dir);
  assert.equal(passed.code, 0, passed.output);
  assert.match(passed.json.contrary.specChange, /one sitting/);
});
