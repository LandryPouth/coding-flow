'use strict';

const { defineSuite } = require('../test-support/commands-only-suite');

defineSuite({
  target: 'opencode',
  files: (name) => `.opencode/command/coding-flow/${name}.md`,
  parser: 'yaml',
  describe: (parsed) => parsed.description,
});
