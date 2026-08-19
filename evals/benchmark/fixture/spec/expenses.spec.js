'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/store');
const { createExpense, updateExpense, listExpenses } = require('../src/expenses');

const VALID = {
  actorId: 'alice',
  description: 'Train to the client site',
  amount: '84.50',
  category: 'travel',
  spentOn: '2026-03-02',
};

test('an expense is created against its owner, in cents, as submitted', () => {
  const store = createStore();
  const expense = createExpense(store, VALID);

  assert.equal(expense.ownerId, 'alice');
  assert.equal(expense.amountCents, 8450);
  assert.equal(expense.status, 'submitted');
});

test('an unknown actor cannot file an expense', () => {
  const store = createStore();
  assert.throws(() => createExpense(store, { ...VALID, actorId: 'nobody' }), /unknown actor/);
});

test('missing and unknown fields are both refused', () => {
  const store = createStore();
  const { amount, ...withoutAmount } = VALID;

  assert.throws(() => createExpense(store, withoutAmount), /missing field: amount/);
  assert.throws(() => createExpense(store, { ...VALID, vat: '20' }), /unknown field: vat/);
});

test('the category must be one we recognise', () => {
  const store = createStore();
  assert.throws(() => createExpense(store, { ...VALID, category: 'bribes' }), /unknown category/);
});

test('a submitted expense can be edited', () => {
  const store = createStore();
  const created = createExpense(store, VALID);
  const updated = updateExpense(store, created.id, { amount: '90.00' });

  assert.equal(updated.amountCents, 9000);
});

test('expenses can be listed for one owner', () => {
  const store = createStore();
  createExpense(store, VALID);
  createExpense(store, { ...VALID, actorId: 'bruno' });

  assert.equal(listExpenses(store).length, 2);
  assert.equal(listExpenses(store, { ownerId: 'bruno' }).length, 1);
});
