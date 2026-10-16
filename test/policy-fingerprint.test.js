'use strict';

// Contract tests for story-08-02: a proof is only as good as the rules it was
// computed under. Editing the policy makes an old green stale ("policy changed"),
// never "already proved"; a patch release keeps it, a minor one does not.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-01-demo/story-01-01-demo';
const { policyFingerprint, canonicalJson } = require('../bin/lib/policy-fingerprint');

function run(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-policy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init']).code, 0);

  const storyDir = path.join(dir, STORY);
  fs.mkdirSync(storyDir, { recursive: true });
  for (const name of ['spec', 'plan', 'tasks']) {
    fs.writeFileSync(path.join(storyDir, `${name}.md`), `# ${name}\n`);
  }

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'initial']);
  return dir;
}

function editHarness(dir, change) {
  const file = path.join(dir, '.coding-flow', 'harness.json');
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, `${JSON.stringify(change(data), null, 2)}\n`);
}

function latestVerify(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  const name = fs.readdirSync(runs).filter((n) => n.endsWith('-verify.json')).sort().pop();
  return JSON.parse(fs.readFileSync(path.join(runs, name), 'utf8'));
}

function storyStatus(dir) {
  const data = JSON.parse(run(dir, ['status', '--json']).output);
  return data.epics.flatMap((epic) => epic.stories).find((story) => story.path === STORY);
}

test('verify stores the policy fingerprint on its evidence', (t) => {
  const dir = project(t);
  assert.equal(run(dir, ['verify', '--story', STORY]).code, 0);
  assert.match(latestVerify(dir).policyFingerprint, /^[0-9a-f]{40}$/);
});

test('no change at all: the proof is still reused', (t) => {
  const dir = project(t);
  run(dir, ['verify', '--story', STORY]);
  assert.match(run(dir, ['verify', '--story', STORY]).output, /already proved/);
});

test('a new high-risk term means the commands really run again', (t) => {
  const dir = project(t);
  run(dir, ['verify', '--story', STORY]);
  editHarness(dir, (h) => ({ ...h, highRiskTerms: ['hologram'] }));

  const again = run(dir, ['verify', '--story', STORY]);
  assert.equal(again.code, 0, again.output);
  assert.doesNotMatch(again.output, /already proved/);
});

test('a changed validation block invalidates the fingerprint too', (t) => {
  const dir = project(t);
  const before = policyFingerprint(dir);
  const file = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.baseBranch = 'develop';
  fs.writeFileSync(file, JSON.stringify(config));
  assert.notEqual(policyFingerprint(dir), before);
});

test('evidence from before the field is never reused, but never reads as stale', (t) => {
  const dir = project(t);
  run(dir, ['verify', '--story', STORY]);

  const runs = path.join(dir, '.coding-flow', 'runs');
  const file = path.join(runs, fs.readdirSync(runs).find((n) => n.endsWith('-verify.json')));
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete evidence.policyFingerprint;
  fs.writeFileSync(file, JSON.stringify(evidence));

  assert.equal(storyStatus(dir).status, 'verified');
  assert.doesNotMatch(run(dir, ['verify', '--story', STORY]).output, /already proved/);
});

test('status says "policy changed" when the rules moved, and not when the code did', (t) => {
  const dir = project(t);
  run(dir, ['verify', '--story', STORY]);
  assert.equal(storyStatus(dir).status, 'verified');

  editHarness(dir, (h) => ({ ...h, coverageReports: ['coverage/lcov.info'] }));
  const story = storyStatus(dir);
  assert.equal(story.status, 'stale');
  assert.equal(story.staleReason, 'policy changed');
  assert.match(run(dir, ['status']).output, /policy changed/);
});

test('a code change is stale for "code changed"', (t) => {
  const dir = project(t);
  run(dir, ['verify', '--story', STORY]);
  fs.appendFileSync(path.join(dir, STORY, 'spec.md'), 'more\n');
  git(dir, ['add', '-A']);

  const story = storyStatus(dir);
  assert.equal(story.status, 'stale');
  assert.equal(story.staleReason, 'code changed');
});

test('audit --check fails on a policy change', (t) => {
  const dir = project(t);
  run(dir, ['verify', '--story', STORY]);
  assert.equal(run(dir, ['audit', '--check']).code, 0);

  editHarness(dir, (h) => ({ ...h, highRiskTerms: ['hologram'] }));
  assert.equal(run(dir, ['audit', '--check']).code, 1);
});

test('key order and whitespace do not change the fingerprint', (t) => {
  const dir = project(t);
  editHarness(dir, () => ({ highRiskTerms: ['a', 'b'], mode: 'standard' }));
  const before = policyFingerprint(dir);
  fs.writeFileSync(
    path.join(dir, '.coding-flow', 'harness.json'),
    '{\n\n"mode":   "standard",\n  "highRiskTerms": [ "a",\n"b" ]}',
  );
  assert.equal(policyFingerprint(dir), before);
  assert.equal(canonicalJson({ b: 1, a: [2] }), canonicalJson({ a: [2], b: 1 }));
});

test('a patch release keeps the fingerprint, a minor one changes it', (t) => {
  const dir = project(t);
  assert.equal(policyFingerprint(dir, '0.13.0'), policyFingerprint(dir, '0.13.1'));
  assert.notEqual(policyFingerprint(dir, '0.13.1'), policyFingerprint(dir, '0.14.0'));
});
