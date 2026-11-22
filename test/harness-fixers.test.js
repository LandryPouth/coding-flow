'use strict';

// Story 19-05: fixers run before the checks. A project declares
// `validation.fix`; verify runs those commands first, lists the files whose
// content they changed as `fixedFiles`, leaves the changes in the tree, and
// only then runs the checks on the fixed files.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-01/story-01-01-demo';

function run(cwd, args, env = {}) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '', AI_FLOW_FORCE_TTY: '', NODE_ENV: 'test', ...env },
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A node one-liner, quoted for the shell on every platform: double quotes
// outside, single quotes inside.
const node = (code) => `node -e "${code}"`;
// Rewrites `src/a.js` to its "formatted" form, as `prettier --write` would.
const FIXER = node("require('fs').writeFileSync('src/a.js','const x = 1;\\n')");
// The check: red unless the file is in its formatted form.
const CHECK = node("process.exit(require('fs').readFileSync('src/a.js','utf8')==='const x = 1;\\n'?0:1)");
const FAILING_FIXER = node('process.exit(4)');

function project(t, validation, { gitRepo = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-fixers-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const x=1\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'const y = 2;\n');
  if (validation) {
    const configPath = path.join(dir, '.coding-flow', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.validation = validation;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  if (gitRepo) {
    git(dir, ['init', '-q']);
    git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
    git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  }
  return dir;
}

const verify = (dir, extra = [], env = {}) => run(dir, ['verify', '--json', '--no-cache', ...extra], env);

test('a fixer runs first: the checks see the fixed file and the evidence lists it', (t) => {
  const dir = project(t, { fix: [FIXER], commands: [CHECK] });
  const { code, output } = verify(dir);
  assert.equal(code, 0, output);
  const evidence = JSON.parse(output);
  assert.equal(evidence.ok, true);
  assert.deepEqual(evidence.fixedFiles, ['src/a.js']);
  assert.deepEqual(evidence.results.map((r) => r.kind || 'check'), ['fix', 'check']);
  // Left in the working tree, for the agent or the driver to commit.
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'const x = 1;\n');
  assert.match(git(dir, ['status', '--porcelain']), /src\/a\.js/);
});

test('the fixed files are printed', (t) => {
  const dir = project(t, { fix: [FIXER], commands: [CHECK] });
  const { code, output } = run(dir, ['verify', '--no-cache']);
  assert.equal(code, 0, output);
  assert.match(output, /Fixed by the fixers:\s*\n\s*- src\/a\.js/);
});

test('the proof is about the fixed tree: a second verify is answered from it', (t) => {
  const dir = project(t, { fix: [FIXER], commands: [CHECK] });
  assert.equal(verify(dir).code, 0);
  const again = run(dir, ['verify']);
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /already proved/);
});

// Ticks a box in a tracked story file and reformats `src/a.js`: both are files
// the fixer changed, wherever they live.
const TICKER = node(
  "const fs=require('fs');" +
  "fs.writeFileSync('epics/e/s/spec.md','- [x] done\\n');" +
  "fs.writeFileSync('src/a.js','const x = 1;\\n')",
);

function storyFileProject(t) {
  const dir = project(t, { fix: [TICKER], commands: [node('0')] }, { gitRepo: false });
  fs.mkdirSync(path.join(dir, 'epics', 'e', 's'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'epics', 'e', 's', 'spec.md'), '- [ ] done\n');
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  return dir;
}

test('a tracked story file a fixer edits is listed, with no untracked file around', (t) => {
  const dir = storyFileProject(t);
  const evidence = JSON.parse(verify(dir).output);
  assert.deepEqual(evidence.fixedFiles, ['epics/e/s/spec.md', 'src/a.js']);
});

test('a tracked story file a fixer edits is listed, with an untracked file around', (t) => {
  const dir = storyFileProject(t);
  fs.writeFileSync(path.join(dir, 'src', 'new.js'), 'const z = 3;\n');
  const evidence = JSON.parse(verify(dir).output);
  assert.deepEqual(evidence.fixedFiles, ['epics/e/s/spec.md', 'src/a.js']);
});

test('a path that starts with a space is listed whole', (t) => {
  const dir = project(t, { fix: [node("require('fs').writeFileSync(' lead.js','x')")], commands: [node('0')] });
  const evidence = JSON.parse(verify(dir).output);
  assert.deepEqual(evidence.fixedFiles, [' lead.js']);
});

