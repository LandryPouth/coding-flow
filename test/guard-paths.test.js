'use strict';

// The guard judges the file a write will reach — through symlinks, `..`, `~`, the
// primary checkout seen from a worktree — not the string it was handed.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { decide } = require('../bin/lib/guard');

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-guard-paths-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function guard(cwd, payload, env = {}) {
  try {
    execFileSync(process.execPath, [CLI, 'guard'], {
      cwd,
      input: JSON.stringify({ cwd, ...payload }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { code: 0, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stderr: err.stderr || '' };
  }
}

const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path, content: 'A=1' } });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

test('a symlink to .env is refused by Write and by a shell redirection', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, '.env'), 'X=1');
  fs.symlinkSync('.env', path.join(dir, 'alias'));

  const viaWrite = guard(dir, write('alias'));
  assert.equal(viaWrite.code, 2);
  assert.match(viaWrite.stderr, /\.env \(via alias\)/);
  assert.equal(guard(dir, bash('echo A=1 > alias')).code, 2);
});

test('a dangling link to a protected file that does not exist yet is refused', (t) => {
  const dir = tmp(t);
  fs.symlinkSync('.env', path.join(dir, 'alias'));
  assert.equal(guard(dir, write('alias')).code, 2);
  assert.equal(guard(dir, bash('echo A=1 > alias')).code, 2);
});

test('a nested .coding-flow cannot swap in a weaker policy', (t) => {
  const dir = tmp(t);
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(path.join(sub, '.coding-flow'), { recursive: true });
  fs.writeFileSync(path.join(sub, '.coding-flow', 'harness.json'), '{"blockedPaths":[]}');
  assert.equal(guard(sub, write('../.env')).code, 2);
});

test('a link under a linked directory is read from its real directory', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
  fs.symlinkSync(path.join('sub', 'deep'), path.join(dir, 'a'));

  // Creating the link through `a/` aliases <root>/.env, not <root>/../.env.
  assert.equal(guard(dir, bash('ln -s ../../.env a/x')).code, 2);

  // The link already there and dangling (no .env yet): the write reaches <root>/.env.
  fs.symlinkSync(path.join('..', '..', '.env'), path.join(dir, 'sub', 'deep', 'x'));
  assert.equal(guard(dir, write('a/x')).code, 2);
  assert.equal(guard(dir, bash('echo A=1 > a/x')).code, 2);
  assert.equal(fs.existsSync(path.join(dir, '.env')), false);
});

test('a link made into a directory is read from that directory', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'x', 'y'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
  fs.symlinkSync(path.join('sub', 'deep'), path.join(dir, 'a'));

  // Each lands as x/y/.env -> ../../.env, which is <root>/.env.
  assert.equal(guard(dir, bash('ln -s ../../.env x/y/')).code, 2);
  assert.equal(guard(dir, bash('ln -s ../../.env x/y')).code, 2, 'an existing directory without the slash');
  assert.equal(guard(dir, bash('ln -s -t x/y ../../.env')).code, 2);
  assert.equal(guard(dir, bash('ln -s ../.env x/')).code, 2);
  // Through a linked directory: a/ is sub/deep, so ../../.env from there is <root>/.env.
  assert.equal(guard(dir, bash('ln -s ../../.env a/')).code, 2);
  assert.equal(guard(dir, bash('ln -s -t a ../../.env')).code, 2);
  // A directory made earlier in the same command does not exist when the guard reads it.
  assert.equal(guard(dir, bash('mkdir -p p/q && ln -s ../../.env p/q')).code, 2);
  assert.equal(guard(dir, bash('mkdir -p p/q && ln -s ../../.env p/q && echo A=1 > p/q/.env')).code, 2);
  // `-T` names the link itself: p/q -> ../../.env, read from p, is outside the project.
  assert.equal(guard(dir, bash('ln -sT ../../.env p/q')).code, 0);
  // The same shape pointing at an ordinary file stays allowed.
  assert.equal(guard(dir, bash('ln -s ../../README.md x/y/')).code, 0);
});

