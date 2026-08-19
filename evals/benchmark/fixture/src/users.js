'use strict';

const USERS = {
  alice: { id: 'alice', name: 'Alice', role: 'employee' },
  bruno: { id: 'bruno', name: 'Bruno', role: 'employee' },
  clara: { id: 'clara', name: 'Clara', role: 'manager' },
  dinah: { id: 'dinah', name: 'Dinah', role: 'manager' },
};

function getUser(id) {
  return USERS[id] || null;
}

module.exports = { getUser, USERS };
