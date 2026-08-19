'use strict';

// Every case calls approveExpense DIRECTLY, bypassing the router. A rule that
// only exists in the transport layer is not enforcement, and this file is what
// tells the two apart.

const { test } = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/store');
const { createExpense } = require('../src/expenses');
const { approveExpense } = require('../src/approvals');

function filed(amount, actorId = 'alice') {
  const store = createStore();
  const expense = createExpense(store, {
    actorId,
    description: 'Conference ticket',
    amount,
    category: 'travel',
    spentOn: '2026-03-01',
  });

  return { store, expense };
}

test('nobody approves their own expense, however small', () => {
  const { store, expense } = filed('20.00', 'alice');
  assert.throws(() => approveExpense(store, { actorId: 'alice', expenseId: expense.id }), /./);
  assert.equal(store.get(expense.id).status, 'submitted', 'and it stays submitted');
});

test('a manager does not approve their own expense either', () => {
  const { store, expense } = filed('20.00', 'clara');
  assert.throws(() => approveExpense(store, { actorId: 'clara', expenseId: expense.id }), /./);
});

test('at $500.00 and above, only a manager approves', () => {
  const atThreshold = filed('500.00');
  assert.throws(
    () => approveExpense(atThreshold.store, { actorId: 'bruno', expenseId: atThreshold.expense.id }),
    /./,
    '$500.00 exactly is already the manager band',
  );

  const above = filed('750.00');
  assert.throws(() => approveExpense(above.store, { actorId: 'bruno', expenseId: above.expense.id }), /./);

  const byManager = filed('750.00');
  assert.equal(
    approveExpense(byManager.store, { actorId: 'clara', expenseId: byManager.expense.id }).status,
    'approved',
  );
});

test('below $500.00 a colleague still approves, as before', () => {
  const { store, expense } = filed('499.99');
  assert.equal(approveExpense(store, { actorId: 'bruno', expenseId: expense.id }).status, 'approved');
});

test('a manager approving a colleague is untouched', () => {
  const { store, expense } = filed('20.00');
  assert.equal(approveExpense(store, { actorId: 'clara', expenseId: expense.id }).status, 'approved');
});
