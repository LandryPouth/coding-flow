'use strict';

// Tests of the `ship` evidence helpers: the markdown block is well-formed, its
// insertion into a PR body is idempotent (replaces between markers, never the
// human text), and latestVerifyEvidence keeps the most recent run.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildEvidenceBlock, upsertEvidenceBlock, latestVerifyEvidence } = require('../bin/lib/ship');

const START = '<!-- coding-flow:evidence:start -->';
const END = '<!-- coding-flow:evidence:end -->';

function sampleEvidence(ok = true) {
  return {
    generatedAt: '2026-07-21T10:00:00.000Z',
    story: 'epics/epic-01/story-01-01-demo',
    commandSource: 'config',
    commandsFound: 2,
    ok,
    provenance: {
      git: { shortCommit: 'abc1234', commit: 'abc1234def', dirty: false, author: { name: 'Ada Lovelace' } },
    },
    results: [
      { command: 'npm run typecheck', ok: true, exitCode: 0, timedOut: false, durationMs: 1200 },
      { command: 'npm test', ok, exitCode: ok ? 0 : 1, timedOut: false, durationMs: 3400 },
    ],
  };
}

test('buildEvidenceBlock wraps the proof between the markers', () => {
  const block = buildEvidenceBlock(sampleEvidence(true));
  assert.ok(block.startsWith(START));
  assert.ok(block.trim().endsWith(END));
  assert.match(block, /✅ passed/);
  assert.match(block, /abc1234/);
  assert.match(block, /Ada Lovelace/);
  assert.match(block, /npm test/);
});

test('buildEvidenceBlock marks a failure', () => {
  const block = buildEvidenceBlock(sampleEvidence(false));
  assert.match(block, /❌ FAILED/);
  assert.match(block, /exit 1/);
});

test('upsertEvidenceBlock appends the block to a human body without overwriting it', () => {
  const body = 'Resolves #42.\n\nPR details written by a human.';
  const block = buildEvidenceBlock(sampleEvidence(true));
  const next = upsertEvidenceBlock(body, block);
  assert.match(next, /Resolves #42/);
  assert.match(next, /written by a human/);
  assert.ok(next.includes(START) && next.includes(END));
});

test('upsertEvidenceBlock is idempotent (replaces, does not duplicate)', () => {
  const body = 'Human text.';
  const first = upsertEvidenceBlock(body, buildEvidenceBlock(sampleEvidence(true)));
  const second = upsertEvidenceBlock(first, buildEvidenceBlock(sampleEvidence(false)));

  // A single block, and it is the most recent one (FAILED) that replaced the old.
  assert.equal(second.match(new RegExp(START, 'g')).length, 1);
  assert.equal(second.match(new RegExp(END, 'g')).length, 1);
  assert.match(second, /❌ FAILED/);
  assert.doesNotMatch(second, /✅ passed/);
  assert.match(second, /Human text/);
});

test('latestVerifyEvidence keeps the most recent run, null if none', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-shipev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(latestVerifyEvidence(dir), null, 'no run → null');

  const runs = path.join(dir, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, '2026-07-21T09-00-00-000Z-verify.json'), JSON.stringify({ ok: true, tag: 'old' }));
  fs.writeFileSync(path.join(runs, '2026-07-21T10-00-00-000Z-verify.json'), JSON.stringify({ ok: false, tag: 'new' }));
  // An evidence file must not be confused with a verify.
  fs.writeFileSync(path.join(runs, '2026-07-21T11-00-00-000Z-evidence.json'), JSON.stringify({ tag: 'evidence' }));

  const latest = latestVerifyEvidence(dir);
  assert.equal(latest.tag, 'new', 'the most recent verify run is kept');
});