test('a fixer and a check with the same text keep their own time limits', (t) => {
  const slow = node('setTimeout(()=>{},1500)');
  const dir = project(t, { fix: [{ command: slow, timeoutMs: 300 }], commands: [{ command: slow, timeoutMs: 20000 }] });
  const evidence = JSON.parse(verify(dir).output);
  const [fixer, check] = evidence.results;
  assert.equal(fixer.kind, 'fix');
  assert.equal(fixer.timedOut, true);
  assert.equal(check.ok, true, 'the check runs under its own, longer limit');
});

test('a proof made under other fixers is not reused', (t) => {
  const dir = project(t, { fix: [FIXER], commands: [CHECK] });
  assert.equal(verify(dir).code, 0);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation.fix = [{ command: FIXER, timeoutMs: 60000 }];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const again = run(dir, ['verify']);
  assert.equal(again.code, 0, again.output);
  assert.doesNotMatch(again.output, /already proved/);
  assert.match(again.output, /\[ok\] fix: /);
});

test('run --dry-run names the fixers that would run first', (t) => {
  const dir = project(t, { fix: [FIXER], commands: [CHECK] });
  fs.mkdirSync(path.join(dir, STORY), { recursive: true });
  fs.writeFileSync(path.join(dir, STORY, 'story.md'), '# Demo\n\n## Status: planned\n');
  const { code, output } = run(dir, ['run', '--dry-run']);
  assert.equal(code, 0, output);
  assert.match(output, /fixers first: node -e/);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'const x=1\n');
});

test('a fixer that changes nothing lists no file', (t) => {
  const dir = project(t, { fix: [node('0')], commands: [node('0')] });
  const evidence = JSON.parse(verify(dir).output);
  assert.deepEqual(evidence.fixedFiles, []);
});

test('a fixer that fails is a red command, and verify is red', (t) => {
  const dir = project(t, { fix: [FAILING_FIXER], commands: [node('0')] });
  const { code, output } = verify(dir);
  assert.equal(code, 1, output);
  const evidence = JSON.parse(output);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.commandsOk, false);
  const fixer = evidence.results.find((r) => r.kind === 'fix');
  assert.equal(fixer.ok, false);
  assert.equal(fixer.exitCode, 4);
});

test('without validation.fix verify behaves as before: no fixer, no fixedFiles', (t) => {
  const dir = project(t, { commands: [node('0')] });
  const evidence = JSON.parse(verify(dir).output);
  assert.equal(evidence.ok, true);
  assert.equal('fixedFiles' in evidence, false);
  assert.equal(evidence.results.length, 1);
  assert.equal(evidence.results[0].kind, undefined);
  const config = JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8'));
  assert.equal('fix' in config.validation, false);
});

test('outside git the fixer still runs first, and the changed files are unknown, not empty', (t) => {
  const dir = project(t, { fix: [FIXER], commands: [CHECK] }, { gitRepo: false });
  const { code, output } = verify(dir);
  assert.equal(code, 0, output);
  const evidence = JSON.parse(output);
  assert.equal(evidence.fixedFiles, null);
});

test('a fixer with its own time limit is killed at it, like any declared command', (t) => {
  const dir = project(t, { fix: [{ command: node('setTimeout(()=>{},5000)'), timeoutMs: 300 }], commands: [node('0')] });
  const evidence = JSON.parse(verify(dir).output);
  const fixer = evidence.results.find((r) => r.kind === 'fix');
  assert.equal(fixer.timedOut, true);
  assert.equal(evidence.ok, false);
});

test('--dry-run lists the fixers and runs none', (t) => {
  const dir = project(t, { fix: [FIXER], commands: [CHECK] });
  const { code, output } = run(dir, ['verify', '--dry-run']);
  assert.equal(code, 0, output);
  assert.match(output, /Fixers \(run first\):/);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'const x=1\n');
  const json = JSON.parse(run(dir, ['verify', '--dry-run', '--json']).output);
  assert.deepEqual(json.fix, [FIXER]);
});

test('config fixers run unattended, like config commands', (t) => {
  const dir = project(t, { fix: [FIXER], commands: [CHECK] });
  const { code, output } = verify(dir, [], { CI: 'true' });
  assert.equal(code, 0, output);
});

