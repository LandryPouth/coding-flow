'use strict';

// `selectFailureLines` decides what a red verify says about itself. It once kept
// 12 lines of a node:test spec run and none of them named the failing test: the
// spec reporter marks a failure `✖` and a pass `✔`, neither was known, and the
// assertion's JSON dump filled the budget. A reviewer could not tell which test
// had failed under load, nor rerun it alone.

const { test } = require('node:test');
const assert = require('node:assert');

const { selectFailureLines } = require('../bin/lib/util');

// The shape node:test's spec reporter prints for one failure: the inline ✖, then
// the closing summary that repeats it with its location, then the assertion.
const SPEC_RUN = [
  '✔ worktree land releases the shared lock when the removal fails (3679ms)',
  '✖ upgrade refreshes the OpenCode skills (5012ms)',
  'ℹ tests 1452',
  'ℹ pass 1451',
  'ℹ fail 1',
  '✖ failing tests:',
  '',
  'test at test/upgrade.test.js:118:1',
  '✖ upgrade refreshes the OpenCode skills (5012ms)',
  '  AssertionError [ERR_ASSERTION]: {',
  '    "failOnContrarySignals": false,',
  '    "failures": [],',
  '    "assertionsRemoved": [],',
  '    "toolError": null,',
  '    "failureLines": [],',
  '    "errors": [],',
  '    "failedCommands": [],',
  '    "toolError": null,',
  '    "expectedExit": 0,',
  '    "failure": null,',
  '    "lastError": null,',
  '  }',
  "    code: 'ERR_ASSERTION',",
  '    expected: 0,',
].join('\n');

test('a spec-reporter failure keeps the failing test name and its location', () => {
  const lines = selectFailureLines(SPEC_RUN);

  assert.ok(lines.includes('✖ upgrade refreshes the OpenCode skills (5012ms)'), lines.join('\n'));
  assert.ok(lines.includes('test at test/upgrade.test.js:118:1'), lines.join('\n'));
  assert.ok(lines.length <= 12);
});

test('a spec-reporter pass is not a failure, even when its name says "fails"', () => {
  // Short enough that the budget cannot be what drops the pass.
  const lines = selectFailureLines(
    ['✔ worktree land releases the lock when the removal fails (3679ms)', '✖ the cart totals VAT (4ms)', 'ℹ fail 1'].join('\n'),
  );

  assert.deepStrictEqual(lines, ['✖ the cart totals VAT (4ms)', 'ℹ fail 1']);
});

test('the name is kept once, and the assertion lines still fill what is left', () => {
  const lines = selectFailureLines(SPEC_RUN);

  assert.strictEqual(lines.filter((line) => line.startsWith('✖ upgrade')).length, 1);
  assert.ok(lines.includes('expected: 0,'), lines.join('\n'));
});

test('TAP is read as before: the not-ok line and its assertion', () => {
  const lines = selectFailureLines(
    ['ok 395 - verify fails cleanly', 'not ok 396 - the cart totals VAT', '  AssertionError: expected 3 got 0', '# fail 1'].join('\n'),
  );

  assert.deepStrictEqual(lines, ['not ok 396 - the cart totals VAT', 'AssertionError: expected 3 got 0', '# fail 1']);
});

test('past the budget, the oldest test names give way only to newer test names', () => {
  const names = Array.from({ length: 15 }, (_, i) => `not ok ${i + 1} - case ${i + 1}`);
  const lines = selectFailureLines([...names, '  AssertionError: expected 1 got 2'].join('\n'));

  assert.strictEqual(lines.length, 12);
  assert.strictEqual(lines[lines.length - 1], 'AssertionError: expected 1 got 2');
  assert.ok(!lines.includes('not ok 1 - case 1'));
  assert.ok(lines.includes('not ok 15 - case 15'));
});
