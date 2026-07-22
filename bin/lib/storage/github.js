"use strict";

// "github" storage backend: epics <-> issues, stories <-> sub-issues.
//
// SEAM IN PLACE, IMPLEMENTATION DEFERRED. The mapping would go through `gh api
// graphql` (sub-issues don't yet have a first-class command in `gh`), which
// would turn `gh` from an optional dependency into a hard one and add a network
// access on every epic/story read. We only pay that cost if a real user asks for
// it — see docs/plans/storage-backends.md.
//
// Until then, choosing this backend fails cleanly (clear message) rather than
// crashing: the seam is proven, the door is open, nothing is broken.

const { fail } = require("../util");

function createGithubStorage() {
  const notImplemented = () =>
    fail(
      "the 'github' storage backend is not implemented yet. " +
        "Only 'local' is available for now (see docs/plans/storage-backends.md).",
    );

  return {
    kind: "github",
    listEpics: notImplemented,
  };
}

module.exports = { createGithubStorage };
