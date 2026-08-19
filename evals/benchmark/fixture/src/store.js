'use strict';

// A tiny in-memory collection. Records are plain objects keyed by id.

function createStore() {
  const records = new Map();
  let nextId = 1;

  return {
    insert(record) {
      const id = `r${nextId}`;
      nextId += 1;
      const stored = { id, ...record };
      records.set(id, stored);
      return stored;
    },

    update(id, changes) {
      const stored = records.get(id);

      if (!stored) {
        throw new Error(`no such record: ${id}`);
      }

      Object.assign(stored, changes);
      return stored;
    },

    get(id) {
      return records.get(id) || null;
    },

    all() {
      return [...records.values()];
    },
  };
}

module.exports = { createStore };
