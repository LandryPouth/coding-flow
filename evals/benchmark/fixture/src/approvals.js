'use strict';

const { getUser } = require('./users');

function approveExpense(store, { actorId, expenseId }) {
  const actor = getUser(actorId);

  if (!actor) {
    throw new Error(`unknown actor: ${actorId}`);
  }

  if (!actor.role) {
    throw new Error(`actor has no role: ${actorId}`);
  }

  const expense = store.get(expenseId);

  if (!expense) {
    throw new Error(`no such expense: ${expenseId}`);
  }

  if (expense.status !== 'submitted') {
    throw new Error(`cannot approve a ${expense.status} expense`);
  }

  return store.update(expenseId, { status: 'approved', decidedBy: actor.id });
}

function rejectExpense(store, { actorId, expenseId, reason }) {
  const actor = getUser(actorId);

  if (!actor) {
    throw new Error(`unknown actor: ${actorId}`);
  }

  const expense = store.get(expenseId);

  if (!expense) {
    throw new Error(`no such expense: ${expenseId}`);
  }

  if (expense.status !== 'submitted') {
    throw new Error(`cannot reject a ${expense.status} expense`);
  }

  return store.update(expenseId, { status: 'rejected', decidedBy: actor.id, reason });
}

module.exports = { approveExpense, rejectExpense };
