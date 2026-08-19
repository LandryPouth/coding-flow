'use strict';

// A characterization test: it pins the behaviour that must survive the refactor,
// including the exact error messages, at all three original call sites. It says
// nothing about where the shared code should live — that is the point of the task.

const { test } = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/store');
const { createReporter } = require('../src/report');
const { createRouter } = require('../src/routes');
const { createExpense } = require('../src/expenses');
const { approveExpense } = require('../src/approvals');

const VALID = {
  actorId: 'alice',
  description: 'Train',
  amount: '10.00',
  category: 'travel',
  spentOn: '2026-03-01',
};

test('the domain still refuses an unknown actor, with the same message', () => {
  const store = createStore();

  assert.throws(
    () => createExpense(store, { ...VALID, actorId: 'nobody' }),
    /^Error: unknown actor: nobody$/,
  );

  const expense = createExpense(store, VALID);

  assert.throws(
    () => approveExpense(store, { actorId: 'nobody', expenseId: expense.id }),
    /^Error: unknown actor: nobody$/,
  );
});

test('the router still refuses an unknown actor, with the same message', () => {
  const store = createStore();
  const router = createRouter(store, createReporter(store));
  const response = router['POST /expenses']({ ...VALID, actorId: 'nobody' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'unknown actor: nobody');
});

test('a known actor is still let through everywhere', () => {
  const store = createStore();
  const router = createRouter(store, createReporter(store));
  const created = router['POST /expenses'](VALID);

  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(approveExpense(store, { actorId: 'clara', expenseId: created.body.id }).status, 'approved');
});

test('the check is reached before validation, as it was', () => {
  const store = createStore();
  const { amount, ...incomplete } = VALID;

  // Both wrong: unknown actor AND a missing field. The actor error is the one
  // that surfaced before the refactor, and must still be the one that surfaces.
  assert.throws(
    () => createExpense(store, { ...incomplete, actorId: 'nobody' }),
    /unknown actor/,
  );
});
