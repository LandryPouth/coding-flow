'use strict';

// Tests of the brownfield scan. The scan is machinery now — `init` runs it on
// every repo — so the two ways it can lie both need a guard: reading Coding
// Flow's own scaffold back as project signal, and reporting a stack it cannot
// detect as an empty project.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const SCAN_FILE = path.join('docs', 'bootstrap-scan.md');

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function project(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function jsProject(t, prefix) {
  const dir = project(t, prefix);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'demo',
      scripts: { test: 'vitest', build: 'next build' },
      dependencies: { next: '14.0.0', '@prisma/client': '5.0.0' },
    }),
  );
  return dir;
}

function pythonProject(t, prefix) {
  const dir = project(t, prefix);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'src', 'app.py'), 'def x():\n    pass\n');
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n');
  return dir;
}

// A stack genuinely outside every detector below — no package.json, no go.mod,
// no Cargo.toml, no pyproject.toml/requirements.txt, no pom.xml/build.gradle.
// Kept distinct from pythonProject() on purpose: Python now has a real reader,
// so a fixture that must still get the honest "we don't know" hedge needs a
// stack that actually stays unread.
function unknownStackProject(t, prefix) {
  const dir = project(t, prefix);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'src', 'app.rb'), 'def x; end\n');
  fs.writeFileSync(path.join(dir, 'Gemfile'), "source 'https://rubygems.org'\n");
  return dir;
}

function scan(dir) {
  const res = run(dir, ['bootstrap', '--scan', '--json']);
  assert.equal(res.code, 0, res.output);
  return JSON.parse(res.output);
}

test('scan classifies a JavaScript project as rich', (t) => {
  const data = scan(jsProject(t, 'scan-js'));

  assert.equal(data.classification, 'rich');
  assert.ok(data.detectedFrameworks.includes('Next.js'), data.detectedFrameworks.join(','));
  assert.ok(data.detectedFrameworks.includes('Prisma'), data.detectedFrameworks.join(','));
  assert.equal(data.hasProjectPackageJson, true);
  assert.deepEqual(Object.keys(data.scripts).sort(), ['build', 'test']);
});

test('scan detects a Python project through pyproject.toml', (t) => {
  const data = scan(pythonProject(t, 'scan-py'));

  // A bare pyproject.toml carries no dependencies, so there is no framework to
  // name — but the manifest itself is real signal, not an empty project.
  assert.equal(data.foreignStack.ecosystem, 'python');
  assert.equal(data.foreignStack.manifest, 'pyproject.toml');
  assert.equal(data.classification, 'thin');
  assert.equal(data.looksLikeCode, true);
  assert.equal(data.hasProjectPackageJson, false);
  assert.deepEqual(data.codeDirectories.sort(), ['src', 'tests']);
});

test('a genuinely unrecognized stack still reports empty but holding code', (t) => {
  const data = scan(unknownStackProject(t, 'scan-unknown'));

  // No detector here covers Ruby. `empty` classification plus looksLikeCode is
  // what makes init say so out loud, instead of pretending the repo is fresh.
  assert.equal(data.classification, 'empty');
  assert.equal(data.looksLikeCode, true);
  assert.equal(data.foreignStack, null);
  assert.deepEqual(data.codeDirectories.sort(), ['src', 'tests']);
});

test('scan reports a genuinely empty repository as empty and codeless', (t) => {
  const data = scan(project(t, 'scan-empty'));

  assert.equal(data.classification, 'empty');
  assert.equal(data.looksLikeCode, false);
});

test('scan ignores the scaffold init itself installs', (t) => {
  const dir = project(t, 'scan-scaffold');
  assert.equal(run(dir, ['init']).code, 0);

  // init writes docs/, epics/, examples/ and eleven flow:* scripts into a
  // package.json it may have created. None of that is project signal: reading it
  // back would make every fresh repo look like a live codebase.
  const data = scan(dir);

  assert.equal(data.classification, 'empty');
  assert.equal(data.looksLikeCode, false);
  assert.deepEqual(Object.keys(data.scripts), []);
  assert.equal(data.hasProjectPackageJson, false);
});

test('--json writes no document, --scan writes one', (t) => {
  const dir = jsProject(t, 'scan-artifact');

  scan(dir);
  assert.equal(fs.existsSync(path.join(dir, SCAN_FILE)), false);

  assert.equal(run(dir, ['bootstrap', '--scan']).code, 0);
  assert.equal(fs.existsSync(path.join(dir, SCAN_FILE)), true);
});