test('a one-operand ln writes the link it makes in the cwd', (t) => {
  const dir = tmp(t);
  const outside = tmp(t);
  fs.writeFileSync(path.join(outside, '.env'), 'E=1');
  fs.mkdirSync(path.join(dir, 'x'));
  const evil = path.join(outside, '.env');

  // `ln SRC` makes ./.env -> SRC: it replaces (or creates) the protected file.
  assert.equal(guard(dir, bash(`ln -sf ${evil}`)).code, 2);
  assert.equal(guard(dir, bash(`ln -f ${evil}`)).code, 2, 'a hard link too');
  assert.equal(guard(dir, bash(`ln -s ${evil}`)).code, 2, 'with no .env yet');
  // Made in a subdirectory, x/.env is not a protected path; an ordinary name stays allowed.
  assert.equal(guard(dir, bash(`cd x && ln -s ${evil}`)).code, 0);
  assert.equal(guard(dir, bash(`ln -s ${path.join(outside, 'notes.txt')}`)).code, 0);
});

test('a relative target is read from the real cwd when the cwd is reached through a link', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
  fs.symlinkSync(path.join('sub', 'deep'), path.join(dir, 'a'));
  const cwd = path.join(dir, 'a');
  const at = (payload) => decide({ cwd, ...payload }, cwd).decision;

  // The kernel resolves `..` from sub/deep: ../../.env is <root>/.env.
  assert.equal(at(write('../../.env')), 'deny');
  assert.equal(at(bash('echo A=1 > ../../.env')), 'deny');
  assert.equal(at(bash('ln -s ../../.env')), 'deny');
  assert.equal(at(bash('cd .. && echo A=1 > ../.env')), 'deny');
  assert.equal(at(write('../../src/new.js')), 'allow');
  // The reason names the path as it was given, not its lexical reading from the root.
  assert.match(decide({ cwd, ...write('../../.env') }, cwd).reason, /^\.env \(via \.\.\/\.\.\/\.env\) /);
});

test('a first path segment that merely starts with .. is not outside the root', (t) => {
  const dir = tmp(t);
  assert.equal(guard(dir, write('..foo/server.pem')).code, 2);
});

test('a link to an unprotected file elsewhere is allowed', (t) => {
  const dir = tmp(t);
  const elsewhere = tmp(t);
  fs.writeFileSync(path.join(elsewhere, 'file.txt'), 'x');
  fs.symlinkSync(path.join(elsewhere, 'file.txt'), path.join(dir, 'link.txt'));
  assert.equal(guard(dir, write('link.txt')).code, 0);
});

test('a new file whose parent exists is allowed', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'src'));
  assert.equal(guard(dir, write('src/new.js')).code, 0);
  assert.equal(guard(dir, write('missing/deeper/new.js')).code, 0);
});

test('a dangling or looping link never throws', (t) => {
  const dir = tmp(t);
  fs.symlinkSync('nowhere', path.join(dir, 'dangling'));
  fs.symlinkSync('b', path.join(dir, 'a'));
  fs.symlinkSync('a', path.join(dir, 'b'));
  assert.equal(guard(dir, write('dangling')).code, 0);
  assert.equal(guard(dir, write('a')).code, 0);
});

test('a session in a subdirectory still protects the repository .env', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  fs.mkdirSync(path.join(dir, 'apps', 'api'), { recursive: true });
  assert.equal(guard(path.join(dir, 'apps', 'api'), write('../../.env')).code, 2);
  assert.equal(guard(path.join(dir, 'apps', 'api'), write('src.js')).code, 0);
});

test('a story worktree protects its own .env and the primary checkout .env', (t) => {
  const primary = tmp(t);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git(primary, 'init', '-q');
  git(primary, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  fs.writeFileSync(path.join(primary, '.env'), 'X=1');
  const worktree = path.join(tmp(t), 'wt');
  git(primary, 'worktree', 'add', '-q', worktree);
  fs.symlinkSync(path.join(primary, '.env'), path.join(worktree, '.env'));

  assert.equal(guard(worktree, write('.env')).code, 2);
  assert.equal(guard(worktree, write(path.join(primary, '.env'))).code, 2);
  assert.equal(guard(worktree, write('src/a.js')).code, 0);
});

test('~ and $HOME reach the home directory policy', (t) => {
  const dir = tmp(t);
  const home = tmp(t);
  const env = { HOME: home, USERPROFILE: home };
  const keys = '.ssh/authorized_keys';

  assert.equal(guard(dir, bash(`echo k >> ~/${keys}`), env).code, 2);
  assert.equal(guard(dir, bash(`echo k >> $HOME/${keys}`), env).code, 2);
  assert.equal(guard(dir, bash('echo k >> ${HOME}/' + keys), env).code, 2);
  assert.equal(guard(dir, bash('echo k >> ~/notes.txt'), env).code, 0);
});

test('node_modules as a symlink does not block src, but a write under it is refused', (t) => {
  const dir = tmp(t);
  const store = tmp(t);
  fs.mkdirSync(path.join(store, 'pkg'));
  fs.symlinkSync(store, path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'src'));

  assert.equal(guard(dir, write('src/a.js')).code, 0);
  assert.equal(guard(dir, write('node_modules/pkg/index.js')).code, 2);
});

