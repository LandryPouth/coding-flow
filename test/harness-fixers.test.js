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

// Story 19-10: the same race, made certain. Git trusts an index entry whose
// size and mtime match, unless the file is as new as the index itself (the
// "racily clean" case it re-reads). Here the story file, its index entry and
// the index all carry one timestamp, and the fixer rewrites the file at the same
// size and the same mtime — what happens for real when the commit and the
// fixer land within one second. Git itself sees the change; so must the
// snapshot, whatever second its throwaway copy of the index is taken in.
test('a story file a fixer rewrites within the second of the commit is still listed', (t) => {
  const T = 1700000000;
  const ticker = node(
    "const fs=require('fs');" +
    "fs.writeFileSync('epics/e/s/spec.md','- [x] done\\n');" +
    `fs.utimesSync('epics/e/s/spec.md',${T},${T})`,
  );
  const dir = project(t, { fix: [ticker], commands: [node('0')] }, { gitRepo: false });
  const spec = path.join(dir, 'epics', 'e', 's', 'spec.md');
  fs.mkdirSync(path.dirname(spec), { recursive: true });
  fs.writeFileSync(spec, '- [ ] done\n');
  fs.utimesSync(spec, T, T);
  git(dir, ['init', '-q']);
  // A rewrite changes the ctime; only the mtime race is under test here.
  git(dir, ['config', 'core.trustctime', 'false']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  fs.utimesSync(path.join(dir, '.git', 'index'), T, T);
  const evidence = JSON.parse(verify(dir).output);
  assert.deepEqual(evidence.fixedFiles, ['epics/e/s/spec.md']);
});

// The proof's tree token takes the same throwaway index when new files are
// around: a same-second, same-size edit after a verify must still make it move.
test('the tree token moves on a same-size edit made within the second of the index', (t) => {
  const { currentTreeToken } = require('../bin/lib/identity');
  const T = 1700000000;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-race-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, '- [ ] done\n');
  fs.utimesSync(file, T, T);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'core.trustctime', 'false']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  fs.writeFileSync(path.join(dir, 'new.txt'), 'untracked\n');
  fs.utimesSync(path.join(dir, '.git', 'index'), T, T);
  const before = currentTreeToken(dir);
  fs.writeFileSync(file, '- [x] done\n');
  fs.utimesSync(file, T, T);
  assert.notEqual(currentTreeToken(dir), before);
});

// A stat Date handed back to utimes rounds .9995 s and above up into the next
// second: the copy would be later than the real index and the window reopens.
test('the tree token moves when the index was written in the last half-millisecond of the second', (t) => {
  const { currentTreeToken } = require('../bin/lib/identity');
  const T = 1700000000;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-race-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, '- [ ] done\n');
  fs.utimesSync(file, T, T);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'core.trustctime', 'false']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  fs.writeFileSync(path.join(dir, 'new.txt'), 'untracked\n');
  fs.utimesSync(path.join(dir, '.git', 'index'), T + 0.9997, T + 0.9997);
  const before = currentTreeToken(dir);
  fs.writeFileSync(file, '- [x] done\n');
  fs.utimesSync(file, T, T);
  assert.notEqual(currentTreeToken(dir), before);
  // Git itself sees the edit (read last: status refreshes the real index).
  assert.match(git(dir, ['status', '--porcelain']), /a\.md/);
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
  // The fixer records when it started, writes a marker 2 s after that and lives
  // 20 s. Where the whole tree is killed (Windows, story 29-05), the marker never
  // appears, however late the fixer started, and the project directory is free
  // at once: the cleanup above has no retries. The limit (1 s) leaves a slow
  // Windows node time to start, and is still well before the marker.
  const late = node("const fs=require('fs');fs.writeFileSync('started.txt',String(Date.now()));setTimeout(()=>fs.writeFileSync('late.txt','x'),2000);setTimeout(()=>{},20000)");
  const dir = project(t, { fix: [{ command: late, timeoutMs: 1000 }], commands: [node('0')] });
  const evidence = JSON.parse(verify(dir).output);
  const fixer = evidence.results.find((r) => r.kind === 'fix');
  assert.equal(fixer.timedOut, true);
  assert.equal(evidence.ok, false);
  const startFile = path.join(dir, 'started.txt');
  assert.equal(fs.existsSync(startFile), true, 'the fixer never started: the kill proves nothing');
  if (process.platform === 'win32') {
    const fixerStarted = Number(fs.readFileSync(startFile, 'utf8'));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, fixerStarted + 3500 - Date.now()));
    assert.equal(fs.existsSync(path.join(dir, 'late.txt')), false, 'the fixer outlived its time limit');
  }
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
    { script: 'format', command: 'npm run format', ignore: { file: '.prettierignore', lines: ['.coding-flow/', 'epics/', 'specs/', '.specify/'] } },
    { script: 'lint', command: 'npm run lint -- --fix' },
  ]);
  run(dir, ['init']);
  const { output } = run(dir, ['bootstrap', '--scan']);
  const keepOut = "keep Coding Flow's files out of it: add `\\.coding-flow/`, `epics/`, `specs/`, `\\.specify/` to \\.prettierignore";
  assert.match(output, new RegExp(`Fixer recipes for validation\\.fix: \`npm run format\` — ${keepOut}, \`npm run lint -- --fix\``));
  const scan = fs.readFileSync(path.join(dir, 'docs', 'bootstrap-scan.md'), 'utf8');
  assert.match(scan, new RegExp(`## Fixer Recipes\\n\\nCandidates for \`validation\\.fix\`[^\\n]*\\n\\n- format: \`npm run format\` — ${keepOut}\\n- lint: \`npm run lint -- --fix\``));
  assert.equal(fs.existsSync(path.join(dir, '.prettierignore')), false, 'the ignore lines are printed, never written');
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

