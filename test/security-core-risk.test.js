'use strict';

// Story 13-10: this repository's own `highRiskPaths` covers the modules that
// decide a denial, a risk level or a proof. Story 13-03 put the security core
// there; 15-02 then moved the guard's shell parser into `shell-writes.js`,
// which nothing added, so a diff that weakened the guard ran STANDARD. This
// test reads the real `.coding-flow/harness.json` and follows the real local
// requires of every listed `bin/lib/` module, transitively, so the next
// extraction cannot drop a module out of STRICT silently.

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

// Modules a high-risk module may require without being high-risk themselves.
// Each one says why: it decides no denial, risk level or proof.
const NOT_SECURITY_CORE = new Map([
  // What the harness prints; every verdict it shows is computed elsewhere.
  ['bin/lib/harness-report.js', 'output only'],
]);

// The local requires of a file, resolved to repository paths: `./x`, `../x`,
// `./dir/x`, a directory's `index.js`. Only `.js` modules are followed (a
// required `package.json` is data, not logic).
function localRequires(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const found = [];
  for (const match of source.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
    for (const candidate of [target, `${target}.js`, `${target}/index.js`]) {
      if (candidate.endsWith('.js') && fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile()) {
        found.push(candidate);
        break;
      }
    }
  }
  return found;
}

// Every module reachable by local requires from a listed high-risk module of
// `bin/lib/`, to a fixed point, with the module that first pulled it in.
function securityCoreClosure() {
  const listed = config.highRiskPaths.filter((entry) => /^bin\/lib\/[\w./-]+\.js$/.test(entry));
  const pulledBy = new Map(listed.map((file) => [file, '(listed)']));
  const queue = [...listed];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!fs.existsSync(path.join(root, file)) || NOT_SECURITY_CORE.has(file)) continue;
    for (const required of localRequires(file)) {
      if (!pulledBy.has(required)) {
        pulledBy.set(required, file);
        queue.push(required);
      }
    }
  }
  return pulledBy;
}

test('every module a high-risk bin/lib module requires, transitively, is a high-risk path here', () => {
  const pulledBy = securityCoreClosure();

  assert.ok(pulledBy.has('bin/lib/shell-writes.js'), 'the closure reaches the guard\'s requires');
  assert.ok(pulledBy.has('bin/lib/diff-base.js'), 'the closure reaches requires of requires');
  const low = scoredPaths([...pulledBy.keys()].filter((file) => !NOT_SECURITY_CORE.has(file)))
    .map((file) => `${file} (required by ${pulledBy.get(file)})`);
  assert.deepStrictEqual(low, [], 'these modules are pulled in by the security core but score low');
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
    'bin/lib/spec-drift.js',
    'bin/lib/diff-base.js',
    'bin/lib/config.js',
    'bin/lib/hook.js',
    'bin/lib/util.js',
    'scripts/test-env-guard.js',
  ];

  assert.deepStrictEqual(scoredPaths(core), [], 'these modules decide a denial or a proof but score low');
});
