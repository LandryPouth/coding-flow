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

// Story 13-11: a criterion wrapped over several lines is compared whole.
const WRAPPED = ['- [ ] Given a request from X the guard must', '      deny the write and say why'];

test('a word reworded on a continuation line is criteria-changed', (t) => {
  const dir = repo(t, 'cd-wrap-word', { criteria: WRAPPED });
  write(dir, `${STORY}/spec.md`, spec([WRAPPED[0], '      warn on the write and say why']));

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  const [entry] = res.json.contrary.warnings.criteriaChanged;
  assert.match(entry, /deny the write/);
  assert.match(entry, /warn on the write/);
});

test('a clause added on a new continuation line is criteria-changed', (t) => {
  const dir = repo(t, 'cd-wrap-clause', { criteria: WRAPPED });
  write(dir, `${STORY}/spec.md`, spec([...WRAPPED, '      unless the file is in a sandbox']));

  const res = verify(dir);
  assert.equal(res.json.contrary.warnings.criteriaChanged.length, 1, res.output);
  assert.match(res.json.contrary.warnings.criteriaChanged[0], /unless the file is in a sandbox/);
});

test('strict: a continuation-line change fails', (t) => {
  const dir = repo(t, 'cd-wrap-strict', { criteria: WRAPPED, strict: true });
  write(dir, `${STORY}/spec.md`, spec(['- [x] Given a request from X the guard must', '      warn on the write and say why']));

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'criteria-changed'));
});

test('re-wrapping and ticking a wrapped criterion stay silent, CRLF included', (t) => {
  const dir = repo(t, 'cd-wrap-silent', { criteria: WRAPPED });
  const rewrapped = ['- [x] Given a request', '  from X the guard must deny', '  the write and say why'];
  write(dir, `${STORY}/spec.md`, spec(rewrapped).replace(/\n/g, '\r\n'));

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.criteriaChanged, []);
});

test('a nested list item and a later heading are not part of the criterion above', (t) => {
  const nested = [...WRAPPED, '  - [ ] Given Y then allow', '', '## Notes', '', '    indented note'];
  const dir = repo(t, 'cd-wrap-nested', { criteria: nested });
  write(dir, `${STORY}/spec.md`, spec(['- [x] Given a request from X the guard must', '      deny the write and say why', '  - [x] Given Y then allow', '', '## Notes', '', '    another note']));

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.criteriaChanged, []);
});

test('strict: a Spec Change holding only a comment is not a reason', (t) => {
  const dir = repo(t, 'cd-spec-comment', { strict: true });
  write(dir, `${STORY}/spec.md`, spec(['- [x] Given X then warn'], '\n## Spec Change\n\n<!-- why the criteria changed -->\n\n'));

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'criteria-changed'));
});

test('a changed criterion pairs with its most similar old one, and an added one is shown', (t) => {
  const dir = repo(t, 'cd-pair', { criteria: ['- [ ] Given Y then allow the read', DENY] });
  write(dir, `${STORY}/spec.md`, spec([WARN, '- [ ] Given Y then allow the read', '- [ ] Export writes a CSV file']));

  const res = verify(dir);
  const changed = res.json.contrary.warnings.criteriaChanged;
  assert.ok(changed.includes('Given X then deny → Given X then warn'), JSON.stringify(changed));
  assert.ok(changed.includes('(added) → Export writes a CSV file'), JSON.stringify(changed));
  assert.equal(changed.length, 2);
});

test('criteria with no clear pair are listed apart', (t) => {
  const dir = repo(t, 'cd-nopair');
  write(dir, `${STORY}/spec.md`, spec(['- [ ] Export writes a CSV file']));

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.criteriaChanged.sort(), ['(added) → Export writes a CSV file', 'Given X then deny → (removed)']);
});

