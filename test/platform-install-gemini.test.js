'use strict';

const { defineSuite } = require('../test-support/commands-only-suite');

defineSuite({
  target: 'gemini',
  files: (name) => `.gemini/commands/coding-flow/${name}.toml`,
  parser: 'toml',
  describe: (parsed) => parsed.description,
});
