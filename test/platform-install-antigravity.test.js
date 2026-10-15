'use strict';

const { defineSuite } = require('../test-support/commands-only-suite');

defineSuite({
  target: 'antigravity',
  files: (name) => `.agent/skills/${name}/SKILL.md`,
  parser: 'yaml',
  describe: (parsed) => parsed.description,
});