test('a second scan keeps an edited document unless --force', (t) => {
  const dir = jsProject(t, 'scan-clobber');
  assert.equal(run(dir, ['bootstrap', '--scan']).code, 0);

  const target = path.join(dir, SCAN_FILE);
  fs.writeFileSync(target, '# Mine\n');

  const kept = run(dir, ['bootstrap', '--scan']);
  assert.equal(kept.code, 0, kept.output);
  assert.match(kept.output, /already exists/);
  assert.equal(fs.readFileSync(target, 'utf8'), '# Mine\n');

  assert.equal(run(dir, ['bootstrap', '--scan', '--force']).code, 0);
  assert.match(fs.readFileSync(target, 'utf8'), /# Bootstrap Scan/);
});

test('init detects a brownfield repo, writes no scan file, and points at flow-plan', (t) => {
  const dir = jsProject(t, 'init-brownfield');
  const res = run(dir, ['init']);
  assert.equal(res.code, 0, res.output);

  assert.match(res.output, /Existing codebase detected: Next\.js, Prisma/);
  assert.match(res.output, /Project docs are still empty\. Next: \/flow-plan bootstrap/);
  // The scan is a function call, not an artifact.
  assert.equal(fs.existsSync(path.join(dir, SCAN_FILE)), false);
});

test('init says nothing about brownfield on a fresh repository', (t) => {
  const res = run(project(t, 'init-greenfield'), ['init']);
  assert.equal(res.code, 0, res.output);

  assert.doesNotMatch(res.output, /Existing codebase detected/);
  assert.doesNotMatch(res.output, /Existing code detected/);
  assert.doesNotMatch(res.output, /flow-plan bootstrap/);
});

test('init warns loudly when the stack is outside every detector', (t) => {
  const res = run(unknownStackProject(t, 'init-unknown'), ['init']);
  assert.equal(res.code, 0, res.output);

  // The silent failure this closes: init creates a package.json when the repo has
  // none, so a bare existence check would have called this project JavaScript.
  assert.match(res.output, /no recognized signal/);
  assert.match(res.output, /flow-plan bootstrap/);
});

test('init reports what it found when the stack is Python, not the JS hedge', (t) => {
  const res = run(pythonProject(t, 'init-python'), ['init']);
  assert.equal(res.code, 0, res.output);

  assert.match(res.output, /Existing Python codebase detected \(pyproject\.toml\)/);
  assert.doesNotMatch(res.output, /no recognized signal/);
  assert.match(res.output, /flow-plan bootstrap/);
});

// --- a package.json that lies, breaks, or changes ---------------------------

test('a greenfield repo that later becomes a JS project is detected', (t) => {
  const dir = project(t, 'scan-grows');
  assert.equal(run(dir, ['init']).code, 0);

  // init recorded "we created this package.json" in the manifest. That flag must
  // not be sticky: the day the project fills the file in, the scan has to see it,
  // or a real Next.js app keeps reporting as an empty repo forever.
  fs.mkdirSync(path.join(dir, 'src'));
  const pkgPath = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = { next: '14.0.0' };
  pkg.scripts = { ...pkg.scripts, test: 'vitest' };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  const data = scan(dir);
  assert.equal(data.hasProjectPackageJson, true);
  assert.equal(data.classification, 'rich');
  assert.deepEqual(data.detectedFrameworks, ['Next.js']);
  assert.deepEqual(Object.keys(data.scripts), ['test'], 'our own flow:* scripts stay filtered out');
});

test('an unparseable package.json is reported as such, not as a foreign stack', (t) => {
  const dir = project(t, 'scan-broken-pkg');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "demo",\n<<<<<<< HEAD\n');

  const data = scan(dir);
  assert.equal(data.packageJsonUnreadable, true);
  assert.equal(data.hasProjectPackageJson, false);

  const res = run(dir, ['init']);
  assert.equal(res.code, 0, res.output);
  // Blaming the stack for a broken file sends the user hunting the wrong problem.
  assert.match(res.output, /could not be parsed as JSON/);
  assert.doesNotMatch(res.output, /Python, Go, Rust/);
});

test('a package.json holding non-objects does not crash or invent signal', (t) => {
  const dir = project(t, 'scan-weird-pkg');
  fs.mkdirSync(path.join(dir, 'src'));
  // scripts as a string used to be walked character by character: eight letters
  // became eight scripts, and the repo classified as `thin`.
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 42, scripts: 'npm test', dependencies: ['next'], devDependencies: null }),
  );

  const data = scan(dir);
  assert.deepEqual(data.scripts, {});
  assert.deepEqual(data.detectedFrameworks, []);
  assert.equal(data.packageName, null);
  assert.equal(data.classification, 'empty');
});

