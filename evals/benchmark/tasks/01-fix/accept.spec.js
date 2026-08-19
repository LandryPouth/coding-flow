'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { formatAmount } = require('../src/money');

test('a negative amount puts the sign before the currency', () => {
  assert.equal(formatAmount(-1234), '-$12.34');
  assert.equal(formatAmount(-700), '-$7.00');
});

test('a negative amount under one unit keeps its sign', () => {
  assert.equal(formatAmount(-34), '-$0.34');
  assert.equal(formatAmount(-5), '-$0.05');
});

test('positive amounts and zero are unchanged', () => {
  assert.equal(formatAmount(1234), '$12.34');
  assert.equal(formatAmount(5), '$0.05');
  assert.equal(formatAmount(0), '$0.00');
});
