'use strict';

// Contract tests for the security harness (`ai-flow harness`).
// This is the most sensitive logic in the CLI: it decides whether a secret or a
// dangerous file gets through. We test the observable behavior — exit code and
// JSON — on throwaway projects. Zero dependency: node:test.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function freshProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-harness-'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# project\n');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
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

test('harness init creates the policy config', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['harness', 'init']);
  assert.equal(code, 0, 'harness init must exit 0');
  assert.ok(
    fs.existsSync(path.join(dir, '.coding-flow', 'harness.json')),
    'harness init must write .coding-flow/harness.json',
  );
});

test('harness check passes on a clean project', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['harness', 'check']);
  assert.equal(code, 0, 'a project with no secret or sensitive file must pass');
});

test('harness check detects a secret and fails', (t) => {
  const dir = freshProject(t);
  // Fake live Stripe key: the pattern must spot it.
  fs.writeFileSync(path.join(dir, 'config.js'), 'const k = "sk_live_51H8xYzABCDEFGHIJKLMNOP";\n');
  const { code, output } = run(dir, ['harness', 'check']);
  assert.notEqual(code, 0, 'a detected secret must fail the check');
  assert.match(output, /secret|Stripe/i, 'the output must mention the secret');
});

test('harness check refuses a non-example .env file', (t) => {
  const dir = freshProject(t);
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=abc\n');
  const { code } = run(dir, ['harness', 'check']);
  assert.notEqual(code, 0, '.env is a blocked path and must fail the check');
});

test('harness check tolerates .env.example', (t) => {
  const dir = freshProject(t);
  fs.writeFileSync(path.join(dir, '.env.example'), 'API_KEY=\n');
  const { code } = run(dir, ['harness', 'check']);
  assert.equal(code, 0, '.env.example is a safe example and must not block');
});

test('harness preflight classifies a payment story as high risk', (t) => {
  const dir = freshProject(t);
  const storyDir = path.join(dir, 'epics', 'epic-01-pay', 'story-01-01-stripe');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Payment\n\nStripe payment and webhook integration.\n');

  const { code, output } = run(dir, [
    'harness', 'preflight',
    '--story', 'epics/epic-01-pay/story-01-01-stripe',
    '--json',
  ]);
  assert.equal(code, 0, 'preflight must exit 0');
  const contract = JSON.parse(output);
  assert.equal(contract.risk.level, 'high', 'a Stripe/payment story must be high risk');
});

test('harness evidence writes a run file', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['harness', 'evidence']);
  assert.equal(code, 0, 'evidence must exit 0 on a clean project');

  const runsDir = path.join(dir, '.coding-flow', 'runs');
  assert.ok(fs.existsSync(runsDir), 'the runs directory must exist');
  const files = fs.readdirSync(runsDir).filter((name) => name.endsWith('-evidence.json'));
  assert.ok(files.length >= 1, 'an evidence file must be written');
});
