'use strict';

// A blocked glob `X/**` names everything under X — and X itself (story 13-09).
// Swapping the whole directory (`mv X /tmp/x`, edit, `mv /tmp/x <parent>/`) or
// extracting an archive or a patch into it rewrites the proof as surely as a
// redirect into one of its files does.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { decide } = require('../bin/lib/guard');
const { checkSensitivePaths } = require('../bin/lib/security-policy');
const { EVIDENCE_BLOCKED_PATHS } = require('../bin/lib/harness-config');

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.coding-flow', 'runs'), { recursive: true });
  return dir;
}

function guard(cwd, command) {
  try {
    execFileSync(process.execPath, [CLI, 'guard'], {
      cwd,
      input: JSON.stringify({ cwd, tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 20000,
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

const bash = (dir, command) => decide({ tool_name: 'Bash', cwd: dir, tool_input: { command } }, dir);

test('swapping the evidence directory back in is refused, end to end', (t) => {
  const dir = tmp(t);
  assert.equal(guard(dir, 'mv .coding-flow/runs /tmp/runs && sed -i s/failed/passed/ /tmp/runs/*.json && mv /tmp/runs .coding-flow/'), 2);
  assert.equal(guard(dir, 'cp -R /tmp/runs .coding-flow/'), 2);
  assert.equal(guard(dir, 'cp -r /tmp/r2/ .coding-flow/runs'), 2);
});

test('a write whose destination is a blocked directory itself is refused, and names it', (t) => {
  const dir = tmp(t);
  for (const command of ['mv /tmp/runs .coding-flow/', 'cp /tmp/x node_modules', 'rsync -a /tmp/r/ .coding-flow/runs', 'cp -a /tmp/k .ssh']) {
    const result = bash(dir, command);
    assert.equal(result.decision, 'deny', command);
  }
  assert.match(bash(dir, 'cp -r /tmp/r2/ .coding-flow/runs').reason, /\.coding-flow\/runs\b.*\.coding-flow\/runs\/\*\*/);
});

test('moving a blocked directory out is refused; moving one file out is a deletion and stays allowed', (t) => {
  const dir = tmp(t);
  assert.equal(bash(dir, 'mv .coding-flow/runs /tmp/runs').decision, 'deny');
  assert.equal(bash(dir, 'mv .coding-flow /tmp/cf').decision, 'deny');
  assert.equal(bash(dir, 'mv node_modules node_modules.old').decision, 'deny');
  assert.equal(bash(dir, 'mv .coding-flow/runs/a-verify.json /tmp/a.json').decision, 'allow');
});

test('an archive extracted into a blocked directory is refused; elsewhere in the project it is unchecked', (t) => {
  const dir = tmp(t);
  for (const command of ['tar -xf a.tar -C .coding-flow/runs', 'tar --directory=.coding-flow/runs -xzf a.tgz', 'tar xf a.tar --directory .coding-flow/runs', 'unzip a.zip -d .coding-flow/runs', 'unzip -o a.zip -d node_modules']) {
    assert.equal(bash(dir, command).decision, 'deny', command);
  }
  for (const command of ['tar -xf a.tar', 'unzip a.zip -d .coding-flow', 'cd src && tar -xzf ../a.tgz']) {
    const result = bash(dir, command);
    assert.equal(result.decision, 'unchecked', command);
    assert.match(result.reason, /archive/, command);
  }
});

test('reading or making an archive, or extracting outside the project, is not a write here', (t) => {
  const dir = tmp(t);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-out-')));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  for (const command of ['tar -cf /tmp/a.tar .', 'tar -tf a.tar', `tar -xf a.tar -C ${outside}`, 'unzip -l a.zip', `unzip a.zip -d ${outside}`, 'unzip -p a.zip x > /dev/null']) {
    assert.equal(bash(dir, command).decision, 'allow', command);
  }
});

test('git apply judges the paths its patch names; an unreadable patch or a stash is unchecked', (t) => {
  const dir = tmp(t);
  const patch = (name, file) => fs.writeFileSync(path.join(dir, name), `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-a\n+b\n`);
  patch('forge.diff', '.coding-flow/runs/a-verify.json');
  patch('ok.diff', 'src/a.js');
  fs.writeFileSync(path.join(dir, 'rename.diff'), 'diff --git a/x.json b/.coding-flow/runs/x.json\nsimilarity index 100%\nrename from x.json\nrename to .coding-flow/runs/x.json\n');

  assert.equal(bash(dir, 'git apply forge.diff').decision, 'deny');
  assert.equal(bash(dir, 'git apply --index -p1 forge.diff').decision, 'deny');
  assert.equal(bash(dir, 'git apply rename.diff').decision, 'deny');
  assert.equal(bash(dir, 'git apply ok.diff').decision, 'allow');
  assert.equal(bash(dir, 'git apply --check forge.diff').decision, 'allow');
  assert.equal(bash(dir, 'git apply --stat forge.diff').decision, 'allow');
  for (const command of ['git apply missing.diff', 'git apply < forge.diff', 'git stash pop', 'git stash apply stash@{1}']) {
    assert.equal(bash(dir, command).decision, 'unchecked', command);
  }
  for (const command of ['git stash', 'git stash list', 'git stash show -p']) {
    assert.equal(bash(dir, command).decision, 'allow', command);
  }
});

test('ordinary copies and moves between unblocked paths stay allowed', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'src'));
  for (const command of ['cp a b', 'mv a b', 'cp -r src dst', 'mv src lib', 'cp x .coding-flow/', 'rsync -a src/ build/', 'cp -R /tmp/runs ./runs-copy']) {
    assert.equal(bash(dir, command).decision, 'allow', command);
  }
});

test('the commit check exempts evidence by the same match the doctor uses', () => {
  const files = ['.coding-flow/runs/x-verify.json', '.coding-flow/ledger.jsonl', '.coding-flow/runs/nested/y.json', '.env'].map((f) => path.join(process.cwd(), f));
  for (const blockedPaths of [['.coding-flow/**', '.env'], ['.coding-flow/runs/*', '.coding-flow/ledger.jsonl', '.env'], [...EVIDENCE_BLOCKED_PATHS, '.env']]) {
    const report = { errors: [], warnings: [] };
    checkSensitivePaths(files, { blockedPaths, sensitiveGlobs: [] }, report);
    assert.deepEqual(report.errors.map((e) => e.file), ['.env'], JSON.stringify(blockedPaths));
  }
});

test('verify still writes its run file with the default blocked paths', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-verify-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  fs.writeFileSync(path.join(dir, '.coding-flow', 'config.json'), JSON.stringify({ validation: { commands: ['node -e "process.exit(0)"'] } }));
  fs.writeFileSync(path.join(dir, 'README.md'), '# app\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);

  execFileSync(process.execPath, [CLI, 'verify'], { cwd: dir, stdio: 'ignore' });

  const runs = fs.readdirSync(path.join(dir, '.coding-flow', 'runs')).filter((f) => f.endsWith('-verify.json'));
  assert.equal(runs.length, 1);
  const { blockedPaths } = require('../bin/lib/harness-config').readHarnessConfig(dir).config;
  for (const entry of EVIDENCE_BLOCKED_PATHS) assert.ok(blockedPaths.includes(entry), entry);
});