// A story whose commands come from plan.md, with a `## Fixers` block.
function planProject(t, { commands, fixers, scripts = {} }) {
  const dir = project(t, null);
  const pkg = { name: 'demo', version: '1.0.0', scripts };
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  const storyDir = path.join(dir, STORY);
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Demo\n');
  fs.writeFileSync(
    path.join(storyDir, 'plan.md'),
    ['# Plan', '', '## Fixers', '', '```bash', ...fixers, '```', '', '## Commands', '', '```bash', ...commands, '```', ''].join('\n'),
  );
  return dir;
}

test('a fixer declared only in plan.md is refused unattended, and nothing runs', (t) => {
  // The checks alone would run unattended (a bare project script); the fixer
  // is an arbitrary command, so the run is refused like any plan command.
  const dir = planProject(t, { commands: ['npm test'], fixers: [FIXER], scripts: { test: 'node -e "0"' } });
  const { code, output } = run(dir, ['verify', '--story', STORY, '--json'], { CI: 'true' });
  assert.notEqual(code, 0);
  const evidence = JSON.parse(output);
  assert.match(evidence.refused, /not run unattended/);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'const x=1\n');
});

test('the same plan checks without the fixer run unattended: the fixer alone is what was refused', (t) => {
  const dir = planProject(t, { commands: ['npm test'], fixers: [], scripts: { test: 'node -e "0"' } });
  const { code, output } = run(dir, ['verify', '--story', STORY, '--json'], { CI: 'true' });
  assert.equal(code, 0, output);
  const evidence = JSON.parse(output);
  assert.equal(evidence.refused, undefined);
  assert.equal(evidence.ok, true);
});

test('plan.md fixers run with --allow-plan-commands, before the plan checks', (t) => {
  const dir = planProject(t, { commands: [CHECK], fixers: [FIXER] });
  const { code, output } = run(dir, ['verify', '--story', STORY, '--json', '--allow-plan-commands'], { CI: 'true' });
  assert.equal(code, 0, output);
  const evidence = JSON.parse(output);
  assert.deepEqual(evidence.fixedFiles, ['src/a.js']);
});

test('a plan.md fixer naming a project script runs unattended, like a plan check', (t) => {
  const dir = planProject(t, {
    commands: ['npm test'],
    fixers: ['npm run format'],
    scripts: { test: CHECK, format: FIXER },
  });
  const { code, output } = run(dir, ['verify', '--story', STORY, '--json'], { CI: 'true' });
  assert.equal(code, 0, output);
  assert.deepEqual(JSON.parse(output).fixedFiles, ['src/a.js']);
});

test('the bootstrap scan suggests fixers from the package scripts, and declares none', (t) => {
  const { detectFixRecipes } = require('../bin/lib/fix-recipes');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-fix-recipes-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const scripts = {
    lint: 'eslint .',
    format: 'prettier --write .',
    'format:check': 'prettier --check .',
    test: 'node --test',
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts }));
  assert.deepEqual(detectFixRecipes(dir), [
    { script: 'format', command: 'npm run format' },
    { script: 'lint', command: 'npm run lint -- --fix' },
  ]);
  run(dir, ['init']);
  const { output } = run(dir, ['bootstrap', '--scan']);
  assert.match(output, /Fixer recipes for validation\.fix: `npm run format`, `npm run lint -- --fix`/);
  const scan = fs.readFileSync(path.join(dir, 'docs', 'bootstrap-scan.md'), 'utf8');
  assert.match(scan, /## Fixer Recipes\n\nCandidates for `validation\.fix`[^\n]*\n\n- format: `npm run format`\n- lint: `npm run lint -- --fix`/);
  const config = JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8'));
  assert.equal(config.validation && 'fix' in config.validation, false, 'a suggestion is never enabled');
});

test('a lint script that already fixes is offered once, as it is', () => {
  const { detectFixRecipes } = require('../bin/lib/fix-recipes');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-fix-recipes-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint . --fix' } }));
    assert.deepEqual(detectFixRecipes(dir), [{ script: 'lint', command: 'npm run lint' }]);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'flow:fix': 'npx @landry_pouth/coding-flow doctor --fix', fix: 'ai-flow doctor --fix' } }));
    assert.deepEqual(detectFixRecipes(dir), [], "Coding Flow's own repair scripts are not fixers");
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not json');
    assert.deepEqual(detectFixRecipes(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