test('.env.example stays allowed through a link', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, '.env.example'), 'X=');
  fs.symlinkSync('.env.example', path.join(dir, 'sample'));
  assert.equal(guard(dir, write('sample')).code, 0);
});

test('a case-insensitive filesystem treats .ENV as .env', (t) => {
  const dir = tmp(t);
  const hook = { cwd: dir, ...write('.ENV') };
  assert.equal(decide(hook, dir, { caseInsensitive: true }).decision, 'deny');
  assert.equal(decide(hook, dir, { caseInsensitive: false }).decision, 'allow');
});

test('a cwd reached through a symlink does not climb past the repository to an outer .coding-flow', (t) => {
  const dir = tmp(t);
  const real = path.join(dir, 'real', 'proj');
  fs.mkdirSync(path.join(real, '.coding-flow'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: real, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, 'container', '.coding-flow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'container', '.coding-flow', 'harness.json'), '{"blockedPaths":[]}');
  const linked = path.join(dir, 'container', 'proj');
  fs.symlinkSync(real, linked);

  assert.equal(guard(linked, write('.env')).code, 2);
  assert.equal(guard(real, write('.env')).code, 2);
});

test('the secret-scan allowlist does not travel through a link out of docs/', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), '');
  fs.symlinkSync('../src/app.js', path.join(dir, 'docs', 'notes.md'));
  const secret = (file_path) => ({
    tool_name: 'Write',
    tool_input: { file_path, content: "password = 'abcdefghijklmnopqrstuvwxyz'" },
  });

  assert.equal(guard(dir, secret('docs/notes.md')).code, 2);
  assert.equal(guard(dir, secret('docs/plain.md')).code, 0);
});

test('a timed-out git lookup is retried, not remembered as "no repository"', { skip: process.platform === 'win32' }, (t) => {
  const primary = tmp(t);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git(primary, 'init', '-q');
  git(primary, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const worktree = path.join(tmp(t), 'wt');
  git(primary, 'worktree', 'add', '-q', worktree);

  // A `git` on PATH that hangs past the guard's timeout on the first
  // --git-common-dir lookup, then behaves like the real one.
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = tmp(t);
  const marker = path.join(bin, 'timed-out');
  fs.writeFileSync(
    path.join(bin, 'git'),
    `#!/bin/sh\ncase "$*" in *--git-common-dir*) [ -e "${marker}" ] || { touch "${marker}"; exec sleep 5; } ;; esac\nexec "${realGit}" "$@"\n`,
    { mode: 0o755 },
  );
  const savedPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; });

  const hook = { cwd: worktree, ...write(path.join(primary, '.env')) };
  // The call that timed out could not map the primary checkout: it says so.
  const first = decide(hook, worktree);
  assert.ok(fs.existsSync(marker), 'the first lookup went through the hanging git');
  assert.equal(first.decision, 'unchecked');
  assert.match(first.reason, /git did not answer in time/);
  assert.equal(decide(hook, worktree).decision, 'deny');
});

test('a session inside a nested repo (submodule, vendored repo) still protects the project .env', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  const nested = path.join(dir, 'vendor', 'lib');
  fs.mkdirSync(nested, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: nested, stdio: 'ignore' });

  assert.equal(guard(nested, write('../../.env')).code, 2);
  assert.equal(guard(nested, write(path.join(dir, '.env'))).code, 2);
  assert.equal(guard(nested, bash('echo A=2 > ../../.env')).code, 2);
  assert.equal(guard(nested, write('src.js')).code, 0);
});

test('a git that refuses the repository (safe.directory) makes the decision unchecked, not allow', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  // git's own knob (git >= 2.35.2) for "this repository belongs to someone else".
  const saved = process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
  process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
  t.after(() => {
    if (saved === undefined) delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
    else process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = saved;
  });

  const result = decide({ cwd: dir, ...write('src.js') }, dir);
  assert.equal(result.decision, 'unchecked');
  assert.match(result.reason, /safe\.directory/);
  assert.equal(decide({ cwd: dir, ...write('.env') }, dir).decision, 'deny');
});
