'use strict';

const { getUser } = require('./users');
const { parseAmount } = require('./money');
const { requireFields, rejectUnknownFields } = require('./validate');

const CATEGORIES = ['travel', 'meals', 'software', 'hardware'];
const FIELDS = ['actorId', 'description', 'amount', 'category', 'spentOn'];

function createExpense(store, payload) {
  const actor = getUser(payload.actorId);

  if (!actor) {
    throw new Error(`unknown actor: ${payload.actorId}`);
  }

  if (!actor.role) {
    throw new Error(`actor has no role: ${payload.actorId}`);
  }

  rejectUnknownFields(payload, FIELDS);
  requireFields(payload, FIELDS);

  if (!CATEGORIES.includes(payload.category)) {
    throw new Error(`unknown category: ${payload.category}`);
  }

  return store.insert({
    ownerId: actor.id,
    description: String(payload.description),
    amountCents: parseAmount(payload.amount),
    category: payload.category,
    spentOn: payload.spentOn,
    status: 'submitted',
  });
}

function updateExpense(store, id, payload) {
  const expense = store.get(id);

  if (!expense) {
    throw new Error(`no such expense: ${id}`);
  }

  if (expense.status !== 'submitted') {
    throw new Error(`cannot edit a ${expense.status} expense`);
  }

  const changes = {};

  if (payload.description !== undefined) changes.description = String(payload.description);
  if (payload.amount !== undefined) changes.amountCents = parseAmount(payload.amount);

  if (payload.category !== undefined) {
    if (!CATEGORIES.includes(payload.category)) {
      throw new Error(`unknown category: ${payload.category}`);
    }

    changes.category = payload.category;
  }

  return store.update(id, changes);
}

function listExpenses(store, { ownerId } = {}) {
  return store.all().filter((expense) => !ownerId || expense.ownerId === ownerId);
}

module.exports = { createExpense, updateExpense, listExpenses, CATEGORIES };
