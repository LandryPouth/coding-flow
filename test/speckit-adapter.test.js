'use strict';

// Spec Kit as an input, not a competitor. A Spec Kit feature directory already
// holds spec.md / plan.md / tasks.md — the three roles the tool already reads —
// so the adapter's whole job is to recognise it. These tests pin that a Spec Kit
// user gets the proof layer without adopting epics/, and that the recognition
// never guesses silently: a scope we inferred has to say where it came from.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { detectFeature, isFeatureOf, isSpecKitProject } = require('../bin/lib/speckit');

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

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function project(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFeature(dir, slug, { spec = '', plan = '', tasks = null } = {}) {
  const featureDir = path.join(dir, 'specs', slug);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'spec.md'), spec || `# ${slug}\n`);
  fs.writeFileSync(path.join(featureDir, 'plan.md'), plan || '# Plan\n');

  if (tasks !== null) {
    fs.writeFileSync(path.join(featureDir, 'tasks.md'), tasks);
  }

  return featureDir;
}

// A Spec Kit project that never ran `ai-flow init` with the full workflow: the
// enforcement layer alone, on top of somebody else's spec format.
function specKitRepo(t, prefix, { commands = ['node -e "process.exit(0)"'] } = {}) {
  const dir = project(t, prefix);
  fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });

  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands, quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);

  return dir;
}

function commit(dir, files, message) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message]);
}

// --- detection --------------------------------------------------------------

test('a repo with a specs/ folder but no .specify/ is not a Spec Kit project', (t) => {
  const dir = project(t, 'sk-notspeckit');
  writeFeature(dir, '001-thing');

  assert.equal(isSpecKitProject(dir), false);
  assert.equal(detectFeature(dir), null, 'we do not claim other people’s directories');
});

test('the pinned feature wins, exactly as Spec Kit resolves it', (t) => {
  const dir = project(t, 'sk-pinned');
  fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });
  writeFeature(dir, '001-old');
  writeFeature(dir, '002-current');
  fs.writeFileSync(
    path.join(dir, '.specify', 'feature.json'),
    JSON.stringify({ feature_directory: 'specs/002-current' }),
  );

  const detected = detectFeature(dir, { env: {} });

  assert.equal(path.basename(detected.dir), '002-current');
  assert.equal(detected.source, '.specify/feature.json');
});

test('the environment override outranks the pinned file', (t) => {
  const dir = project(t, 'sk-env');
  fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });
  writeFeature(dir, '001-a');
  writeFeature(dir, '002-b');
  fs.writeFileSync(
    path.join(dir, '.specify', 'feature.json'),
    JSON.stringify({ feature_directory: 'specs/001-a' }),
  );

  const detected = detectFeature(dir, { env: { SPECIFY_FEATURE_DIRECTORY: 'specs/002-b' } });

  assert.equal(path.basename(detected.dir), '002-b');
  assert.equal(detected.source, 'SPECIFY_FEATURE_DIRECTORY');
});

test('a feature directory outside the repo is refused, not followed', (t) => {
  const dir = project(t, 'sk-escape');
  fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });
  writeFeature(dir, '001-a');

  const detected = detectFeature(dir, { env: { SPECIFY_FEATURE_DIRECTORY: '../elsewhere' } });

  assert.equal(detected.source, 'the only feature under specs/', 'it fell back, it did not escape');
});

test('with nothing pinned, the branch name selects the feature', (t) => {
  const dir = project(t, 'sk-branch');
  fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });
  writeFeature(dir, '001-a');
  writeFeature(dir, '002-b');

  const detected = detectFeature(dir, { branch: '002-b', env: {} });

  assert.equal(path.basename(detected.dir), '002-b');
  assert.equal(detected.source, 'branch 002-b');
});

test('a spec.md alone is a feature — plan.md and tasks.md come later', (t) => {
  const dir = project(t, 'sk-speconly');
  fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });
  const featureDir = path.join(dir, 'specs', '001-fresh');
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'spec.md'), '# Fresh\n');

  const detected = detectFeature(dir, { env: {} });

  assert.equal(path.basename(detected.dir), '001-fresh');
});

test('only a direct child of specs/ counts as a feature', (t) => {
  const dir = project(t, 'sk-depth');
  fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });
  const nested = path.join(dir, 'specs', '001-a', 'sub');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'spec.md'), '# nope\n');

  assert.equal(isFeatureOf(dir, nested), false);
});

// --- the gate, on somebody else's layout ------------------------------------

test('verify scopes itself to the active feature and says where that came from', (t) => {
  const dir = specKitRepo(t, 'sk-verify');
  writeFeature(dir, '003-albums', { spec: '# Albums\n\nA plain listing page.\n' });
  fs.writeFileSync(
    path.join(dir, '.specify', 'feature.json'),
    JSON.stringify({ feature_directory: 'specs/003-albums' }),
  );
  commit(dir, { 'src/albums.js': 'module.exports = 1;\n' }, 'init');

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /specs\/003-albums/);
  assert.match(res.output, /Spec Kit feature, from \.specify\/feature\.json/);
});

test('risk read from the Spec Kit spec gates the change, with no epics/ anywhere', (t) => {
  const dir = specKitRepo(t, 'sk-risk');
  writeFeature(dir, '004-sharing', {
    spec: '# Sharing\n\nOnly the owner may read an album. This is an authorization boundary.\n',
  });
  fs.writeFileSync(
    path.join(dir, '.specify', 'feature.json'),
    JSON.stringify({ feature_directory: 'specs/004-sharing' }),
  );
  commit(dir, { 'src/share.js': 'module.exports = 1;\n' }, 'base');
  git(dir, ['checkout', '-b', 'feat/sharing']);
  commit(dir, { 'src/share.js': 'module.exports = () => true;\n' }, 'sharing');

  const res = run(dir, ['verify', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 1, res.output);
  assert.equal(coverage.ok, false);
  assert.equal(fs.existsSync(path.join(dir, 'epics')), false, 'no scaffolding was adopted');
});

test('--story accepts a feature directory explicitly', (t) => {
  const dir = specKitRepo(t, 'sk-explicit');
  writeFeature(dir, '005-explicit');
  commit(dir, { 'src/a.js': 'module.exports = 1;\n' }, 'init');

  const res = run(dir, ['verify', '--story', 'specs/005-explicit', '--dry-run']);

  assert.equal(res.code, 0, res.output);
});

test('--story still refuses a directory that is neither a story nor a feature', (t) => {
  const dir = specKitRepo(t, 'sk-refuse');
  writeFeature(dir, '006-real');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  commit(dir, { 'src/a.js': 'module.exports = 1;\n' }, 'init');

  const res = run(dir, ['verify', '--story', 'src']);

  assert.equal(res.code, 1);
  assert.match(res.output, /not under epics\/ or specs\//);
});

test('a project with no Spec Kit and no story verifies project-wide, as before', (t) => {
  const dir = project(t, 'sk-absent');
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.doesNotMatch(res.output, /Spec Kit/);
});
