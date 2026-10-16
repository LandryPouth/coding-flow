'use strict';

// The Codex probe turns "the profile we wrote" into "a write was actually denied".
// What has to hold: the three outcomes stay distinct (denied / not denied /
// Codex failed for another reason), nothing is spawned without a codex binary,
// a hang cannot block doctor, and the probe never leaves files behind.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { probeCodexSandbox, interpretProbe, describeProbe, checkCodexBinary } = require('../bin/lib/codex-probe');

const codexAvailable = (() => {
  try {
    execFileSync('codex', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-codex-probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A stand-in `codex` whose sandbox behaviour is picked by FAKE_CODEX_MODE and
// whose invocations are logged, so every outcome runs through the real CLI.
function fakeCodex(t) {
  const dir = project(t);
  const log = path.join(dir, 'invocations.log');
  const script = `#!/bin/sh
echo "$@" >> "${log}"
if [ "$1" = "--version" ]; then echo "codex-cli fake"; exit 0; fi
for a in "$@"; do f="$a"; done
case "$FAKE_CODEX_MODE" in
  deny) echo "sh: 1: cannot create $f: Permission denied" >&2; exit 2 ;;
  allow) : > "$f"; exit 0 ;;
  fail) echo 'Error: default_permissions requires a \`[permissions]\` table' >&2; exit 1 ;;
esac
`;
  fs.writeFileSync(path.join(dir, 'codex'), script, { mode: 0o755 });
  return { dir, log };
}

function cli(cwd, args, { fake, mode, noCodex } = {}) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(cwd, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  delete env.CLAUDECODE;
  delete env.OPENCODE;
  if (fake) {
    env.PATH = `${fake.dir}:/usr/bin:/bin`;
    env.FAKE_CODEX_MODE = mode;
  } else if (noCodex) {
    env.PATH = '/usr/bin:/bin';
  }
  try {
    return { code: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function codexProject(t, opts) {
  const dir = project(t);
  assert.equal(cli(dir, ['init', '--target', 'codex'], opts).code, 0);
  return dir;
}

function platformRecords(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  return fs
    .readdirSync(runs)
    .sort()
    .map((n) => JSON.parse(fs.readFileSync(path.join(runs, n), 'utf8')))
    .filter((r) => r.kind === 'platform');
}

const leftovers = (dir) => fs.readdirSync(dir).filter((n) => n === '.ssh' || n.startsWith('.coding-flow-probe'));

// --- interpretation, in isolation -------------------------------------------

test('interpretProbe keeps denied / not-denied / unrelated failure apart', () => {
  const denied = interpretProbe({ status: 2, stderr: 'sh: cannot create x: Permission denied', wrote: false, directory: '.ssh' });
  assert.equal(denied.ok, true);
  assert.equal(interpretProbe({ status: 2, stderr: 'sh: cannot create x: Read-only file system', wrote: false, directory: '.ssh' }).ok, true);

  const open = interpretProbe({ status: 0, stderr: '', wrote: true, directory: '.ssh' });
  assert.deepEqual([open.ran, open.ok], [true, false]);

  // The file exists even though the exit looked like a denial: the file wins.
  assert.equal(interpretProbe({ status: 2, stderr: 'Permission denied', wrote: true, directory: '.ssh' }).ok, false);

  const unrelated = interpretProbe({ status: 1, stderr: 'Error: not logged in', wrote: false, directory: '.ssh' });
  assert.deepEqual([unrelated.ran, unrelated.ok], [true, null]);
  assert.match(unrelated.detail, /codex itself failed unrelated to the sandbox/);

  // Exit 0 with no file written is not a denial either: nothing proves the sandbox acted.
  assert.equal(interpretProbe({ status: 0, stderr: '', wrote: false, directory: '.ssh' }).ok, null);
});

test('a sandbox that fails to start is inconclusive, never a pass', () => {
  for (const stderr of ['bwrap: setting up uid map: Operation not permitted', 'sandbox failed: Permission denied (os error 13) reading config']) {
    const probe = interpretProbe({ status: 1, stderr, wrote: false, directory: '.ssh' });
    assert.deepEqual([probe.ran, probe.ok], [true, null], stderr);
  }
});

test('a bash-style denial of the probe file is still a pass', () => {
  const stderr = 'sh: line 1: /p/.ssh/.coding-flow-probe-1-2: Permission denied';
  assert.equal(interpretProbe({ status: 1, stderr, wrote: false, directory: '.ssh' }).ok, true);
});

test('an untrusted project is named as such, not read as a guard failure', () => {
  const probe = interpretProbe({ status: 1, stderr: 'Error: default_permissions requires a `[permissions]` table', wrote: false, directory: '.ssh' });
  assert.equal(probe.ok, null);
  assert.match(probe.detail, /not trusted in Codex yet/);
  assert.match(probe.detail, /trust_level = "trusted"/);
  assert.doesNotMatch(probe.detail, /default_permissions/, 'the raw Codex error is not the explanation');
});

test('describeProbe gives three distinct plain-language messages', () => {
  const messages = [
    describeProbe({ ran: true, ok: true, detail: 'd' }),
    describeProbe({ ran: true, ok: false, detail: 'd' }),
    describeProbe({ ran: false, ok: null, detail: 'd' }),
    describeProbe({ ran: true, ok: null, detail: 'd' }),
  ];
  assert.equal(new Set(messages).size, 4);
  assert.match(messages[0], /confirmed working/);
  assert.match(messages[1], /BROKEN/);
  assert.match(messages[2], /not checked/);
});

// --- the probe, with an injected spawn --------------------------------------

test('no codex on PATH: nothing is spawned and the probe is "not run"', (t) => {
  const dir = project(t);
  let spawned = 0;
  const probe = probeCodexSandbox({ root: dir, available: () => false, spawn: () => (spawned += 1) });
  assert.equal(spawned, 0);
  assert.equal(probe.ran, false);
  assert.deepEqual(leftovers(dir), []);
});

test('a denied write is ok:true and leaves nothing behind', (t) => {
  const dir = project(t);
  const calls = [];
  const probe = probeCodexSandbox({
    root: dir,
    available: () => true,
    spawn: (cmd, args) => {
      calls.push([cmd, args]);
      return { status: 2, stderr: 'sh: cannot create /x/.ssh/probe: Permission denied' };
    },
  });
  assert.equal(probe.ok, true);
  assert.equal(calls.length, 1, 'exactly one codex process per probe');
  assert.deepEqual(calls[0][1].slice(0, 3), ['sandbox', '--permissions-profile', 'coding-flow-guard']);
  assert.deepEqual(leftovers(dir), []);
});

test('a write that goes through is ok:false, and the stray file is cleaned up', (t) => {
  const dir = project(t);
  const probe = probeCodexSandbox({
    root: dir,
    available: () => true,
    spawn: (cmd, args) => {
      fs.writeFileSync(args[args.length - 1], 'probe');
      return { status: 0, stderr: '' };
    },
  });
  assert.deepEqual([probe.ran, probe.ok], [true, false]);
  assert.deepEqual(leftovers(dir), []);
});

test('an existing denied directory and its contents are left alone', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, '.ssh'));
  fs.writeFileSync(path.join(dir, '.ssh', 'keep'), 'mine');
  probeCodexSandbox({ root: dir, available: () => true, spawn: () => ({ status: 2, stderr: 'Permission denied' }) });
  assert.equal(fs.readFileSync(path.join(dir, '.ssh', 'keep'), 'utf8'), 'mine');
});

test('a hung codex is cut off by the timeout and read as inconclusive, not as a pass', (t) => {
  const dir = project(t);
  const started = Date.now();
  const probe = probeCodexSandbox({
    root: dir,
    available: () => true,
    timeoutMs: 200,
    spawn: (cmd, args, opts) => spawnSync('sleep', ['5'], opts),
  });
  assert.ok(Date.now() - started < 3000, 'the probe returned long before the hung process would have');
  assert.deepEqual([probe.ran, probe.ok], [true, null]);
  assert.match(probe.detail, /timed out/);
  assert.deepEqual(leftovers(dir), []);
});

test('a codex that is found but fails or hangs on --version is inconclusive, not "absent"', { skip: process.platform === 'win32' && 'the fake binary is a POSIX /bin/sh script' }, (t) => {
  const dir = project(t);
  const original = process.env.PATH;
  t.after(() => { process.env.PATH = original; });
  process.env.PATH = `${dir}:${original}`;

  fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
  assert.match(checkCodexBinary(), /^broken: .*exited 3/);
  assert.deepEqual([probeCodexSandbox({ root: dir }).ran, probeCodexSandbox({ root: dir }).ok], [true, null]);

  fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\nsleep 5\n', { mode: 0o755 });
  const started = Date.now();
  assert.match(checkCodexBinary(200), /^broken: .*timed out/);
  assert.ok(Date.now() - started < 3000);

  fs.rmSync(path.join(dir, 'codex'));
  process.env.PATH = dir;
  assert.equal(checkCodexBinary(), 'absent');
});

test('a policy with no plain directory entry is not probed (never a guessed target)', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify({ blockedPaths: ['.env', '**/*.pem'] }));
  let spawned = 0;
  const probe = probeCodexSandbox({ root: dir, available: () => true, spawn: () => (spawned += 1) });
  assert.equal(spawned, 0);
  assert.equal(probe.ran, false);
});

// --- through the CLI, with a fake codex -------------------------------------

test('doctor: a denied probe is confirmed-working, exits 0 and records probe.ok:true with the sandbox tier', { skip: process.platform === 'win32' && 'the fake binary is a POSIX /bin/sh script' }, (t) => {
  const fake = fakeCodex(t);
  const dir = codexProject(t, { fake, mode: 'deny' });
  const res = cli(dir, ['doctor'], { fake, mode: 'deny' });
  assert.equal(res.code, 0);
  assert.match(res.output, /Codex sandbox: confirmed working/);
  const last = platformRecords(dir).pop();
  assert.deepEqual([last.probe.ran, last.probe.ok], [true, true]);
  assert.equal(last.enforcementTier, 'sandbox');
});

test('init: a denied probe is logged as confirmed working and recorded with the sandbox tier', { skip: process.platform === 'win32' && 'the fake binary is a POSIX /bin/sh script' }, (t) => {
  const fake = fakeCodex(t);
  const dir = project(t);
  const res = cli(dir, ['init', '--target', 'codex'], { fake, mode: 'deny' });
  assert.equal(res.code, 0);
  assert.match(res.output, /Codex sandbox: confirmed working/);
  const last = platformRecords(dir).pop();
  assert.deepEqual([last.probe.ran, last.probe.ok], [true, true]);
  assert.equal(last.enforcementTier, 'sandbox');
});

test('init: a write that is NOT denied is flagged and never earns the sandbox tier', { skip: process.platform === 'win32' && 'the fake binary is a POSIX /bin/sh script' }, (t) => {
  const fake = fakeCodex(t);
  const dir = project(t);
  const res = cli(dir, ['init', '--target', 'codex'], { fake, mode: 'allow' });
  assert.match(res.output, /Codex sandbox: confirmed BROKEN/);
  const last = platformRecords(dir).pop();
  assert.equal(last.probe.ok, false);
  assert.notEqual(last.enforcementTier, 'sandbox');
});

test('doctor: a write that is NOT denied is an error, exit 1, probe.ok:false and no sandbox tier', { skip: process.platform === 'win32' && 'the fake binary is a POSIX /bin/sh script' }, (t) => {
  const fake = fakeCodex(t);
  const dir = codexProject(t, { fake, mode: 'allow' });
  const res = cli(dir, ['doctor', '--json'], { fake, mode: 'allow' });
  assert.equal(res.code, 1);
  const report = JSON.parse(res.output);
  assert.ok(report.errors.some((e) => e.code === 'codex_sandbox_not_enforcing'));
  assert.equal(report.warnings.some((w) => w.code === 'codex_sandbox_not_enforcing'), false);
  const last = platformRecords(dir).pop();
  assert.deepEqual([last.probe.ran, last.probe.ok], [true, false]);
  assert.notEqual(last.enforcementTier, 'sandbox');
  assert.deepEqual(leftovers(dir), []);
});

test('doctor: codex failing for its own reasons is a warning with probe.ok:null, never an error', { skip: process.platform === 'win32' && 'the fake binary is a POSIX /bin/sh script' }, (t) => {
  const fake = fakeCodex(t);
  const dir = codexProject(t, { fake, mode: 'fail' });
  const res = cli(dir, ['doctor', '--json'], { fake, mode: 'fail' });
  assert.equal(res.code, 0);
  const report = JSON.parse(res.output);
  assert.ok(report.warnings.some((w) => w.code === 'codex_sandbox_unconfirmed'));
  assert.equal(report.errors.length, 0);
  const last = platformRecords(dir).pop();
  assert.deepEqual([last.probe.ran, last.probe.ok], [true, null]);
  assert.notEqual(last.enforcementTier, 'sandbox');
});

test('doctor: no codex on PATH spawns nothing, exits 0 and records probe.ran:false', (t) => {
  const dir = codexProject(t, { noCodex: true });
  const res = cli(dir, ['doctor'], { noCodex: true });
  assert.equal(res.code, 0);
  assert.match(res.output, /Codex sandbox: not checked/);
  const last = platformRecords(dir).pop();
  assert.equal(last.probe.ran, false);
});

test('doctor: a glob-only policy warns that the profile could not be probed', { skip: process.platform === 'win32' && 'the fake binary is a POSIX /bin/sh script' }, (t) => {
  const fake = fakeCodex(t);
  const dir = codexProject(t, { fake, mode: 'deny' });
  fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify({ blockedPaths: ['.env', '**/*.pem'] }));
  cli(dir, ['upgrade'], { fake, mode: 'deny' });
  const report = JSON.parse(cli(dir, ['doctor', '--json'], { fake, mode: 'deny' }).output);
  assert.ok(report.warnings.some((w) => w.code === 'codex_sandbox_unprobed'));
  assert.equal(report.errors.some((e) => e.code === 'codex_sandbox_not_enforcing'), false);
});

test('doctor twice on an unchanged project runs one version check and one sandbox spawn per run and adds no duplicate evidence', { skip: process.platform === 'win32' && 'the fake binary is a POSIX /bin/sh script' }, (t) => {
  const fake = fakeCodex(t);
  const dir = codexProject(t, { fake, mode: 'deny' });
  const before = fs.readFileSync(fake.log, 'utf8').trim().split('\n').length;
  cli(dir, ['doctor'], { fake, mode: 'deny' });
  const afterOne = fs.readFileSync(fake.log, 'utf8').trim().split('\n').length;
  const rows = platformRecords(dir).length;
  cli(dir, ['doctor'], { fake, mode: 'deny' });
  assert.equal(afterOne - before, 2);
  assert.equal(fs.readFileSync(fake.log, 'utf8').trim().split('\n').length - afterOne, 2);
  assert.equal(platformRecords(dir).length, rows);
});

test('a claude project never runs the probe', (t) => {
  const fake = fakeCodex(t);
  const dir = project(t);
  cli(dir, ['init', '--target', 'claude'], { fake, mode: 'deny' });
  const res = cli(dir, ['doctor', '--json'], { fake, mode: 'deny' });
  assert.equal(JSON.parse(res.output).codexProbe, null);
  assert.equal(fs.existsSync(fake.log), false);
});

test('report shows the probe outcome next to the tier it earned', { skip: process.platform === 'win32' && 'the fake binary is a POSIX /bin/sh script' }, (t) => {
  const fake = fakeCodex(t);
  const dir = codexProject(t, { fake, mode: 'deny' });
  cli(dir, ['doctor'], { fake, mode: 'deny' });
  const out = cli(dir, ['report'], { fake, mode: 'deny' }).output;
  const section = out.split('## Platform coverage')[1].split('## Guard denials')[0];
  assert.match(section, /enforcementTier: sandbox \(probe: write denied\)/);
});

// --- against the real codex (auto-skipped without the binary) ----------------

function trustedProject(t) {
  const dir = fs.realpathSync(project(t));
  const home = project(t);
  fs.writeFileSync(path.join(home, 'config.toml'), `[projects."${dir}"]\ntrust_level = "trusted"\n`);
  return { dir, home };
}

function withCodexHome(home, fn) {
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
}

test('real codex: the generated profile really denies the write (trusted project)', { skip: !codexAvailable }, (t) => {
  const { dir, home } = trustedProject(t);
  withCodexHome(home, () => {
    const { ensureCodexSandbox } = require('../bin/lib/codex-settings');
    ensureCodexSandbox({ root: dir });
    const probe = probeCodexSandbox({ root: dir });
    assert.deepEqual([probe.ran, probe.ok], [true, true], probe.detail);
  });
  assert.deepEqual(leftovers(dir), []);
});

test('real codex, negative control: a profile that denies nothing is caught as ok:false', { skip: !codexAvailable }, (t) => {
  const { dir, home } = trustedProject(t);
  fs.mkdirSync(path.join(dir, '.codex'));
  fs.writeFileSync(
    path.join(dir, '.codex', 'config.toml'),
    `default_permissions = "coding-flow-guard"\n\n[permissions.coding-flow-guard.filesystem]\n"/" = "read"\n\n[permissions.coding-flow-guard.filesystem.":workspace_roots"]\n"." = "write"\n`,
  );
  withCodexHome(home, () => {
    const probe = probeCodexSandbox({ root: dir });
    assert.deepEqual([probe.ran, probe.ok], [true, false], probe.detail);
  });
  assert.deepEqual(leftovers(dir), []);
});

test('real codex: an untrusted project is inconclusive, not a pass and not a failure', { skip: !codexAvailable }, (t) => {
  const dir = fs.realpathSync(project(t));
  const home = project(t);
  fs.writeFileSync(path.join(home, 'config.toml'), '');
  withCodexHome(home, () => {
    const { ensureCodexSandbox } = require('../bin/lib/codex-settings');
    ensureCodexSandbox({ root: dir });
    const probe = probeCodexSandbox({ root: dir });
    assert.deepEqual([probe.ran, probe.ok], [true, null], probe.detail);
  });
});