test('a fixer alone is no proof: with no check, verify is red', (t) => {
  const dir = project(t, { fix: [node('0')] });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }));
  const { code, output } = verify(dir);
  assert.notEqual(code, 0, output);
  const evidence = JSON.parse(output);
  assert.equal(evidence.commandsFound, 0);
  assert.equal(evidence.commandsOk, false);
  assert.equal(evidence.ok, false);
  // Asked again without --no-cache: no earlier proof answers for it either.
  const again = run(dir, ['verify']);
  assert.notEqual(again.code, 0, again.output);
  assert.doesNotMatch(again.output, /already proved/);
});

test('a story whose plan has no checks is red even when the config declares a fixer', (t) => {
  const dir = project(t, { fix: [node('0')] });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }));
  fs.mkdirSync(path.join(dir, STORY), { recursive: true });
  fs.writeFileSync(path.join(dir, STORY, 'spec.md'), '# Demo\n');
  fs.writeFileSync(path.join(dir, STORY, 'plan.md'), '# Plan\n\n## Decisions\n\n- none\n');
  const { code, output } = run(dir, ['verify', '--story', STORY, '--json', '--no-cache']);
  assert.notEqual(code, 0, output);
  assert.equal(JSON.parse(output).ok, false);
});

test('--dry-run with fixers and no check says the fixers prove nothing', (t) => {
  const dir = project(t, { fix: [FIXER] });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }));
  const { output } = run(dir, ['verify', '--dry-run']);
  assert.match(output, /No validation commands found: fixers alone prove nothing\./);
  assert.doesNotMatch(output, /Checks:/);
});

test('the command fingerprint changes with a fixer and with a fixer limit, and not without fixers', () => {
  const { commandsFingerprint, provedCommands } = require('../bin/lib/evidence');
  const of = (resolution) => commandsFingerprint(provedCommands(resolution), resolution.timeouts);
  const base = { commands: ['npm test'], timeouts: {}, fix: ['npm run fix'], fixTimeouts: {} };
  assert.notEqual(of(base), of({ ...base, fix: ['npm run format'] }), 'another fixer');
  assert.notEqual(of(base), of({ ...base, fixTimeouts: { 'npm run fix': 5000 } }), 'another fixer limit');
  assert.notEqual(of(base), of({ ...base, fix: [] }), 'a fixer removed');
  // A fixer is not a check of the same text.
  assert.notEqual(of({ ...base, fix: ['npm test'], commands: [] }), of({ ...base, fix: [], commands: ['npm test'] }));
  // No fixer: exactly the fingerprint every earlier proof carries.
  assert.equal(of({ ...base, fix: [] }), commandsFingerprint(['npm test'], {}));
});

// A high-risk change with no test, and a fixer that reformats an unrelated,
// unformatted test file. `mode`: 'fixer' (the fixer does it), 'hand' (the same
// rewrite made by hand, uncommitted), or 'none'.
function untestedAuthChange(t, mode, rewrite = "const assert = require('assert');\\nassert.ok(true);\\n") {
  const dir = project(t, { ...(mode === 'fixer' ? { fix: ['node fix.js'] } : {}), commands: [node('0')] }, { gitRepo: false });
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), "const assert=require('assert')\nassert.ok(true)\n");
  fs.writeFileSync(path.join(dir, 'src', 'auth.js'), 'module.exports = 1;\n');
  fs.writeFileSync(
    path.join(dir, 'fix.js'),
    `require('fs').writeFileSync('test/a.test.js', "${rewrite}");\n`,
  );
  const commit = (message) => {
    git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
    git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', message]);
  };
  git(dir, ['init', '-q', '-b', 'main']);
  commit('base');
  git(dir, ['checkout', '-qb', 'story']);
  fs.writeFileSync(path.join(dir, 'src', 'auth.js'), 'module.exports = function login(password) { return password === "x"; };\n');
  commit('auth: login');
  const fresh = () => {
    git(dir, ['checkout', '-q', '--', 'test/a.test.js']);
    if (mode === 'hand') {
      execFileSync(process.execPath, ['fix.js'], { cwd: dir });
    }
  };
  fresh();
  const evidence = JSON.parse(run(dir, ['verify', '--json', '--no-cache', '--base', 'main']).output);
  fresh();
  const { output } = run(dir, ['verify', '--no-cache', '--base', 'main']);
  return { dir, evidence, output, commit };
}

