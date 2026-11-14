'use strict';

// Story 13-10: this repository's own `highRiskPaths` covers the modules that
// decide a denial, a risk level or a proof. Story 13-03 put the security core
// there; 15-02 then moved the guard's shell parser into `shell-writes.js`,
// which nothing added, so a diff that weakened the guard ran STANDARD. This
// test reads the real `.coding-flow/harness.json` and the real require lines
// of `guard.js` and `evidence.js`, so the next extraction cannot drop a module
// out of STRICT silently.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { scoreDiffRisk } = require('../bin/lib/risk');

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, '.coding-flow', 'harness.json'), 'utf8'));

function scoredPaths(files) {
  // Each file alone, so one match cannot hide another's miss.
  return files.filter((file) => !scoreDiffRisk([file], config, root).matchedPaths.includes(file));
}

function directLocalRequires(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/require\(\s*["']\.\/([\w.-]+)["']\s*\)/g)) {
    names.add(`bin/lib/${match[1].replace(/\.js$/, '')}.js`);
  }
  return [...names].sort();
}

test('every module guard.js and evidence.js require directly is a high-risk path here', () => {
  const required = [...new Set([...directLocalRequires('bin/lib/guard.js'), ...directLocalRequires('bin/lib/evidence.js')])].sort();

  assert.ok(required.includes('bin/lib/shell-writes.js'), 'the parse found the guard\'s requires');
  assert.ok(required.includes('bin/lib/risk.js'), 'the parse found evidence\'s requires');
  assert.deepStrictEqual(scoredPaths(required), [], 'these modules decide a denial or a proof but score low');
});

test('the modules that decide a denial, a risk level or a proof are high-risk paths here', () => {
  const core = [
    'bin/lib/guard.js',
    'bin/lib/shell-writes.js',
    'bin/lib/risk.js',
    'bin/lib/harness-config.js',
    'bin/lib/validation-run.js',
    'bin/lib/diff-scope.js',
    'bin/lib/claim.js',
    'bin/lib/policy-drift.js',
    'bin/lib/hook.js',
    'bin/lib/util.js',
    'scripts/test-env-guard.js',
  ];

  assert.deepStrictEqual(scoredPaths(core), [], 'these modules decide a denial or a proof but score low');
});
