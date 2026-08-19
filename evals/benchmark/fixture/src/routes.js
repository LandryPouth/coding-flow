'use strict';

const { getUser } = require('./users');
const { createExpense, updateExpense, listExpenses } = require('./expenses');
const { approveExpense, rejectExpense } = require('./approvals');

// Thin transport layer: no business rules live here, only shaping.
function createRouter(store, reporter) {
  function handle(fn) {
    try {
      return { status: 200, body: fn() };
    } catch (error) {
      return { status: 400, body: { error: error.message } };
    }
  }

  return {
    'POST /expenses': (req) =>
      handle(() => {
        const actor = getUser(req.actorId);

        if (!actor) {
          throw new Error(`unknown actor: ${req.actorId}`);
        }

        if (!actor.role) {
          throw new Error(`actor has no role: ${req.actorId}`);
        }

        const created = createExpense(store, req);
        reporter.invalidate();
        return created;
      }),

    'PATCH /expenses': (req) =>
      handle(() => {
        const updated = updateExpense(store, req.id, req);
        reporter.invalidate();
        return updated;
      }),

    'GET /expenses': (req) => handle(() => listExpenses(store, { ownerId: req.ownerId })),

    'POST /approvals': (req) =>
      handle(() => {
        const decided = approveExpense(store, req);
        reporter.invalidate();
        return decided;
      }),

    'POST /rejections': (req) =>
      handle(() => {
        const decided = rejectExpense(store, req);
        reporter.invalidate();
        return decided;
      }),

    'GET /report': () => handle(() => reporter.totalsByCategory()),
  };
}

module.exports = { createRouter };
