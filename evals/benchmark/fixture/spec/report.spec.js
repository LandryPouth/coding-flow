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

const file = (router, over = {}) =>
  router['POST /expenses']({
    actorId: 'alice',
    description: 'Something',
    amount: '10.00',
    category: 'travel',
    spentOn: '2026-03-01',
    ...over,
  });

test('totals are grouped by category', () => {
  const { router } = app();
  file(router, { amount: '10.00', category: 'travel' });
  file(router, { amount: '25.50', category: 'travel' });
  file(router, { amount: '9.99', category: 'software' });

  assert.deepEqual(router['GET /report']({}).body, { travel: 3550, software: 999 });
});

test('editing an amount is reflected in the totals', () => {
  const { router } = app();
  const created = file(router, { amount: '10.00', category: 'travel' }).body;

  router['PATCH /expenses']({ id: created.id, amount: '40.00' });

  assert.deepEqual(router['GET /report']({}).body, { travel: 4000 });
});

test('the summary renders each category once, sorted', () => {
  const { reporter, router } = app();
  file(router, { amount: '10.00', category: 'travel' });
  file(router, { amount: '5.00', category: 'meals' });

  assert.equal(reporter.summary(), 'meals: $5.00\ntravel: $10.00');
});
