'use strict';

function requireFields(payload, fields) {
  for (const field of fields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      throw new Error(`missing field: ${field}`);
    }
  }
}

function rejectUnknownFields(payload, allowed) {
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) {
      throw new Error(`unknown field: ${key}`);
    }
  }
}

module.exports = { requireFields, rejectUnknownFields };