test('a package.json that is a JSON array is treated as unreadable', (t) => {
  const dir = project(t, 'scan-array-pkg');
  fs.writeFileSync(path.join(dir, 'package.json'), '["not", "a", "manifest"]');

  const data = scan(dir);
  assert.equal(data.packageJsonUnreadable, true);
  assert.equal(data.classification, 'empty');
});

test('a corrupt manifest degrades the scan without breaking it', (t) => {
  const dir = pythonProject(t, 'scan-broken-manifest');
  assert.equal(run(dir, ['init']).code, 0);
  fs.writeFileSync(path.join(dir, '.coding-flow', 'manifest.json'), 'not json');

  // Without the manifest we cannot tell our package.json from the project's, so
  // the scan reports what it can rather than asserting a stack it cannot prove.
  const data = scan(dir);
  assert.equal(data.classification, 'empty');
  assert.equal(data.packageJsonUnreadable, false);
});

// --- partial signal ---------------------------------------------------------

test('scripts without dependencies classify as thin', (t) => {
  const dir = project(t, 'scan-thin-scripts');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'make test' } }));

  const data = scan(dir);
  assert.equal(data.classification, 'thin');
});

test('dependencies without scripts classify as thin', (t) => {
  const dir = project(t, 'scan-thin-deps');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { react: '18.0.0' } }));

  const data = scan(dir);
  assert.equal(data.classification, 'thin');
  assert.deepEqual(data.detectedFrameworks, ['React']);
});

test('init tells the user when the signal is only partial', (t) => {
  const dir = project(t, 'init-thin');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { vue: '3.0.0' } }));

  const res = run(dir, ['init']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Existing codebase detected: Vue/);
  assert.match(res.output, /starting point/, 'a thin scan must not read as a complete picture');
});

test('a repo with only untyped files reports that the scan cannot describe it', (t) => {
  const dir = project(t, 'scan-opaque');
  fs.mkdirSync(path.join(dir, 'vendor'));
  fs.writeFileSync(path.join(dir, 'vendor', 'blob.bin'), 'x');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));

  const res = run(dir, ['init']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /no framework, script, or test signal/);
  assert.match(res.output, /flow-plan bootstrap/);
});

test('test directories are found a few levels down but not arbitrarily deep', (t) => {
  const dir = jsProject(t, 'scan-depth');
  fs.mkdirSync(path.join(dir, 'a', 'b', 'tests'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'a', 'b', 'c', 'd', 'tests'), { recursive: true });

  const found = scan(dir).testDirectories;
  assert.ok(found.includes('tests'), found.join(','));
  assert.ok(found.includes('a/b/tests'), found.join(','));
  assert.ok(!found.includes('a/b/c/d/tests'), 'the walk is bounded, it does not scan the world');
});

// --- workspaces: a monorepo is not a foreign stack --------------------------

