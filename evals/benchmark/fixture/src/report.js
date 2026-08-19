'use strict';

const { sumCents, formatAmount } = require('./money');

// Totals are read far more often than expenses change, so the per-category
// grouping is built once and reused.
function createReporter(store) {
  let index = null;

  function build() {
    const grouped = new Map();

    for (const expense of store.all()) {
      const bucket = grouped.get(expense.category) || [];
      bucket.push(expense.amountCents);
      grouped.set(expense.category, bucket);
    }

    return grouped;
  }

  return {
    totalsByCategory() {
      if (!index) {
        index = build();
      }

      const totals = {};

      for (const [category, amounts] of index) {
        totals[category] = sumCents(amounts);
      }

      return totals;
    },

    // Called by the write paths so the cached grouping does not go stale.
    invalidate() {
      index = null;
    },

    summary() {
      const totals = this.totalsByCategory();

      return Object.entries(totals)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, cents]) => `${category}: ${formatAmount(cents)}`)
        .join('\n');
    },
  };
}

module.exports = { createReporter };
