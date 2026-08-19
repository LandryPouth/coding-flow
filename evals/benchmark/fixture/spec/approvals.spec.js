'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/store');
const { createExpense } = require('../src/expenses');
const { approveExpense, rejectExpense } = require('../src/approvals');

const VALID = {
  actorId: 'alice',
  description: 'Team lunch',
  amount: '62.00',
  category: 'meals',
  spentOn: '2026-03-04',
};

function filed() {
  const store = createStore();
  return { store, expense: createExpense(store, VALID) };
}

test('a manager approves a submitted expense', () => {
  const { store, expense } = filed();
  const decided = approveExpense(store, { actorId: 'clara', expenseId: expense.id });

  assert.equal(decided.status, 'approved');
  assert.equal(decided.decidedBy, 'clara');
});

test('a manager rejects with a reason', () => {
  const { store, expense } = filed();
  const decided = rejectExpense(store, { actorId: 'clara', expenseId: expense.id, reason: 'no receipt' });

  assert.equal(decided.status, 'rejected');
  assert.equal(decided.reason, 'no receipt');
});

test('a decided expense cannot be decided twice', () => {
  const { store, expense } = filed();
  approveExpense(store, { actorId: 'clara', expenseId: expense.id });

  assert.throws(() => approveExpense(store, { actorId: 'dinah', expenseId: expense.id }), /cannot approve/);
  assert.throws(() => rejectExpense(store, { actorId: 'dinah', expenseId: expense.id }), /cannot reject/);
});

test('an unknown actor decides nothing', () => {
  const { store, expense } = filed();
  assert.throws(() => approveExpense(store, { actorId: 'nobody', expenseId: expense.id }), /unknown actor/);
});