test('removing one of two identical criteria is reported', (t) => {
  const dir = repo(t, 'cd-dup', { criteria: [DENY, DENY] });
  write(dir, `${STORY}/spec.md`, spec([DENY]));

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.criteriaChanged, ['Given X then deny → (removed)']);
});

// 13-11 review: a criterion's own sub-steps, sub-headings and code are its words.
const STEPS = ['- [ ] Given a bug fix the steps say, in order:', '      - reproduce the symptom;', '      - see it fail;', '      - fix.'];

test('a sub-step removed from a criterion is criteria-changed, strict fails', (t) => {
  const dir = repo(t, 'cd-substep', { criteria: STEPS, strict: true });
  write(dir, `${STORY}/spec.md`, spec(['- [x] Given a bug fix the steps say, in order:', '      - reproduce the symptom;', '      - fix.']));

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.match(res.json.contrary.warnings.criteriaChanged[0], /see it fail/);
});

test('a sub-step reworded is criteria-changed', (t) => {
  const dir = repo(t, 'cd-substep-word', { criteria: STEPS });
  write(dir, `${STORY}/spec.md`, spec([STEPS[0], STEPS[1], '      - see it pass;', STEPS[3]]));

  const res = verify(dir);
  assert.equal(res.json.contrary.warnings.criteriaChanged.length, 1, res.output);
});

test('a re-wrap that starts a continuation line with a list marker stays silent', (t) => {
  const dir = repo(t, 'cd-rewrap-dash', { criteria: ['- [ ] Exit code is 0 or 1 - never 2'] });
  write(dir, `${STORY}/spec.md`, spec(['- [ ] Exit code is 0 or 1', '      - never 2']));

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.criteriaChanged, []);
});

test('a sub-heading inside the criteria ends the criterion above it', (t) => {
  const dir = repo(t, 'cd-subheading', { criteria: [DENY, '', '  ### Later', '', '    an indented note'] });
  write(dir, `${STORY}/spec.md`, spec([DENY, '', '  ### Later', '', '    another note']));

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.criteriaChanged, []);
});

test('a line inside a fenced block of a criterion is part of it', (t) => {
  const fenced = (word) => ['- [ ] Output is:', '      ```', '      - a', `      ${word}`, '      ```'];
  const dir = repo(t, 'cd-fence', { criteria: fenced('b') });
  write(dir, `${STORY}/spec.md`, spec(fenced('b changed')));

  const res = verify(dir);
  assert.equal(res.json.contrary.warnings.criteriaChanged.length, 1, res.output);
});

test('a tab-indented continuation is deeper than a two-space nested bullet', (t) => {
  const tabbed = (word) => ['- [ ] parent', '  - [ ] child must', `\t${word}`];
  const dir = repo(t, 'cd-tab', { criteria: tabbed('deny') });
  write(dir, `${STORY}/spec.md`, spec(tabbed('warn')));

  const res = verify(dir);
  assert.equal(res.json.contrary.warnings.criteriaChanged.length, 1, res.output);
});

// 13-11 re-review: a fence never swallows a later criterion.
test('an unclosed fence ends at the next criterion, which stays open', (t) => {
  const criteria = ['- [x] Output is:', '      ```', '      foo', '- [ ] second criterion still open'];
  const dir = repo(t, 'cd-fence-open', { criteria });

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.openCriteria, ['second criterion still open'], res.output);
  assert.deepEqual(res.json.contrary.warnings.criteriaChanged, []);
});

test('a four-backtick fence holding three backticks closes on its own run', (t) => {
  const block = (word) => ['- [x] Output is:', '      ````', '      ```', `      ${word}`, '      ````', '- [ ] real criterion'];
  const dir = repo(t, 'cd-fence-four', { criteria: block('a') });
  write(dir, `${STORY}/spec.md`, spec(block('b')));

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.openCriteria, ['real criterion'], res.output);
  assert.equal(res.json.contrary.warnings.criteriaChanged.length, 1, res.output);
});