function pnpmWorkspace(t, prefix) {
  const dir = project(t, prefix);
  fs.mkdirSync(path.join(dir, 'apps', 'web'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'apps', 'api'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n');
  fs.writeFileSync(
    path.join(dir, 'apps', 'web', 'package.json'),
    JSON.stringify({ name: 'web', dependencies: { next: '14.0.0' }, scripts: { test: 'vitest' } }),
  );
  fs.writeFileSync(
    path.join(dir, 'apps', 'api', 'package.json'),
    JSON.stringify({ name: 'api', dependencies: { express: '4.0.0' }, scripts: { test: 'vitest' } }),
  );
  return dir;
}

test('a pnpm workspace is read through its members, not guessed at', (t) => {
  const data = scan(pnpmWorkspace(t, 'ws-pnpm'));

  // There is no root package.json at all here, which used to mean "no JavaScript
  // signal" and a confident, wrong "likely Python, Go, Rust".
  assert.equal(data.workspace.marker, 'pnpm-workspace.yaml');
  assert.equal(data.workspace.memberCount, 2);
  assert.deepEqual(data.detectedFrameworks.sort(), ['Express', 'Next.js']);
  assert.notEqual(data.classification, 'empty');
});

test('init never calls a JavaScript monorepo a Python project', (t) => {
  const res = run(pnpmWorkspace(t, 'ws-init'), ['init']);
  assert.equal(res.code, 0, res.output);

  assert.doesNotMatch(res.output, /Python, Go, Rust/);
  assert.match(res.output, /Existing codebase detected: .*Next\.js/);
  assert.match(res.output, /2 workspace packages/);
  assert.match(res.output, /Workspace monorepo \(pnpm-workspace\.yaml\)/);
});

test('npm workspaces declared in package.json are followed too', (t) => {
  const dir = project(t, 'ws-npm');
  fs.mkdirSync(path.join(dir, 'packages', 'ui'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }),
  );
  fs.writeFileSync(
    path.join(dir, 'packages', 'ui', 'package.json'),
    JSON.stringify({ name: 'ui', dependencies: { svelte: '4.0.0' }, scripts: { build: 'vite build' } }),
  );

  const data = scan(dir);
  assert.equal(data.workspace.marker, 'package.json');
  assert.deepEqual(data.detectedFrameworks, ['Svelte']);
  // Root scripts stay root-only: those are the commands runnable from here.
  assert.deepEqual(data.scripts, {});
  assert.equal(data.workspace.memberScriptCount, 1);
});

test('the workspaces object form is accepted', (t) => {
  const dir = project(t, 'ws-objectform');
  fs.mkdirSync(path.join(dir, 'packages', 'core'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'root', workspaces: { packages: ['packages/*'] } }),
  );
  fs.writeFileSync(
    path.join(dir, 'packages', 'core', 'package.json'),
    JSON.stringify({ name: 'core', dependencies: { vue: '3.0.0' } }),
  );

  assert.deepEqual(scan(dir).detectedFrameworks, ['Vue']);
});

test('a declared workspace with unreadable members says so instead of guessing', (t) => {
  const dir = project(t, 'ws-empty');
  fs.mkdirSync(path.join(dir, 'apps'));
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n');

  const data = scan(dir);
  assert.equal(data.workspace.marker, 'pnpm-workspace.yaml');
  assert.equal(data.workspace.memberCount, 0);

  const res = run(dir, ['init']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Workspace declared in pnpm-workspace\.yaml/);
  assert.doesNotMatch(res.output, /Python, Go, Rust/);
});

test('exotic globs are skipped rather than half-supported', (t) => {
  const dir = project(t, 'ws-glob');
  fs.mkdirSync(path.join(dir, 'a', 'b', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['a/**/*'] }));
  fs.writeFileSync(
    path.join(dir, 'a', 'b', 'deep', 'package.json'),
    JSON.stringify({ name: 'deep', dependencies: { next: '14.0.0' } }),
  );

  const data = scan(dir);
  assert.equal(data.workspace.marker, 'package.json');
  assert.equal(data.workspace.memberCount, 0, 'no partial glob support');
  // The marker alone is already enough to stop the foreign-stack claim.
  assert.doesNotMatch(run(dir, ['init']).output, /Python, Go, Rust/);
});

test('the member walk is capped', (t) => {
  const dir = project(t, 'ws-cap');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));

  for (let index = 0; index < 60; index += 1) {
    const member = path.join(dir, 'packages', `p${index}`);
    fs.mkdirSync(member, { recursive: true });
    fs.writeFileSync(path.join(member, 'package.json'), JSON.stringify({ name: `p${index}` }));
  }

  // The scan runs on every init; it does not get to walk a large repository.
  assert.equal(scan(dir).workspace.memberCount, 50);
});

test('a genuinely unknown stack still gets the loud foreign-stack warning', (t) => {
  const res = run(unknownStackProject(t, 'ws-unknown-regression'), ['init']);

  // The fix must not mute the case the warning was written for.
  assert.match(res.output, /no recognized signal/);
});

// --- non-JS ecosystems -------------------------------------------------------

test('scan detects a Go project through go.mod, framework included', (t) => {
  const dir = project(t, 'go-single');
  fs.mkdirSync(path.join(dir, 'cmd'));
  fs.writeFileSync(
    path.join(dir, 'go.mod'),
    'module demo\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
  );

  const data = scan(dir);
  assert.equal(data.foreignStack.ecosystem, 'go');
  assert.equal(data.foreignStack.manifest, 'go.mod');
  assert.deepEqual(data.detectedFrameworks, ['Gin']);
  assert.equal(data.classification, 'thin');
});

