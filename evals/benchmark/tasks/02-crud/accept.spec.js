'use strict';

// Only the router is exercised, because it is the one surface the prompt names.
// Where the vendor logic lives is the implementer's decision.

const { test } = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/store');
const { createReporter } = require('../src/report');
const { createRouter } = require('../src/routes');

function app() {
  const store = createStore();
  return createRouter(store, createReporter(store));
}

const create = (router, body) => router['POST /vendors']({ actorId: 'alice', ...body });

test('the router exposes list, create and edit for vendors', () => {
  const router = app();

  for (const route of ['GET /vendors', 'POST /vendors', 'PATCH /vendors']) {
    assert.equal(typeof router[route], 'function', `missing route: ${route}`);
  }
});

test('a vendor is created and listed', () => {
  const router = app();
  const created = create(router, { name: 'Trainline', country: 'FR' });

  assert.equal(created.status, 200, JSON.stringify(created.body));

  const listed = router['GET /vendors']({}).body;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'Trainline');
  assert.equal(listed[0].country, 'FR');
  assert.ok(listed[0].id, 'a vendor carries an id');
});

test('a vendor is edited in place', () => {
  const router = app();
  const created = create(router, { name: 'Trainline', country: 'FR' }).body;

  const updated = router['PATCH /vendors']({ id: created.id, country: 'BE' });

  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(router['GET /vendors']({}).body[0].country, 'BE');
  assert.equal(router['GET /vendors']({}).body.length, 1, 'editing must not create a second vendor');
});

test('a blank name and a missing country are both refused', () => {
  const router = app();

  assert.equal(create(router, { name: '', country: 'FR' }).status, 400);
  assert.equal(create(router, { name: 'Trainline' }).status, 400);
});

test('two vendors cannot share a name', () => {
  const router = app();
  create(router, { name: 'Trainline', country: 'FR' });

  const duplicate = create(router, { name: 'Trainline', country: 'BE' });

  assert.equal(duplicate.status, 400, 'a duplicate name must be refused');
  assert.equal(router['GET /vendors']({}).body.length, 1);
});

test('vendors do not leak into the expense report', () => {
  const router = app();
  create(router, { name: 'Trainline', country: 'FR' });

  assert.deepEqual(router['GET /report']({}).body, {});
});
