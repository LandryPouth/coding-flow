'use strict';

// coverageFloor: the rung a risk level must reach before `ok` is true, what a
// blocked run reports, and that editing the floor invalidates an earlier proof.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { tierRank, resolveCoverageFloor } = require('../bin/lib/coverage');

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

function project(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Stand-in for `vitest --coverage`: writes the artifact a real tool writes, so
// the tiers are exercised without paying for a suite on every run.
function coverageWriter({ covered, uncovered }) {
  const spec = JSON.stringify({ covered, uncovered });
  return `
const fs = require("fs");
const path = require("path");
const spec = ${spec};
fs.mkdirSync("coverage", { recursive: true });
const lines = ["TN:", "SF:" + path.resolve("src/auth.js")];
for (const line of spec.covered) lines.push("DA:" + line + ",1");
for (const line of spec.uncovered) lines.push("DA:" + line + ",0");
lines.push("end_of_record", "");
fs.writeFileSync("coverage/lcov.info", lines.join("\\n"));
`;
}

function repo(t, prefix, { covered = [], uncovered = [], writeReport = true } = {}) {
  const dir = project(t, prefix);
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  fs.writeFileSync(path.join(dir, 'gen-coverage.js'), coverageWriter({ covered, uncovered }));

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = {
    commands: writeReport ? ['node gen-coverage.js'] : ['node -e "process.exit(0)"'],
    quality: [],
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/auth']);

  return dir;
}

function writeAuth(dir, { withTest = false } = {}) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'auth.js'),
    Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n') + '\n',
  );

  if (withTest) {
    fs.writeFileSync(path.join(dir, 'src', 'auth.test.js'), "require('node:test');\n");
  }

  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'auth']);
}


function setHarness(dir, patch) {
  const file = path.join(dir, '.coding-flow', 'harness.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2));
}

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('the rungs compare strongest first and an unknown one ranks below all', () => {
  assert.ok(tierRank('verified') > tierRank('evidence'));
  assert.ok(tierRank('evidence') > tierRank('exempted'));
  assert.ok(tierRank('exempted') > tierRank('not-required'));
  assert.ok(tierRank('missing') < tierRank('not-required'));
});

test('floor defaults keep standard as it was and raise high risk in strict', () => {
  assert.deepEqual(resolveCoverageFloor({ mode: 'standard' }), { high: 'evidence', medium: 'evidence', low: 'not-required' });
  assert.deepEqual(resolveCoverageFloor({ mode: 'strict' }), { high: 'verified', medium: 'evidence', low: 'not-required' });
  assert.equal(resolveCoverageFloor({ mode: 'standard', coverageFloor: { medium: 'verified' } }).medium, 'verified');
  assert.equal(resolveCoverageFloor({ mode: 'strict', coverageFloor: { high: 'bogus' } }).high, 'verified', 'junk never disarms the floor');
});

test('standard mode: a moved test file on high risk still passes as evidence', (t) => {
  const dir = repo(t, 'floor-standard', { writeReport: false });
  writeAuth(dir, { withTest: true });

  const res = run(dir, ['verify', '--json']);
  const out = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(out.coverage.tier, 'evidence');
  assert.equal(out.coverage.floor, undefined);
});

test('strict mode: evidence on high risk is below the floor and says how to reach it', (t) => {
  const dir = repo(t, 'floor-strict', { writeReport: false });
  setHarness(dir, { mode: 'strict' });
  writeAuth(dir, { withTest: true });

  const json = JSON.parse(run(dir, ['verify', '--json']).output);
  assert.equal(json.ok, false);
  assert.equal(json.coverage.ok, false);
  assert.equal(json.coverage.tier, 'evidence', 'a blocked run keeps the rung it reached');
  assert.deepEqual(json.coverage.floor, { required: 'verified', reached: 'evidence' });

  const text = run(dir, ['verify', '--no-cache']);
  assert.equal(text.code, 1, text.output);
  assert.match(text.output, /requires 'verified'/);
  assert.match(text.output, /Emit a coverage report/);
});

test('editing the floor invalidates an earlier green proof', (t) => {
  const dir = repo(t, 'floor-reuse', { writeReport: false });
  writeAuth(dir, { withTest: true });

  assert.equal(run(dir, ['verify']).code, 0, 'green under the standard floor');
  setHarness(dir, { mode: 'strict' });

  const res = run(dir, ['verify']);
  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /already proved/);
});

