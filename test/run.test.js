'use strict';

// Contract tests for `ai-flow run`: the batch orchestrator. It resolves a set of
// stories, verifies each one for real (executing the declared commands), writes
// per-story evidence plus one aggregated run report, and its exit code reflects
// whether every verifiable story passed. Driver "none" verifies only; other
// drivers are a reserved seam and must fail cleanly.

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

function initProject(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  return dir;
}

// Creates a story with a plan.md whose "## Commands" block holds `command`.
// Omit `command` for a story with no validation commands (verify skips it).
function makeStory(dir, epic, story, command) {
  const storyDir = path.join(dir, 'epics', epic, story);
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), `# ${story}\n`);

  const plan = command
    ? ['# Plan', '', '## Commands', '', '```bash', command, '```', ''].join('\n')
    : '# Plan\n';
  fs.writeFileSync(path.join(storyDir, 'plan.md'), plan);
  fs.writeFileSync(path.join(storyDir, 'tasks.md'), '# Tasks\n\n## Result\n');
  return `epics/${epic}/${story}`;
}

function runFiles(dir) {
  const runsDir = path.join(dir, '.coding-flow', 'runs');
  return fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : [];
}

test('run verifies a passing story, writes a report + evidence, and exits 0', (t) => {
  const dir = initProject(t, 'run-pass');
  const story = makeStory(dir, 'epic-01', 'story-01-01-demo', 'node -e "process.exit(0)"');

  const { code, output } = run(dir, ['run', '--story', story]);
  assert.equal(code, 0, output);
  assert.match(output, /\[pass\]/);
  assert.match(output, /1 passed, 0 failed, 0 skipped of 1/);

  const files = runFiles(dir);
  assert.ok(files.some((f) => f.endsWith('-run.json')), 'a -run.json report is written');
  assert.ok(files.some((f) => f.endsWith('-verify.json')), 'a per-story -verify.json is written');
});

test('run exits 1 when a story fails, capturing it in the report', (t) => {
  const dir = initProject(t, 'run-fail');
  const story = makeStory(dir, 'epic-01', 'story-01-01-broken', 'node -e "process.exit(3)"');

  const { code, output } = run(dir, ['run', '--story', story, '--json']);
  assert.equal(code, 1, 'a failing story must fail the run');

  const report = JSON.parse(output);
  assert.equal(report.ok, false);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.stories[0].results[0].exitCode, 3);
});

test('run over all stories counts a no-command story as skipped, not failed', (t) => {
  const dir = initProject(t, 'run-all');
  makeStory(dir, 'epic-01', 'story-01-01-ready', 'node -e "process.exit(0)"');
  makeStory(dir, 'epic-01', 'story-01-02-notready'); // no commands

  const { code, output } = run(dir, ['run', '--json']);
  assert.equal(code, 0, 'skipped stories do not turn the run red');

  const report = JSON.parse(output);
  assert.equal(report.target.kind, 'all');
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.skipped, 1);
});

test('run --dry-run executes nothing and writes no report', (t) => {
  const dir = initProject(t, 'run-dry');
  const marker = path.join(dir, 'SIDE_EFFECT');
  const story = makeStory(
    dir,
    'epic-01',
    'story-01-01-demo',
    `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '\\\\')}','x')"`,
  );

  const { code, output } = run(dir, ['run', '--story', story, '--dry-run']);
  assert.equal(code, 0, output);
  assert.match(output, /dry run/i);
  assert.ok(!fs.existsSync(marker), '--dry-run must execute no command');
  assert.ok(runFiles(dir).every((f) => !f.endsWith('-run.json')), '--dry-run writes no report');
});

test('run rejects an unavailable driver with a clear message', (t) => {
  const dir = initProject(t, 'run-driver');
  makeStory(dir, 'epic-01', 'story-01-01-demo', 'node -e "process.exit(0)"');

  const { code, output } = run(dir, ['run', '--driver', 'claude']);
  assert.notEqual(code, 0, 'an unavailable driver must fail');
  assert.match(output, /not available yet/i);
});

test('run fails cleanly when there are no stories', (t) => {
  const dir = initProject(t, 'run-empty');
  const { code, output } = run(dir, ['run']);
  assert.notEqual(code, 0);
  assert.match(output, /no stories found/i);
});