test("a fixer's rewrite counts as the story's diff, like the same edit by hand, and verify says it was a fixer's", (t) => {
  const none = untestedAuthChange(t, 'none').evidence;
  assert.equal(none.ok, false, 'the premise: an untested auth change is not proven');
  const hand = untestedAuthChange(t, 'hand');
  const fixer = untestedAuthChange(t, 'fixer');
  // One verdict for one tree: the fixer changes no rule of the gate.
  assert.equal(fixer.evidence.ok, hand.evidence.ok);
  assert.equal(fixer.evidence.coverage.mode, hand.evidence.coverage.mode);
  assert.deepEqual(fixer.evidence.fixedFiles, ['test/a.test.js']);
  // Story 19-08: a reformat is neutral, by a fixer or by hand — the gate is not
  // passed and the file is named neutral, never counted as strengthened.
  assert.equal(fixer.evidence.ok, false, 'a reformatted test does not prove an untested auth change');
  assert.equal(hand.evidence.ok, false);
  assert.deepEqual(fixer.evidence.coverage.neutralTests, ['test/a.test.js']);
  assert.deepEqual(hand.evidence.coverage.neutralTests, ['test/a.test.js']);
  assert.equal('fixerStrengthened' in fixer.evidence, false);
  assert.equal('fixerStrengthened' in hand.evidence, false);
  assert.match(fixer.output, /Tests changed without a new test or assertion \(neutral\)/);
  assert.doesNotMatch(hand.output, /rewritten by a fixer/);
});

test('a fixer that adds an assertion to a test file is still named as a fixer\'s strengthening', (t) => {
  const { evidence, output } = untestedAuthChange(t, 'fixer', "const assert = require('assert');\\nassert.ok(true);\\nassert.ok(1);\\n");
  assert.deepEqual(evidence.fixerStrengthened, ['test/a.test.js']);
  assert.match(output, /Warning: 1 test file\(s\) counted as strengthened were rewritten by a fixer in this run: test\/a\.test\.js/);
});

test('a verdict made with a fixer holds once its change is committed: reuse and a fresh run agree', (t) => {
  // The fixer rewrites a high-risk file the branch did not touch.
  const dir = project(t, { fix: ['node fix.js'], commands: [node('0')] }, { gitRepo: false });
  fs.writeFileSync(path.join(dir, 'src', 'auth.js'), 'module.exports = (p) => p === "x";\n');
  fs.writeFileSync(path.join(dir, 'fix.js'), "require('fs').writeFileSync('src/auth.js', 'module.exports = (p) => p === \"x\" || p === \"admin\";\\n');\n");
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  git(dir, ['checkout', '-qb', 'story']);
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'const y = 3;\n');
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'b']);
  const first = JSON.parse(run(dir, ['verify', '--json', '--no-cache', '--base', 'main']).output);
  assert.deepEqual(first.fixedFiles, ['src/auth.js']);
  assert.ok(first.coverage.changedFiles.includes('src/auth.js'), 'the rewritten file is in the diff');
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'fmt']);
  const fresh = JSON.parse(run(dir, ['verify', '--json', '--no-cache', '--base', 'main']).output);
  assert.equal(fresh.ok, first.ok);
  assert.deepEqual(fresh.coverage.changedFiles, first.coverage.changedFiles);
});

test('a fixer that deletes a test file is a deleted test, as by hand', (t) => {
  const dir = project(t, { fix: [node("require('fs').unlinkSync('test/b.test.js')")], commands: [node('0')] }, { gitRepo: false });
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'b.test.js'), "require('assert').ok(true);\n");
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  git(dir, ['checkout', '-qb', 'story']);
  fs.writeFileSync(path.join(dir, 'src', 'auth.js'), 'module.exports = (p) => p === "x";\n');
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'auth']);
  const evidence = JSON.parse(run(dir, ['verify', '--json', '--no-cache', '--base', 'main']).output);
  assert.deepEqual(evidence.fixedFiles, ['test/b.test.js']);
  const deleted = (evidence.coverage.weakenedTests || []).find((finding) => finding.file === 'test/b.test.js');
  assert.equal(deleted && deleted.signal, 'deleted', JSON.stringify(evidence.coverage));
});

test('a fixer that writes under .coding-flow/ is listed and makes verify red, naming the file', (t) => {
  const forge = node("require('fs').mkdirSync('.coding-flow/runs',{recursive:true});require('fs').writeFileSync('.coding-flow/runs/forged-verify.json','{}')");
  const dir = project(t, { fix: [forge], commands: [node('0')] });
  const { code, output } = verify(dir);
  assert.notEqual(code, 0, output);
  const evidence = JSON.parse(output);
  assert.ok(evidence.fixedFiles.includes('.coding-flow/runs/forged-verify.json'), JSON.stringify(evidence.fixedFiles));
  assert.equal(evidence.ok, false);
  const refusal = evidence.results.find((r) => r.command === '(fixers)');
  assert.match(refusal.toolError, /a fixer changed \.coding-flow\/runs\/forged-verify\.json/);
});

test("a fixer that rewrites the story's own files makes verify red, naming them", (t) => {
  const tick = node(`require('fs').writeFileSync('${STORY}/spec.md','# Demo\\\\n\\\\n- [x] done\\\\n')`);
  const dir = project(t, { fix: [tick], commands: [node('0')] }, { gitRepo: false });
  fs.mkdirSync(path.join(dir, STORY), { recursive: true });
  fs.writeFileSync(path.join(dir, STORY, 'spec.md'), '# Demo\n\n- [ ] done\n');
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  const { code, output } = run(dir, ['verify', '--story', STORY, '--json', '--no-cache']);
  assert.notEqual(code, 0, output);
  const evidence = JSON.parse(output);
  assert.equal(evidence.ok, false);
  const refusal = evidence.results.find((r) => r.command === '(fixers)');
  assert.match(refusal.toolError, new RegExp(`a fixer changed ${STORY}/spec\\.md`));
});