test('strict mode: a report covering the added lines reaches verified and passes', (t) => {
  const dir = repo(t, 'floor-verified', { covered: ALL });
  setHarness(dir, { mode: 'strict' });
  writeAuth(dir);

  const res = run(dir, ['verify', '--json']);
  assert.equal(res.code, 0, res.output);
  assert.equal(JSON.parse(res.output).coverage.tier, 'verified');
});

test('an explicit floor applies in standard mode too', (t) => {
  const dir = repo(t, 'floor-explicit', { writeReport: false });
  setHarness(dir, { coverageFloor: { high: 'verified' } });
  writeAuth(dir, { withTest: true });

  const res = run(dir, ['verify', '--json']);
  assert.equal(res.code, 1, res.output);
  assert.equal(JSON.parse(res.output).coverage.floor.required, 'verified');
});

test('an explicit medium floor blocks a medium-risk story that only moved a test file', (t) => {
  const dir = repo(t, 'floor-medium', { writeReport: false });
  const storyRel = 'epics/epic-01/story-01-01-widget';
  const storyDir = path.join(dir, storyRel);
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Widget\n\nExpose the widget through the api.\n');
  fs.writeFileSync(path.join(storyDir, 'plan.md'), '# Plan\n');
  setHarness(dir, { coverageFloor: { medium: 'verified' } });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'widget.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'widget.test.js'), "require('node:test');\n");
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'widget']);

  const res = run(dir, ['verify', '--story', storyRel, '--json']);
  const out = JSON.parse(res.output);

  assert.equal(res.code, 1, res.output);
  assert.deepEqual(out.coverage.floor, { required: 'verified', reached: 'evidence' });
});

test('a written exemption satisfies a strict floor and is shown as exempted', (t) => {
  const dir = repo(t, 'floor-exempt', { writeReport: false });
  setHarness(dir, { mode: 'strict' });
  writeAuth(dir);

  const res = run(dir, ['verify', '--test-exemption', 'vendor bump, no behavior change', '--json']);
  const out = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(out.coverage.tier, 'exempted');
});

test('status --json exposes the rung of the latest verify', (t) => {
  const dir = repo(t, 'floor-status', { covered: ALL });
  const storyDir = path.join(dir, 'epics', 'epic-01', 'story-01-01-auth');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Auth\n');
  fs.writeFileSync(path.join(storyDir, 'plan.md'), '# Plan\n');
  writeAuth(dir);

  assert.equal(run(dir, ['verify', '--story', 'epics/epic-01/story-01-01-auth']).code, 0);

  const status = JSON.parse(run(dir, ['status', '--json']).output);
  const story = status.epics[0].stories[0];
  assert.equal(story.coverageTier, 'verified');
});

test('audit counts verify runs per rung', (t) => {
  const dir = repo(t, 'floor-audit', { writeReport: false });
  writeAuth(dir, { withTest: true });
  assert.equal(run(dir, ['verify']).code, 0);

  const res = run(dir, ['audit', '--dry-run']);
  assert.match(res.output, /Verify runs per coverage rung: evidence 1/, res.output);
});

test('evidence written before the floor existed is re-run once, never read as failed', (t) => {
  const dir = repo(t, 'floor-legacy', { writeReport: false });
  writeAuth(dir, { withTest: true });

  assert.equal(run(dir, ['verify']).code, 0);

  const runsDir = path.join(dir, '.coding-flow', 'runs');
  for (const name of fs.readdirSync(runsDir).filter((n) => n.endsWith('.json'))) {
    const file = path.join(runsDir, name);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete data.coverageFloor;
    if (data.coverage) {
      delete data.coverage.tier;
      delete data.coverage.floor;
    }
    fs.writeFileSync(file, JSON.stringify(data));
  }

  const res = run(dir, ['verify', '--json']);
  assert.equal(res.code, 0, res.output);
  assert.equal(JSON.parse(res.output).coverage.tier, 'evidence');
});

test('audit counts a floor-blocked run under the rung it reached', (t) => {
  const dir = repo(t, 'floor-audit-blocked', { writeReport: false });
  setHarness(dir, { mode: 'strict' });
  writeAuth(dir, { withTest: true });
  assert.equal(run(dir, ['verify']).code, 1);

  const res = run(dir, ['audit', '--dry-run']);
  assert.match(res.output, /Verify runs per coverage rung: evidence 1/, res.output);
});
