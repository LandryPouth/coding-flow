'use strict';

// docs/plans/*.md is where design decisions get written down before they
// become work — nothing forced them to ever turn into an epic, so they were
// silently forgettable. `status` now says which ones still are: a plan
// "counts" as tracked the moment some epic's index.md mentions its path,
// exactly the way epic-01-multi-platform-support's index.md already
// references docs/plans/multi-agent-install.md while explaining why it
// supersedes part of it.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writePlan(dir, name, content = '# a plan\n') {
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', name), content);
}

function writeEpic(dir, epicName, indexContent) {
  fs.mkdirSync(path.join(dir, 'epics', epicName), { recursive: true });
  fs.writeFileSync(path.join(dir, 'epics', epicName, 'index.md'), indexContent);
}

function statusJson(dir) {
  const { code, output } = run(dir, ['status', '--json']);
  assert.equal(code, 0, `status --json must exit 0 (${output})`);
  return JSON.parse(output);
}

test('a plan with no epics at all is reported as untracked', (t) => {
  const dir = project(t, 'plans-no-epics');
  writePlan(dir, 'storage-backends.md');

  const { untrackedPlans } = statusJson(dir);
  assert.deepEqual(untrackedPlans, ['docs/plans/storage-backends.md']);
});

test('a plan referenced by an epic index.md is not untracked', (t) => {
  const dir = project(t, 'plans-referenced');
  writePlan(dir, 'multi-agent-install.md');
  writeEpic(
    dir,
    'epic-01-multi-platform-support',
    '# Epic\n\nSupersedes docs/plans/multi-agent-install.md\n',
  );

  const { untrackedPlans } = statusJson(dir);
  assert.deepEqual(untrackedPlans, []);
});

test('untracked and tracked plans are both reported correctly side by side', (t) => {
  const dir = project(t, 'plans-mixed');
  writePlan(dir, 'multi-agent-install.md');
  writePlan(dir, 'storage-backends.md');
  writeEpic(dir, 'epic-01-multi-platform-support', 'docs/plans/multi-agent-install.md\n');

  const { untrackedPlans } = statusJson(dir);
  assert.deepEqual(untrackedPlans, ['docs/plans/storage-backends.md']);
});

test('no docs/plans directory at all reports an empty list, not an error', (t) => {
  const dir = project(t, 'plans-none');

  const { untrackedPlans } = statusJson(dir);
  assert.deepEqual(untrackedPlans, []);
});

test('the human-readable status output lists untracked plans with a next-step hint', (t) => {
  const dir = project(t, 'plans-human');
  writePlan(dir, 'storage-backends.md');

  const { code, output } = run(dir, ['status']);
  assert.equal(code, 0);
  assert.match(output, /Docs not yet tracked by an epic:/);
  assert.match(output, /docs\/plans\/storage-backends\.md/);
  assert.match(output, /\/flow-plan/);
});

test('the human-readable status output stays quiet when nothing is untracked', (t) => {
  const dir = project(t, 'plans-quiet');

  const { code, output } = run(dir, ['status']);
  assert.equal(code, 0);
  assert.ok(!output.includes('Docs not yet tracked'));
});