test('with no check the fixers do not run at all', (t) => {
  const dir = project(t, { fix: [FIXER] });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }));
  verify(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'const x=1\n');
});

test('a ## Fixers block is not run when the checks come from the config, and verify says so', (t) => {
  const dir = project(t, { commands: [node('0')] });
  fs.mkdirSync(path.join(dir, STORY), { recursive: true });
  fs.writeFileSync(path.join(dir, STORY, 'spec.md'), '# Demo\n');
  fs.writeFileSync(path.join(dir, STORY, 'plan.md'), ['# Plan', '', '## Fixers', '', '```bash', FIXER, '```', ''].join('\n'));
  const { code, output } = run(dir, ['verify', '--story', STORY, '--no-cache']);
  assert.equal(code, 0, output);
  assert.match(output, /Warning: the ## Fixers block of plan\.md is not run \(1 command\(s\)\): the checks come from config/);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'const x=1\n');
});

test('the PR evidence block labels the fixers and names what they rewrote', () => {
  const { buildEvidenceBlock } = require('../bin/lib/ship');
  const block = buildEvidenceBlock({
    ok: true,
    generatedAt: '2026-11-23T00:00:00.000Z',
    results: [
      { command: 'npm run format', kind: 'fix', ok: true, exitCode: 0, durationMs: 5 },
      { command: 'npm test', ok: true, exitCode: 0, durationMs: 9 },
    ],
    fixedFiles: ['src/a.js'],
  });
  assert.match(block, /\| fix: `npm run format` \| ✅ exit 0 \|/);
  assert.match(block, /\| `npm test` \| ✅ exit 0 \|/);
  assert.match(block, /\*\*Fixed by the fixers:\*\* `src\/a\.js`/);
});

// A project below the repository top (`pkg/`): paths are the project's, and the
// forbidden-write rule sees the story and `.coding-flow/` there.
function subdirProject(t, fix) {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-fixers-top-')));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const dir = path.join(top, 'pkg');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  run(dir, ['init']);
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const x=1\n');
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { fix: [fix], commands: [node('0')] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.mkdirSync(path.join(dir, STORY), { recursive: true });
  fs.writeFileSync(path.join(dir, STORY, 'spec.md'), '# Demo\n\n- [ ] done\n');
  git(top, ['init', '-q']);
  git(top, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(top, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  return JSON.parse(run(dir, ['verify', '--story', STORY, '--json', '--no-cache']).output);
}

test('in a project below the repository top, fixed files are named from the project root', (t) => {
  const evidence = subdirProject(t, FIXER);
  assert.equal(evidence.ok, true, JSON.stringify(evidence.results));
  assert.deepEqual(evidence.fixedFiles, ['src/a.js']);
});

test("in a project below the repository top, a fixer rewriting the story's files is red", (t) => {
  const evidence = subdirProject(t, node(`require('fs').writeFileSync('${STORY}/spec.md','# Demo\\\\n\\\\n- [x] done\\\\n')`));
  assert.equal(evidence.ok, false);
  const refusal = evidence.results.find((r) => r.command === '(fixers)');
  assert.ok(refusal, JSON.stringify(evidence.results));
  assert.match(refusal.toolError, new RegExp(`a fixer changed ${STORY}/spec\\.md`));
});

test('in a project below the repository top, a fixer rewriting .coding-flow/ is red', (t) => {
  // A changed value: a whitespace-only reformat of a JSON file is no write.
  const evidence = subdirProject(t, node("const f='.coding-flow/config.json';const fs=require('fs');fs.writeFileSync(f,JSON.stringify({...JSON.parse(fs.readFileSync(f,'utf8')),forged:true}))"));
  assert.equal(evidence.ok, false);
  const refusal = evidence.results.find((r) => r.command === '(fixers)');
  assert.ok(refusal, JSON.stringify(evidence.results));
  assert.match(refusal.toolError, /a fixer changed \.coding-flow\/config\.json/);
});

// The ignore lines this repository and `init`'d projects carry for .coding-flow/.
const CODING_FLOW_IGNORES = [
  '.coding-flow/runs/',
  '.coding-flow/denials.jsonl',
  '.coding-flow/guard-unchecked.jsonl',
  '.coding-flow/manifest.json',
  '.coding-flow/active-story.json',
];

function ignoredRunsProject(t, fix) {
  const dir = project(t, { fix: [fix], commands: [node('0')] }, { gitRepo: false });
  fs.writeFileSync(path.join(dir, '.gitignore'), `${CODING_FLOW_IGNORES.join('\n')}\n`);
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  return dir;
}

for (const target of ['.coding-flow/runs/forged-verify.json', '.coding-flow/active-story.json', '.coding-flow/manifest.json']) {
  test(`a fixer writing the ignored ${target} is seen and red`, (t) => {
    const dir = ignoredRunsProject(t, node(
      `const fs=require('fs');fs.mkdirSync(require('path').dirname('${target}'),{recursive:true});fs.writeFileSync('${target}','{}')`,
    ));
    assert.equal(git(dir, ['check-ignore', target]).trim(), target, 'the premise: git ignores it');
    const { code, output } = verify(dir);
    assert.notEqual(code, 0, output);
    const evidence = JSON.parse(output);
    assert.ok(evidence.fixedFiles.includes(target), JSON.stringify(evidence.fixedFiles));
    assert.equal(evidence.ok, false);
  });
}

test('without --json, a fixer that writes .coding-flow/ prints a red verify naming the file, not a crash', (t) => {
  const dir = ignoredRunsProject(t, node("require('fs').mkdirSync('.coding-flow/runs',{recursive:true});require('fs').writeFileSync('.coding-flow/runs/forged-verify.json','{}')"));
  const { code, output } = run(dir, ['verify', '--no-cache']);
  assert.notEqual(code, 0, output);
  assert.doesNotMatch(output, /Coding Flow bug/);
  assert.match(output, /Harness verify FAILED/);
  assert.match(output, /a fixer changed \.coding-flow\/runs\/forged-verify\.json/);
});

test('without --json, a fixer that fails prints a red verify, not a crash', (t) => {
  const dir = project(t, { fix: [FAILING_FIXER], commands: [node('0')] });
  const { code, output } = run(dir, ['verify', '--no-cache']);
  assert.equal(code, 1, output);
  assert.doesNotMatch(output, /Coding Flow bug/);
  assert.match(output, /\[exit 4\] fix: /);
});

test('without --json, fixers with no check print no proof, not a crash', (t) => {
  const dir = project(t, { fix: [FIXER] });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }));
  const { code, output } = run(dir, ['verify', '--no-cache']);
  assert.notEqual(code, 0, output);
  assert.doesNotMatch(output, /Coding Flow bug/);
  assert.match(output, /no validation commands found/i);
});

test('in a project below the repository top, a fixer writing outside the project is listed as ../', (t) => {
  const evidence = subdirProject(t, node("require('fs').writeFileSync('../outside.txt','x')"));
  assert.ok(evidence.fixedFiles.includes('../outside.txt'), JSON.stringify(evidence.fixedFiles));
});

test("without --json, a fixer that rewrites the story's files prints a red verify, not a crash", (t) => {
  const tick = node(`require('fs').writeFileSync('${STORY}/spec.md','# Demo\\\\n\\\\n- [x] done\\\\n')`);
  const dir = project(t, { fix: [tick], commands: [node('0')] }, { gitRepo: false });
  fs.mkdirSync(path.join(dir, STORY), { recursive: true });
  fs.writeFileSync(path.join(dir, STORY, 'spec.md'), '# Demo\n\n- [ ] done\n');
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  const { code, output } = run(dir, ['verify', '--story', STORY, '--no-cache']);
  assert.notEqual(code, 0, output);
  assert.doesNotMatch(output, /Coding Flow bug/);
  assert.match(output, new RegExp(`a fixer changed ${STORY}/spec\\.md`));
});

// Fresh tests are required for a high-risk story; the check is replayed from a
// build cache. The story touches only a README and a test; a fixer reformats a
// high-risk file. The fixed tree is high risk, so a fully replayed check is no
// proof — on every run, never once green and then red.
test('the fresh-test requirement reads the tree the fixers leave: red on every run, never reused green', (t) => {
  const reformat = "require('fs').writeFileSync('src/auth/login.js', 'module.exports = (p) => p === \"x\";\\n');\n";
  const dir = project(t, { fix: ['node fix.js'], commands: [node("console.log('>>> FULL TURBO')")] }, { gitRepo: false });
  const harnessPath = path.join(dir, '.coding-flow', 'harness.json');
  const harness = fs.existsSync(harnessPath) ? JSON.parse(fs.readFileSync(harnessPath, 'utf8')) : {};
  fs.writeFileSync(harnessPath, `${JSON.stringify({ ...harness, freshTestsFor: ['high'] }, null, 2)}\n`);
  fs.mkdirSync(path.join(dir, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'auth', 'login.js'), 'module.exports=(p)=>p==="x"\n');
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'x.test.js'), "require('assert').ok(true);\n");
  fs.writeFileSync(path.join(dir, 'fix.js'), reformat);
  const commit = (message) => {
    git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
    git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', message]);
  };
  git(dir, ['init', '-q', '-b', 'main']);
  commit('base');
  git(dir, ['checkout', '-qb', 'story']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# Demo\n');
  fs.writeFileSync(path.join(dir, 'test', 'x.test.js'), "require('assert').ok(true);\nrequire('assert').ok(1);\n");
  commit('docs and a test');

  const runs = [
    run(dir, ['verify', '--json', '--no-cache', '--base', 'main']),
    run(dir, ['verify', '--json', '--base', 'main']),
    run(dir, ['verify', '--json', '--no-cache', '--base', 'main']),
  ];
  const first = JSON.parse(runs[0].output);
  assert.deepEqual(first.fixedFiles, ['src/auth/login.js'], 'the premise: the fixer rewrote the high-risk file');
  for (const [index, { code, output }] of runs.entries()) {
    const evidence = JSON.parse(output);
    assert.notEqual(code, 0, `run ${index + 1}: ${output}`);
    assert.equal(evidence.ok, false, `run ${index + 1}`);
    assert.equal(evidence.reused, undefined, `run ${index + 1} must not be answered from a proof`);
    const check = evidence.results.find((result) => result.kind !== 'fix');
    assert.match(check.freshRequired || '', /fully replayed/, `run ${index + 1}: ${JSON.stringify(check)}`);
  }
});

