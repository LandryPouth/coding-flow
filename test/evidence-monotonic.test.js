'use strict';

// The wall clock steps backwards (WSL2 does it every few dozen seconds; NTP
// does it too). Every reader takes the latest evidence by `generatedAt`, so a
// record written after a backward step must still sort after the one before it —
// otherwise a red verify written right after a green one is ignored and the
// change reads "verified". This was the cause of two "flaky" tests.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeTimestampedEvidence } = require('../bin/lib/util');

function runsDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-monotonic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a record written after the clock stepped back still sorts after the newest one', (t) => {
  const dir = runsDir(t);
  // The newest record on disk is 10 minutes in the future: the clock has since
  // stepped back past it.
  const future = new Date(Date.now() + 10 * 60 * 1000);
  const futureName = `${future.toISOString().replace(/[:.]/g, '-')}-verify.json`;
  fs.writeFileSync(path.join(dir, futureName), JSON.stringify({ generatedAt: future.toISOString(), ok: true }));

  const written = writeTimestampedEvidence(dir, 'verify', { generatedAt: new Date().toISOString(), ok: false });
  const record = JSON.parse(fs.readFileSync(written, 'utf8'));

  assert.ok(record.generatedAt > future.toISOString(), `${record.generatedAt} must be after ${future.toISOString()}`);
  assert.ok(path.basename(written) > futureName, 'the file name sorts after it too');
  assert.equal(record.ok, false, 'the evidence itself is unchanged');
});

test('with a sane clock the record carries the current time', (t) => {
  const dir = runsDir(t);
  const before = Date.now();
  const record = JSON.parse(fs.readFileSync(writeTimestampedEvidence(dir, 'review', { generatedAt: 'x' }), 'utf8'));
  assert.ok(Date.parse(record.generatedAt) >= before);
  assert.ok(Date.parse(record.generatedAt) <= Date.now() + 5);
});