test('scan detects a Go workspace through go.work, union of member deps', (t) => {
  const dir = project(t, 'go-workspace');
  fs.mkdirSync(path.join(dir, 'api'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'worker'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'go.work'), 'go 1.21\n\nuse (\n\t./api\n\t./worker\n)\n');
  fs.writeFileSync(
    path.join(dir, 'api', 'go.mod'),
    'module demo/api\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
  );
  fs.writeFileSync(path.join(dir, 'worker', 'go.mod'), 'module demo/worker\n\ngo 1.21\n');

  const data = scan(dir);
  assert.equal(data.workspace.marker, 'go.work');
  assert.equal(data.workspace.ecosystem, 'go');
  assert.equal(data.workspace.memberCount, 2);
  assert.deepEqual(data.detectedFrameworks, ['Gin']);
});

test('scan detects a Rust crate through Cargo.toml', (t) => {
  const dir = project(t, 'rust-single');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(
    path.join(dir, 'Cargo.toml'),
    '[package]\nname = "demo"\n\n[dependencies]\naxum = "0.7"\ntokio = "1"\n',
  );

  const data = scan(dir);
  assert.equal(data.foreignStack.ecosystem, 'rust');
  assert.deepEqual(data.detectedFrameworks.sort(), ['Axum', 'Tokio']);
});

