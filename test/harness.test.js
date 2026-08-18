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

// Prose tops out at medium. Thirteen days of real runs scored 39 of 39 stories
// `high` — a hero recomposition matched "token" (design tokens), a landing page
// matched "auth" (author) — so STRICT stopped meaning anything and the
// diff-derived score could never win the max. See coverage-gate.test.js for the
// other half of the contract: a diff that touches src/auth/ still reaches high.
function preflight(dir, rel) {
  const { code, output } = run(dir, ['harness', 'preflight', '--story', rel, '--json']);
  assert.equal(code, 0, 'preflight must exit 0');
  return JSON.parse(output);
}

function storySpec(dir, rel, spec) {
  fs.mkdirSync(path.join(dir, rel), { recursive: true });
  fs.writeFileSync(path.join(dir, rel, 'spec.md'), spec);
  return rel;
}

test('a payment story with no payment diff is medium, not high', (t) => {
  const dir = freshProject(t);
  const rel = storySpec(
    dir,
    'epics/epic-01-pay/story-01-01-stripe',
    '# Payment\n\nStripe payment and webhook integration.\n',
  );

  const contract = preflight(dir, rel);

  assert.equal(contract.risk.level, 'medium', 'wording alone cannot prove a trust boundary');
  assert.equal(contract.recommendedMode, 'standard', 'and it must not buy STRICT ceremony');
  assert.ok(contract.risk.matchedTerms.includes('payment'), 'the term is still reported');
});

test('a term inside a longer word does not score at all', (t) => {
  const dir = freshProject(t);
  const rel = storySpec(
    dir,
    'epics/epic-02-ui/story-02-01-hero',
    '# Hero\n\nRecompose the hero using the brand design tokens. Credit the author in the footer.\n',
  );

  const contract = preflight(dir, rel);

  assert.equal(contract.risk.level, 'low', '"author" is not "auth" and "tokens" is not "token"');
  assert.deepEqual(contract.risk.matchedTerms, []);
});

test('a story that names a high-risk term as a whole word still scores', (t) => {
  const dir = freshProject(t);
  const rel = storySpec(
    dir,
    'epics/epic-03-acl/story-03-01-roles',
    '# Roles\n\nThe admin role gates this screen.\n',
  );

  const contract = preflight(dir, rel);

  assert.equal(contract.risk.level, 'medium', 'a stated risk is evidence, just not proof');
  assert.ok(contract.risk.matchedTerms.includes('admin'));
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