test("the guard's own logs written during the fixers are neither listed nor a forbidden write", (t) => {
  const dir = ignoredRunsProject(t, node(
    "const fs=require('fs');fs.appendFileSync('.coding-flow/denials.jsonl','{}\\\\n');fs.appendFileSync('.coding-flow/guard-unchecked.jsonl','{}\\\\n');fs.writeFileSync('src/a.js','const x = 1;\\\\n')",
  ));
  const { code, output } = verify(dir);
  assert.equal(code, 0, output);
  const evidence = JSON.parse(output);
  assert.deepEqual(evidence.fixedFiles, ['src/a.js']);
});

test("a fixer that rewrites any story's files is red, even with no story in scope", (t) => {
  const tick = node("require('fs').writeFileSync('epics/epic-02/story-02-01/spec.md','- [x] done\\\\n')");
  const dir = project(t, { fix: [tick], commands: [node('0')] }, { gitRepo: false });
  fs.mkdirSync(path.join(dir, 'epics', 'epic-02', 'story-02-01'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'epics', 'epic-02', 'story-02-01', 'spec.md'), '- [ ] done\n');
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  const { code, output } = verify(dir);
  assert.notEqual(code, 0, output);
  const refusal = JSON.parse(output).results.find((r) => r.command === '(fixers)');
  assert.match(refusal.toolError, /a fixer changed epics\/epic-02\/story-02-01\/spec\.md/);
});

