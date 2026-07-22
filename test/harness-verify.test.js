'use strict';

// Contract tests for `ai-flow harness verify`: it really runs the declared
// validation commands, captures their exit code, writes an evidence, and fails if
// a command breaks or if nothing ran.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseTestsCommands } = require('../bin/lib/harness');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
}

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
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  return dir;
}

function setValidationCommands(dir, commands) {
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function runsDir(dir) {
  return path.join(dir, '.coding-flow', 'runs');
}

function latestVerify(dir) {
  const files = fs.readdirSync(runsDir(dir)).filter((f) => f.endsWith('-verify.json'));
  assert.ok(files.length > 0, 'a -verify.json file must exist');
  return JSON.parse(fs.readFileSync(path.join(runsDir(dir), files.sort().pop()), 'utf8'));
}

test('verify passes and exits 0 when declared commands succeed', (t) => {
  const dir = initProject(t, 'verify-pass');
  setValidationCommands(dir, ['node -e "process.exit(0)"']);

  const { code, output } = run(dir, ['harness', 'verify']);
  assert.equal(code, 0, output);
  assert.match(output, /passed/i);

  const evidence = latestVerify(dir);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.commandSource, 'config');
  assert.equal(evidence.results[0].exitCode, 0);
});

test('verify fails and exits 1 when a command fails, capturing the exit code', (t) => {
  const dir = initProject(t, 'verify-fail');
  setValidationCommands(dir, ['node -e "process.exit(0)"', 'node -e "process.exit(3)"']);

  const { code, output } = run(dir, ['harness', 'verify']);
  assert.equal(code, 1, 'a breaking command must fail verify');
  assert.match(output, /FAILED/);

  const evidence = latestVerify(dir);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.results[1].exitCode, 3);
});

test('verify exits 1 when no validation commands are found', (t) => {
  const dir = initProject(t, 'verify-none');
  // Default config: validation.commands empty, no tests.md, and the flow:*
  // package.json scripts match no verify candidate.
  const { code, output } = run(dir, ['harness', 'verify']);
  assert.equal(code, 1, 'no command = not verified = failure');
  assert.match(output, /no validation commands/i);
});

test('verify --dry-run runs nothing', (t) => {
  const dir = initProject(t, 'verify-dry');
  const marker = path.join(dir, 'SIDE_EFFECT');
  setValidationCommands(dir, [`node -e "require('fs').writeFileSync('${marker}','x')"`]);

  const { code } = run(dir, ['harness', 'verify', '--dry-run']);
  assert.equal(code, 0);
  assert.ok(!fs.existsSync(marker), '--dry-run must execute no command');
  assert.ok(
    !fs.existsSync(runsDir(dir)) || fs.readdirSync(runsDir(dir)).every((f) => !f.endsWith('-verify.json')),
    '--dry-run must write no verify evidence',
  );
});

test('verify falls back to the tests.md Commands block for a story', (t) => {
  const dir = initProject(t, 'verify-testsmd');
  const storyDir = path.join(dir, 'epics', 'epic-01', 'story-01-01-demo');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'story.md'), '# Demo\n');
  fs.writeFileSync(
    path.join(storyDir, 'tests.md'),
    ['# Tests', '', '## Commands', '', '```bash', 'node -e "process.exit(0)"', '```', ''].join('\n'),
  );

  const { code, output } = run(dir, [
    'harness',
    'verify',
    '--story',
    'epics/epic-01/story-01-01-demo',
    '--json',
  ]);
  assert.equal(code, 0, output);
  const evidence = JSON.parse(output);
  assert.equal(evidence.commandSource, 'tests.md');
  assert.equal(evidence.ok, true);
});

test('parseTestsCommands extracts only the fenced command lines', () => {
  const md = [
    '# Tests',
    '',
    '## Commands',
    '',
    '```bash',
    'npm run test',
    '# a comment',
    'npm run lint',
    '```',
    '',
    '## Expected Results',
    '',
    '- all pass',
  ].join('\n');

  assert.deepEqual(parseTestsCommands(md), ['npm run test', 'npm run lint']);
});
