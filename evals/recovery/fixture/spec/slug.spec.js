const { test } = require("node:test");
const assert = require("node:assert");

const { slugify } = require("../src/util");

test("slugify folds punctuation and case", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
});
