'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/store');
const { createReporter } = require('../src/report');
const { createRouter } = require('../src/routes');

function app() {
  const store = createStore();
  const reporter = createReporter(store);
  return { store, reporter, router: createRouter(store, reporter) };
}

const file = (router, amount, category = 'travel') =>
  router['POST /expenses']({
    actorId: 'alice',
    description: 'Something',
    amount,
    category,
    spentOn: '2026-03-01',
  }).body;

test('a rejected expense is not counted in the totals', () => {
  const { router } = app();
  file(router, '100.00');
  const refused = file(router, '250.00');

  router['POST /rejections']({ actorId: 'clara', expenseId: refused.id, reason: 'no receipt' });

  assert.deepEqual(router['GET /report']({}).body, { travel: 10000 });
});

test('a category emptied entirely by rejections disappears rather than reading zero', () => {
  const { router } = app();
  const refused = file(router, '80.00', 'meals');
  file(router, '100.00', 'travel');

  router['POST /rejections']({ actorId: 'clara', expenseId: refused.id, reason: 'duplicate' });

  assert.deepEqual(router['GET /report']({}).body, { travel: 10000 });
});

test('submitted and approved expenses both still count', () => {
  const { router } = app();
  const approved = file(router, '100.00');
  file(router, '40.00');

  router['POST /approvals']({ actorId: 'clara', expenseId: approved.id });

  assert.deepEqual(router['GET /report']({}).body, { travel: 14000 });
});

test('the summary agrees with the totals', () => {
  const { reporter, router } = app();
  file(router, '100.00', 'travel');
  const refused = file(router, '60.00', 'meals');

  router['POST /rejections']({ actorId: 'clara', expenseId: refused.id, reason: 'no receipt' });

  assert.equal(reporter.summary(), 'travel: $100.00');
});

test('rejecting through the domain, not the router, is also excluded', () => {
  const { store, reporter, router } = app();
  file(router, '100.00');
  const refused = file(router, '250.00');

  require('../src/approvals').rejectExpense(store, {
    actorId: 'clara',
    expenseId: refused.id,
    reason: 'no receipt',
  });
  reporter.invalidate();

  assert.deepEqual(reporter.totalsByCategory(), { travel: 10000 });
});