test('a strengthened test file named from the repository top matches the fixer list in the project root form', () => {
  const { matchFixerStrengthened } = require('../bin/lib/evidence');
  const { fromTop } = require('../bin/lib/identity');
  const top = path.resolve(os.tmpdir(), 'repo');
  const toProject = fromTop(top, path.join(top, 'pkg'));
  assert.deepEqual(
    matchFixerStrengthened(['test/a.test.js', 'pkg/test/b.test.js', 'pkg/test/c.test.js'], ['../test/a.test.js', 'test/b.test.js'], toProject),
    ['../test/a.test.js', 'test/b.test.js'],
  );
});

test('the PR evidence block prints why the (fixers) row is red', () => {
  const { buildEvidenceBlock } = require('../bin/lib/ship');
  const block = buildEvidenceBlock({
    ok: false,
    generatedAt: '2026-11-24T00:00:00.000Z',
    results: [{ command: '(fixers)', kind: 'fix', ok: false, exitCode: null, toolError: 'a fixer changed epics/x/spec.md', durationMs: 0 }],
  });
  assert.match(block, /\| fix: `\(fixers\)` \| ❌ a fixer changed epics\/x\/spec\.md \|/);
  assert.doesNotMatch(block, /exit null/);
});

// A formatter that walks the whole project, as `prettier --write .` does: every
// JSON re-indented with tabs, every Markdown file stripped of trailing spaces.
// `extra` runs after it (a forgery, for the red cases).
function walkingFormatter(dir, extra = '') {
  fs.writeFileSync(path.join(dir, 'fmt.js'), `
const fs = require('fs'), path = require('path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') walk(p); return; }
  const text = fs.readFileSync(p, 'utf8');
  if (p.endsWith('.json')) fs.writeFileSync(p, JSON.stringify(JSON.parse(text), null, '\\t') + '\\n');
  if (p.endsWith('.md')) fs.writeFileSync(p, text.replace(/[ \\t]+$/gm, ''));
});
walk('.');
${extra}
`);
}

const latestRun = "const r='.coding-flow/runs';const n=fs.existsSync(r)&&fs.readdirSync(r).filter((f)=>f.endsWith('-verify.json')).sort().pop();";

