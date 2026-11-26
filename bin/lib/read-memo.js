"use strict";

// Story 34-02: facts about a checkout that cannot change while a read-only
// report is being built — its tree token, its current branch, its run files —
// were recomputed once per story, so `next` on a repository of 200 stories
// spawned git thousands of times (3 min 28 s on one). Inside `withReadMemo`, each
// such fact is computed once per (kind, key) and reused; outside it, `remember`
// computes every time, as before.
//
// The memo lives in memory for the duration of one synchronous call and is
// dropped when it returns. Only read-only paths open it (`buildStatusModel`,
// `next`'s queue): a command that writes to the tree (verify, land, worktree,
// archive, todo done…) runs its writes outside it, so it never reads a token
// that its own write made stale. No file, no daemon (design decisions).

let active = null;

// Runs `fn` with a memo open. A nested call shares the memo already open, so
// `next` and the status model it builds reuse one another's facts.
function withReadMemo(fn) {
  if (active) {
    return fn();
  }

  active = new Map();

  try {
    return fn();
  } finally {
    active = null;
  }
}

function remember(kind, key, compute) {
  if (!active) {
    return compute();
  }

  const id = `${kind}\0${key}`;

  if (!active.has(id)) {
    active.set(id, compute());
  }

  return active.get(id);
}

module.exports = { withReadMemo, remember };
