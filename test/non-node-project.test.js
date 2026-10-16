'use strict';

// A Python, Go or Rust project is not a Node project: init used to create a
// package.json there only to hold the `flow:*` shortcuts. It now leaves the
// project's own manifest alone and says how to run the CLI instead.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function init(t, manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-nonnode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (manifest) fs.writeFileSync(path.join(dir, manifest), '');
  const out = execFileSync(process.execPath, [CLI, 'init'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { dir, out };
}

for (const manifest of ['pyproject.toml', 'go.mod', 'Cargo.toml']) {
  test(`no package.json is created in a project with ${manifest}`, (t) => {
    const { dir, out } = init(t, manifest);
    assert.equal(fs.existsSync(path.join(dir, 'package.json')), false);
    assert.match(out, new RegExp(`Package.json: not created \\(${manifest.replace('.', '\\.')} found`));
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '.coding-flow', 'COMMANDS.md'), 'utf8'), /npm run flow/);
  });
}

test('an empty project still gets the package.json with the flow scripts', (t) => {
  const { dir } = init(t, null);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts.flow);
});