test('a formatter walking the project re-indents the run files every verify: green each time', (t) => {
  const dir = project(t, { fix: ['node fmt.js'], commands: [node('0')] }, { gitRepo: false });
  walkingFormatter(dir);
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  for (const index of [1, 2, 3]) {
    const { code, output } = verify(dir);
    assert.equal(code, 0, `run ${index}: ${output}`);
    assert.equal(JSON.parse(output).ok, true, `run ${index}`);
  }
  const runs = fs.readdirSync(path.join(dir, '.coding-flow', 'runs')).filter((name) => name.endsWith('-verify.json')).sort();
  assert.match(fs.readFileSync(path.join(dir, '.coding-flow', 'runs', runs[0]), 'utf8'), /^\t"/m, 'the premise: the formatter rewrote a run file');
});

test('a formatter that also changes a value in a run file is red', (t) => {
  const dir = project(t, { fix: ['node fmt.js'], commands: [node('0')] }, { gitRepo: false });
  walkingFormatter(dir, `${latestRun}if(n){const f=path.join(r,n);fs.writeFileSync(f,JSON.stringify({...JSON.parse(fs.readFileSync(f,'utf8')),ok:'forged'}));}`);
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  assert.equal(verify(dir).code, 0, 'the premise: no run file yet, nothing forged');
  const { code, output } = verify(dir);
  assert.notEqual(code, 0, output);
  assert.match(JSON.parse(output).results.find((r) => r.command === '(fixers)').toolError, /a fixer changed \.coding-flow\/runs\/.*-verify\.json/);
});

test('a formatter that also forges a new run file is red', (t) => {
  const dir = project(t, { fix: ['node fmt.js'], commands: [node('0')] }, { gitRepo: false });
  walkingFormatter(dir, "fs.mkdirSync('.coding-flow/runs',{recursive:true});fs.writeFileSync('.coding-flow/runs/9999-verify.json','{\"ok\":true}');");
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  const { code, output } = verify(dir);
  assert.notEqual(code, 0, output);
  assert.match(JSON.parse(output).results.find((r) => r.command === '(fixers)').toolError, /\.coding-flow\/runs\/9999-verify\.json/);
});

test('a formatter that reformats a story file is red, and the red names the remedy', (t) => {
  const dir = project(t, { fix: ['node fmt.js'], commands: [node('0')] }, { gitRepo: false });
  walkingFormatter(dir);
  fs.mkdirSync(path.join(dir, 'epics', 'epic-02', 'story-02-01'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'epics', 'epic-02', 'story-02-01', 'story.md'), '# Story   \n');
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  const { code, output } = verify(dir);
  assert.notEqual(code, 0, output);
  const { toolError } = JSON.parse(output).results.find((r) => r.command === '(fixers)');
  assert.match(toolError, /epics\/epic-02\/story-02-01\/story\.md/);
  assert.match(toolError, /add `\.coding-flow\/`, `epics\/`, `specs\/` and `\.specify\/` to your formatter's ignore file \(e\.g\. `\.prettierignore`\)/);
});

for (const [label, rewrite] of [
  ['truncates', "fs.writeFileSync(f,'')"],
  ['rewrites a line of', "fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('one','two'))"],
]) {
  test(`a fixer that ${label} a guard log is red (appending is not: see the guard-log test above)`, (t) => {
    const dir = ignoredRunsProject(t, node(`const fs=require('fs');const f='.coding-flow/denials.jsonl';${rewrite}`));
    fs.writeFileSync(path.join(dir, '.coding-flow', 'denials.jsonl'), '{"tool":"one"}\n');
    const { code, output } = verify(dir);
    assert.notEqual(code, 0, output);
    assert.match(JSON.parse(output).results.find((r) => r.command === '(fixers)').toolError, /\.coding-flow\/denials\.jsonl/);
  });
}

test("with fixers declared, another story's file put back unformatted is not answered from an earlier proof", (t) => {
  const dir = project(t, { fix: [node('0')], commands: [node('0')] }, { gitRepo: false });
  const other = path.join(dir, 'epics', 'epic-02', 'story-02-01', 'story.md');
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, '# Story\n');
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  assert.equal(run(dir, ['verify', '--json']).code, 0);
  assert.equal(JSON.parse(run(dir, ['verify', '--json']).output).reused, true, 'the premise: an unmoved tree is reused');
  fs.writeFileSync(other, '# Story   \n');
  const again = JSON.parse(run(dir, ['verify', '--json']).output);
  assert.equal(again.reused, undefined, JSON.stringify(again));
});

test('a test outside the project root strengthened by a fixer is named in one form end to end', (t) => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-fixers-top-')));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const dir = path.join(top, 'pkg');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  run(dir, ['init']);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { fix: ['node fix.js'], commands: [node('0')] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.mkdirSync(path.join(top, 'test'));
  fs.writeFileSync(path.join(top, 'test', 'a.test.js'), "const assert=require('assert')\nassert.ok(true)\n");
  fs.writeFileSync(path.join(dir, 'src', 'auth.js'), 'module.exports = 1;\n');
  // The fixer adds an assertion: since 19-08 only that counts as strengthened.
  fs.writeFileSync(path.join(dir, 'fix.js'), "require('fs').writeFileSync('../test/a.test.js', \"const assert = require('assert');\\nassert.ok(true);\\nassert.ok(1);\\n\");\n");
  const commit = (message) => {
    git(top, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
    git(top, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', message]);
  };
  git(top, ['init', '-q', '-b', 'main']);
  commit('base');
  git(top, ['checkout', '-qb', 'story']);
  fs.writeFileSync(path.join(dir, 'src', 'auth.js'), 'module.exports = function login(password) { return password === "x"; };\n');
  commit('auth: login');
  const evidence = JSON.parse(run(dir, ['verify', '--json', '--no-cache', '--base', 'main']).output);
  assert.deepEqual(evidence.fixedFiles, ['../test/a.test.js']);
  assert.deepEqual(evidence.fixerStrengthened, ['../test/a.test.js'], JSON.stringify(evidence.coverage));
});

test('a | in a result cell of the PR evidence block is escaped', () => {
  const { buildEvidenceBlock } = require('../bin/lib/ship');
  const block = buildEvidenceBlock({
    ok: false,
    generatedAt: '2026-11-24T00:00:00.000Z',
    results: [{ command: 'a | b', kind: 'fix', ok: false, exitCode: null, toolError: 'x | y', durationMs: 0 }],
  });
  assert.match(block, /\| fix: `a \\\| b` \| ❌ x \\\| y \| 0ms \|/);
});

test('with fixers declared, a Coding Flow file edited by hand is not answered from an earlier proof', (t) => {
  const dir = project(t, { fix: [node('0')], commands: [node('0')] });
  assert.equal(run(dir, ['verify', '--json']).code, 0);
  assert.equal(JSON.parse(run(dir, ['verify', '--json']).output).reused, true, 'the premise: an unmoved tree is reused');
  fs.appendFileSync(path.join(dir, '.coding-flow', 'COMMANDS.md'), '\nedited\n');
  const again = JSON.parse(run(dir, ['verify', '--json']).output);
  assert.equal(again.reused, undefined, JSON.stringify(again));
});

test('a JSON file under .coding-flow/ reformatted to the same value is named, in the evidence, the output and the PR body', (t) => {
  const dir = project(t, { fix: ['node fmt.js'], commands: [node('0')] }, { gitRepo: false });
  walkingFormatter(dir);
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  const evidence = JSON.parse(verify(dir).output);
  assert.ok(evidence.reformatted.includes('.coding-flow/config.json'), JSON.stringify(evidence));
  git(dir, ['checkout', '-q', '--', '.coding-flow/config.json']);
  const { output } = run(dir, ['verify', '--no-cache']);
  assert.match(output, /Reformatted, same value: [^\n]*\.coding-flow\/config\.json/);
  const { buildEvidenceBlock } = require('../bin/lib/ship');
  assert.match(buildEvidenceBlock(evidence), /\*\*Reformatted by the fixers, same value:\*\* [^\n]*`\.coding-flow\/config\.json`/);
});

test('a run file re-indented by a formatter is not a second ledger entry', (t) => {
  const { syncLedger, collectAll } = require('../bin/lib/audit');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-ledger-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runs = path.join(dir, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const file = path.join(runs, '2026-11-24T00-00-00-000Z-verify.json');
  const data = { ok: true, generatedAt: '2026-11-24T00:00:00.000Z', results: [] };
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  assert.equal(syncLedger(dir).added.length, 1);
  fs.writeFileSync(file, `${JSON.stringify(data, null, '\t')}\n`);
  assert.equal(syncLedger(dir).added.length, 0);
  assert.equal(collectAll(dir).length, 1);
});

// A guard log past the guard's size bound, as the guard leaves it: it keeps its
// last 200 lines, then appends (guard.js).
function bigGuardLogProject(t, keep) {
  // The newline is built, not escaped: `\n` reaches node as a newline through sh's
  // double quotes but as a backslash and an n through cmd.exe's, where the split
  // then found one line and the "trim" kept the whole file.
  const fixer = node(`const fs=require('fs');const f='.coding-flow/denials.jsonl';const n=String.fromCharCode(10);const k=fs.readFileSync(f,'utf8').split(n).filter(Boolean).slice(-${keep});fs.writeFileSync(f,k.join(n)+n+'{\\"tool\\":\\"new\\"}'+n)`);
  const dir = ignoredRunsProject(t, fixer);
  const line = `{"tool":"${'x'.repeat(120)}"}`;
  fs.writeFileSync(path.join(dir, '.coding-flow', 'denials.jsonl'), `${Array.from({ length: 2500 }, (_, i) => `${line.slice(0, -2)}${i}"}`).join('\n')}\n`);
  return dir;
}

test("the guard trimming its own log during the fixers is the guard's work, named, not a forbidden write", (t) => {
  const dir = bigGuardLogProject(t, 200);
  const { code, output } = verify(dir);
  assert.equal(code, 0, output);
  assert.deepEqual(JSON.parse(output).guardLogs, ['.coding-flow/denials.jsonl']);
});

test('a guard log cut otherwise than the guard trims it is a forbidden write', (t) => {
  const dir = bigGuardLogProject(t, 199);
  const { code, output } = verify(dir);
  assert.notEqual(code, 0, output);
  assert.match(JSON.parse(output).results.find((r) => r.command === '(fixers)').toolError, /\.coding-flow\/denials\.jsonl/);
});

test('a guard log created during the fixers is named', (t) => {
  const dir = ignoredRunsProject(t, node("require('fs').appendFileSync('.coding-flow/guard-unchecked.jsonl','{}\\\\n')"));
  const { code, output } = verify(dir);
  assert.equal(code, 0, output);
  assert.deepEqual(JSON.parse(output).guardLogs, ['.coding-flow/guard-unchecked.jsonl']);
});

test("a Biome or dprint fixer recipe prints the exact lines each tool's ignore needs", (t) => {
  const { detectFixRecipes } = require('../bin/lib/fix-recipes');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-fix-recipes-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { fmt: 'biome format --write .', dp: 'dprint fmt --write' } }));
  assert.deepEqual(detectFixRecipes(dir).map((recipe) => recipe.ignore), [
    { file: '`files.includes` in biome.json', lines: ['**', '!.coding-flow', '!epics', '!specs', '!.specify'] },
    { file: '`excludes` in dprint.json', lines: ['.coding-flow/', 'epics/', 'specs/', '.specify/'] },
  ]);
});

test('a file name with a newline is printed escaped, in the terminal and the PR body', { skip: process.platform === 'win32' && 'no newline in a Windows file name' }, (t) => {
  const dir = project(t, { fix: [node("require('fs').writeFileSync('src/a\\\\nb.js','x')")], commands: [node('0')] });
  const evidence = JSON.parse(verify(dir).output);
  assert.deepEqual(evidence.fixedFiles, ['src/a\nb.js']);
  fs.rmSync(path.join(dir, 'src', 'a\nb.js'));
  const { output } = run(dir, ['verify', '--no-cache']);
  assert.match(output, /^ {2}- src\/a\\nb\.js$/m);
  const { buildEvidenceBlock } = require('../bin/lib/ship');
  const block = buildEvidenceBlock(evidence);
  assert.match(block, /`src\/a\\nb\.js`/);
  assert.doesNotMatch(block, /src\/a\nb\.js/);
});
