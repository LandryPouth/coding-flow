'use strict';

// `verify` proves that the declared commands ran and passed. It has never had
// anything to say about the story's acceptance criteria, so a story could go
// green with every criterion unimplemented and nothing on screen would hint at
// it. This surfaces the unticked ones next to the verdict.
//
// The contract these tests pin is mostly about what it must NOT do: it must not
// gate, must not change `ok`, must not appear on a red run, and must not invent
// a link between a criterion and a test. Everything it adds is information.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function run(cwd, args) {
  try {
    return {
      code: 0,
      output: execFileSync(process.execPath, [CLI, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });

function repo(t, prefix, { command = 'node -e "process.exit(0)"' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(run(dir, ['init']).code, 0);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: [command], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);

  return dir;
}

// A story with no behaviour change in the diff keeps the coverage gate out of
// the way, so what is asserted below is the criteria block and nothing else.
function story(dir, criteriaSection) {
  const rel = 'epics/epic-01/story-01-01-demo';
  fs.mkdirSync(path.join(dir, rel), { recursive: true });
  fs.writeFileSync(
    path.join(dir, rel, 'spec.md'),
    `# Demo\n\n## Goal\n\nShow a thing.\n\n${criteriaSection}\n\n## Out of Scope\n\n- [ ] Nothing.\n`,
  );
  fs.writeFileSync(path.join(dir, rel, 'plan.md'), '# Plan\n');
  return rel;
}

const THREE_CRITERIA = `## Acceptance Criteria

- [x] Given a visitor, when the page loads, then the hero renders.
- [ ] Given a slow network, when the page loads, then a skeleton shows.
- [ ] Given an error, when the fetch fails, then a retry is offered.`;

test('a green verify lists the acceptance criteria still unticked', (t) => {
  const dir = repo(t, 'ac-open');
  const rel = story(dir, THREE_CRITERIA);

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Harness verify passed/);
  assert.match(res.output, /Acceptance criteria: 1\/3 ticked/);
  assert.match(res.output, /a skeleton shows/);
  assert.match(res.output, /an error, when the fetch fails/);
  assert.doesNotMatch(res.output, /the hero renders/, 'a ticked criterion is not an open one');
});

test('it changes no verdict and says so', (t) => {
  const dir = repo(t, 'ac-noverdict');
  const rel = story(dir, THREE_CRITERIA);

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, 'unticked criteria must never fail a verify');
  assert.match(res.output, /changes no verdict and blocks nothing/);
});

test('a fully ticked story prints nothing about criteria', (t) => {
  const dir = repo(t, 'ac-done');
  const rel = story(
    dir,
    '## Acceptance Criteria\n\n- [x] Given a visitor, when the page loads, then the hero renders.',
  );

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.doesNotMatch(res.output, /Acceptance criteria/);
});

test('a story with no criteria section prints nothing about criteria', (t) => {
  const dir = repo(t, 'ac-none');
  const rel = story(dir, '## Notes\n\nNo criteria were written for this one.');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.doesNotMatch(res.output, /Acceptance criteria/);
});

test('criteria written as prose rather than a checklist are not counted', (t) => {
  const dir = repo(t, 'ac-prose');
  const rel = story(
    dir,
    '## Acceptance Criteria\n\nThe hero renders, a skeleton shows on a slow network, and errors offer a retry.',
  );

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.doesNotMatch(res.output, /Acceptance criteria/, 'nothing countable is not a finding');
});

test('a red verify says nothing about criteria — the failing command is the message', (t) => {
  const dir = repo(t, 'ac-red', { command: 'node -e "process.exit(1)"' });
  const rel = story(dir, THREE_CRITERIA);

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1);
  assert.match(res.output, /Harness verify FAILED/);
  assert.doesNotMatch(res.output, /Acceptance criteria/);
});

test('the criteria travel with the evidence, not only the screen', (t) => {
  const dir = repo(t, 'ac-evidence');
  const rel = story(dir, THREE_CRITERIA);

  run(dir, ['verify', '--story', rel]);

  const runsDir = path.join(dir, '.coding-flow', 'runs');
  const file = fs.readdirSync(runsDir).filter((name) => name.endsWith('-verify.json')).sort().pop();
  const evidence = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));

  assert.equal(evidence.acceptanceCriteria.total, 3);
  assert.equal(evidence.acceptanceCriteria.unchecked.length, 2);
  assert.equal(evidence.ok, true, 'and the verdict is untouched by them');
});
