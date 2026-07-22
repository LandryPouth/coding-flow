'use strict';

// Tests of the audit ledger: append-only + dedup, history preservation, the
// docs/AUDIT.md export, the --check gate on the latest verify evidence, and --since.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

function project(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.coding-flow', 'runs'), { recursive: true });
  return dir;
}

// Writes a deterministic fake verify run into .coding-flow/runs.
function writeVerifyRun(dir, { ok = true, story = null, when }) {
  const evidence = {
    generatedAt: when,
    root: dir,
    provenance: { git: { shortCommit: 'abc1234', branch: 'feat/x', author: { name: 'Ada' } } },
    story,
    commandSource: 'config',
    commandsFound: 1,
    ok,
    results: [{ command: 'npm test', ok, exitCode: ok ? 0 : 1, timedOut: false, durationMs: 10 }],
  };
  const file = path.join(dir, '.coding-flow', 'runs', `${when.replace(/[:.]/g, '-')}-verify.json`);
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
}

function ledgerLines(dir) {
  const p = path.join(dir, '.coding-flow', 'ledger.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

test('audit appends the runs to the ledger and deduplicates on the 2nd pass', (t) => {
  const dir = project(t, 'audit-dedup');
  writeVerifyRun(dir, { ok: true, when: '2026-07-21T09:00:00.000Z' });
  writeVerifyRun(dir, { ok: true, when: '2026-07-21T10:00:00.000Z' });

  const first = run(dir, ['audit']);
  assert.equal(first.code, 0, first.output);
  assert.equal(ledgerLines(dir).length, 2, 'two runs → two lines');

  run(dir, ['audit']);
  assert.equal(ledgerLines(dir).length, 2, 'a 2nd pass does not duplicate');
});

test('audit preserves the existing lines (append-only)', (t) => {
  const dir = project(t, 'audit-appendonly');
  const ledger = path.join(dir, '.coding-flow', 'ledger.jsonl');
  fs.writeFileSync(ledger, `${JSON.stringify({ id: 'seed00000000', type: 'verify', ok: true, tag: 'seed' })}\n`);

  writeVerifyRun(dir, { ok: true, when: '2026-07-21T10:00:00.000Z' });
  run(dir, ['audit']);

  const lines = ledgerLines(dir);
  assert.ok(lines.some((l) => l.includes('seed')), 'the seed line must survive');
  assert.equal(lines.length, 2, 'seed + the new run');
});

test('audit --export writes docs/AUDIT.md with the columns', (t) => {
  const dir = project(t, 'audit-export');
  writeVerifyRun(dir, { ok: true, story: 'epics/e1/story-01-01', when: '2026-07-21T10:00:00.000Z' });

  const res = run(dir, ['audit', '--export']);
  assert.equal(res.code, 0, res.output);
  const md = fs.readFileSync(path.join(dir, 'docs', 'AUDIT.md'), 'utf8');
  assert.match(md, /# Audit ledger/);
  assert.match(md, /\| Date \| Type \| Result \|/);
  assert.match(md, /story-01-01/);
  assert.match(md, /abc1234/);
});

test('audit --check fails when the latest verify is red', (t) => {
  const dir = project(t, 'audit-check-red');
  writeVerifyRun(dir, { ok: true, story: 's1', when: '2026-07-21T09:00:00.000Z' });
  writeVerifyRun(dir, { ok: false, story: 's1', when: '2026-07-21T10:00:00.000Z' });

  const res = run(dir, ['audit', '--check']);
  assert.equal(res.code, 1, 'the latest red verify must fail the gate');
  assert.match(res.output, /FAILED/);
});

test('audit --check passes when the latest verify per story is green', (t) => {
  const dir = project(t, 'audit-check-green');
  writeVerifyRun(dir, { ok: false, story: 's1', when: '2026-07-21T09:00:00.000Z' });
  writeVerifyRun(dir, { ok: true, story: 's1', when: '2026-07-21T10:00:00.000Z' });

  const res = run(dir, ['audit', '--check']);
  assert.equal(res.code, 0, 'the most recent one is green → green gate');
  assert.match(res.output, /passed/);
});

test('audit --check fails when there is no run', (t) => {
  const dir = project(t, 'audit-check-empty');
  const res = run(dir, ['audit', '--check']);
  assert.equal(res.code, 1, 'no proof = not verified = failure');
});

test('audit --check does not mutate the ledger', (t) => {
  const dir = project(t, 'audit-check-nomutate');
  writeVerifyRun(dir, { ok: true, when: '2026-07-21T10:00:00.000Z' });
  run(dir, ['audit', '--check']);
  assert.equal(ledgerLines(dir).length, 0, '--check is read-only');
});

test('audit --since filters the entries', (t) => {
  const dir = project(t, 'audit-since');
  writeVerifyRun(dir, { ok: true, when: '2026-07-20T10:00:00.000Z' });
  writeVerifyRun(dir, { ok: true, when: '2026-07-21T10:00:00.000Z' });

  const res = run(dir, ['audit', '--since', '2026-07-21T00:00:00.000Z', '--json']);
  assert.equal(res.code, 0, res.output);
  const entries = JSON.parse(res.output);
  assert.equal(entries.length, 1, 'a single entry after the threshold');
  assert.equal(entries[0].generatedAt, '2026-07-21T10:00:00.000Z');
});