test('scan detects a Rust workspace through Cargo.toml [workspace] members', (t) => {
  const dir = project(t, 'rust-workspace');
  fs.mkdirSync(path.join(dir, 'crates', 'api'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["crates/*"]\n');
  fs.writeFileSync(
    path.join(dir, 'crates', 'api', 'Cargo.toml'),
    '[package]\nname = "api"\n\n[dependencies]\nactix-web = "4"\n',
  );

  const data = scan(dir);
  assert.equal(data.workspace.marker, 'Cargo.toml');
  assert.equal(data.workspace.ecosystem, 'rust');
  assert.equal(data.workspace.memberCount, 1);
  assert.deepEqual(data.detectedFrameworks, ['Actix Web']);
});

test('scan detects a Python project through pyproject.toml dependencies', (t) => {
  const dir = project(t, 'py-deps');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(
    path.join(dir, 'pyproject.toml'),
    '[project]\nname = "demo"\ndependencies = ["fastapi", "pydantic"]\n',
  );

  const data = scan(dir);
  assert.equal(data.foreignStack.ecosystem, 'python');
  assert.deepEqual(data.detectedFrameworks.sort(), ['FastAPI', 'Pydantic']);
});

test('scan detects a Python workspace through pyproject.toml [tool.uv.workspace]', (t) => {
  const dir = project(t, 'py-workspace');
  fs.mkdirSync(path.join(dir, 'packages', 'web'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[tool.uv.workspace]\nmembers = ["packages/*"]\n');
  fs.writeFileSync(
    path.join(dir, 'packages', 'web', 'pyproject.toml'),
    '[project]\nname = "web"\ndependencies = ["django"]\n',
  );

  const data = scan(dir);
  assert.equal(data.workspace.marker, 'pyproject.toml');
  assert.equal(data.workspace.ecosystem, 'python');
  assert.equal(data.workspace.memberCount, 1);
  assert.deepEqual(data.detectedFrameworks, ['Django']);
});

test('scan detects a plain Python project through requirements.txt', (t) => {
  const dir = project(t, 'py-requirements');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'flask==3.0.0\n# a comment\npytest>=7\n');

  const data = scan(dir);
  assert.equal(data.foreignStack.manifest, 'requirements.txt');
  assert.deepEqual(data.detectedFrameworks.sort(), ['Flask', 'Pytest']);
});

test('scan detects a Java project through pom.xml, single and multi-module', (t) => {
  const single = project(t, 'java-single');
  fs.writeFileSync(
    path.join(single, 'pom.xml'),
    '<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>',
  );
  const singleData = scan(single);
  assert.equal(singleData.foreignStack.ecosystem, 'java');
  assert.deepEqual(singleData.detectedFrameworks, ['Spring Boot']);

  const multi = project(t, 'java-multi');
  fs.mkdirSync(path.join(multi, 'service'), { recursive: true });
  fs.writeFileSync(path.join(multi, 'pom.xml'), '<project><modules><module>service</module></modules></project>');
  fs.writeFileSync(
    path.join(multi, 'service', 'pom.xml'),
    '<project><dependencies><dependency><artifactId>junit-jupiter</artifactId></dependency></dependencies></project>',
  );
  const multiData = scan(multi);
  assert.equal(multiData.workspace.marker, 'pom.xml');
  assert.equal(multiData.workspace.ecosystem, 'java');
  assert.equal(multiData.workspace.memberCount, 1);
  assert.deepEqual(multiData.detectedFrameworks, ['JUnit']);
});

test('a real JS package.json always wins over a foreign manifest sitting next to it', (t) => {
  // Documents the trade-off: a polyglot repo (e.g. a Tauri app, JS frontend +
  // Rust backend) reports as JS only. One ecosystem per scan, same call every
  // foreign detector above already makes for globs and nested workspaces.
  const dir = jsProject(t, 'polyglot');
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "backend"\n\n[dependencies]\naxum = "0.7"\n');

  const data = scan(dir);
  assert.equal(data.foreignStack, null);
  assert.ok(!data.detectedFrameworks.includes('Axum'));
  assert.ok(data.detectedFrameworks.includes('Next.js'));
});

// --- init names what it kept ------------------------------------------------

test('init names the files it kept instead of only counting them', (t) => {
  const dir = jsProject(t, 'init-collision');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'architecture.md'), '# Our real architecture\n');

  const res = run(dir, ['init']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /docs\/architecture\.md/, 'the user must know which file');
  assert.match(res.output, /not overwritten/);
  // "Use --force to overwrite them" read as advice to replace a real architecture
  // document with a template stub.
  assert.doesNotMatch(res.output, /Use --force to overwrite them\./);
  assert.equal(fs.readFileSync(path.join(dir, 'docs', 'architecture.md'), 'utf8'), '# Our real architecture\n');
});

// --- the command surface ----------------------------------------------------

test('bootstrap without --scan fails with a usable message', (t) => {
  const dir = jsProject(t, 'scan-no-flag');

  const { code, output } = run(dir, ['bootstrap']);
  assert.equal(code, 1);
  assert.match(output, /--scan/);
});

test('bootstrap --scan --dry-run prints the document and writes nothing', (t) => {
  const dir = jsProject(t, 'scan-dry');

  const { code, output } = run(dir, ['bootstrap', '--scan', '--dry-run']);
  assert.equal(code, 0, output);
  assert.match(output, /# Bootstrap Scan/);
  assert.equal(fs.existsSync(path.join(dir, SCAN_FILE)), false);
});

test('--json wins over --dry-run and still writes nothing', (t) => {
  const dir = jsProject(t, 'scan-json-dry');

  const { code, output } = run(dir, ['bootstrap', '--scan', '--json', '--dry-run']);
  assert.equal(code, 0, output);
  assert.equal(JSON.parse(output).classification, 'rich');
  assert.equal(fs.existsSync(path.join(dir, SCAN_FILE)), false);
});

test('the machine scan survives a docs path it could never write to', (t) => {
  const dir = jsProject(t, 'scan-docs-file');
  fs.writeFileSync(path.join(dir, 'docs'), 'not a directory');

  // init runs the scan on every repo, so the read path must never depend on
  // being able to write the artifact.
  const data = scan(dir);
  assert.equal(data.classification, 'rich');
});

// --- init's own contract ----------------------------------------------------

test('init --dry-run on a brownfield repo reports without writing anything', (t) => {
  const dir = jsProject(t, 'init-dry-brownfield');
  const before = fs.readdirSync(dir).sort();

  const res = run(dir, ['init', '--dry-run']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Existing codebase detected: Next\.js, Prisma/);
  assert.match(res.output, /Project docs would still be empty/);
  assert.deepEqual(fs.readdirSync(dir).sort(), before, '--dry-run wrote to disk');
});

test('re-running init keeps the brownfield report accurate', (t) => {
  const dir = jsProject(t, 'init-twice');
  assert.equal(run(dir, ['init']).code, 0);

  const second = run(dir, ['init']);
  assert.equal(second.code, 0, second.output);
  // The scaffold from the first run must not be read back as project growth.
  assert.match(second.output, /Existing codebase detected: Next\.js, Prisma — 2 scripts/);
  assert.equal(fs.existsSync(path.join(dir, SCAN_FILE)), false);
});

test('init --force on a brownfield repo still writes no scan document', (t) => {
  const dir = jsProject(t, 'init-force');
  assert.equal(run(dir, ['init']).code, 0);

  const forced = run(dir, ['init', '--force']);
  assert.equal(forced.code, 0, forced.output);
  assert.equal(fs.existsSync(path.join(dir, SCAN_FILE)), false, '--force is not consent to new artifacts');
});
