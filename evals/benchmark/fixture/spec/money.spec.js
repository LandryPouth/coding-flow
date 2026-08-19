'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseAmount, formatAmount, sumCents } = require('../src/money');

test('amounts are read into integer cents', () => {
  assert.equal(parseAmount('12.34'), 1234);
  assert.equal(parseAmount('12,34'), 1234);
  assert.equal(parseAmount('7'), 700);
  assert.equal(parseAmount('0.5'), 50);
  assert.equal(parseAmount(1234), 1234);
});

test('a malformed amount is refused rather than guessed', () => {
  assert.throws(() => parseAmount('twelve'), /cannot read amount/);
  assert.throws(() => parseAmount('1.234'), /cannot read amount/);
  assert.throws(() => parseAmount(12.34), /must be given in cents/);
});

test('amounts render with two decimals', () => {
  assert.equal(formatAmount(1234), '$12.34');
  assert.equal(formatAmount(700), '$7.00');
  assert.equal(formatAmount(5), '$0.05');
});

test('summing stays in cents', () => {
  assert.equal(sumCents([1234, 700, 5]), 1939);
  assert.equal(sumCents([]), 0);
});
