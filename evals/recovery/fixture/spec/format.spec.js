const { test } = require("node:test");
const assert = require("node:assert");

const { formatRun } = require("../src/util");

test("formatRun joins the id and status", () => {
  assert.equal(formatRun({ id: "r1", status: "done" }), "r1:done");
});
