'use strict';

// Optional Herdr integration (bin/lib/herdr.js), against a fake `herdr` binary
// that records its calls: the suite never touches a real Herdr.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { herdrActive, herdrOpenWorktree, herdrCloseWorktree, labelFor } = require('../bin/lib/herdr');

// A fake herdr: appends its argv to calls.jsonl, answers from replies.json
// (keyed by the first two args), exits 1 when no reply is set.
function fakeHerdr(t, replies) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-herdr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'herdr');
  fs.writeFileSync(path.join(dir, 'replies.json'), JSON.stringify(replies));
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify(args) + '\\n');
const reply = JSON.parse(fs.readFileSync(path.join(__dirname, 'replies.json'), 'utf8'))[args.slice(0, 2).join(' ')];
if (reply === undefined) process.exit(1);
process.stdout.write(typeof reply === 'string' ? reply : JSON.stringify(reply));
`,
  );
  fs.chmodSync(bin, 0o755);
  const calls = () => {
    const file = path.join(dir, 'calls.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };
  return { env: { PATH: process.env.PATH, HERDR_ENV: '1', HERDR_BIN_PATH: bin }, calls };
}

const root = '/repo';
const dest = '/repo-worktrees/story-02-01-sign-in';

test('outside Herdr, or with AI_FLOW_HERDR=0, herdr is never called', (t) => {
  const { env, calls } = fakeHerdr(t, {});
  assert.strictEqual(herdrActive({}), false);
  assert.strictEqual(herdrOpenWorktree({ root, dest, env: { ...env, HERDR_ENV: undefined } }), null);
  assert.strictEqual(herdrOpenWorktree({ root, dest, env: { ...env, AI_FLOW_HERDR: '0' } }), null);
  assert.strictEqual(herdrCloseWorktree({ root, dest, env: { ...env, AI_FLOW_HERDR: '0' } }), null);
  assert.deepStrictEqual(calls(), []);
});

test('a new worktree opens in the sidebar under its story number, without the focus', (t) => {
  const { env, calls } = fakeHerdr(t, { 'worktree open': { result: { workspace: { workspace_id: 'wF' } } } });
  assert.strictEqual(herdrOpenWorktree({ root, dest, env }), 'wF');
  assert.deepStrictEqual(calls(), [
    ['worktree', 'open', '--cwd', root, '--path', dest, '--label', 'story-02-01', '--no-focus'],
  ]);
  assert.strictEqual(labelFor('/x/herdr-sidebar'), 'herdr-sidebar');
});

test('a missing, failing or garbled herdr is silent: null, never a throw', (t) => {
  assert.strictEqual(herdrOpenWorktree({ root, dest, env: { HERDR_ENV: '1', HERDR_BIN_PATH: '/nowhere/herdr' } }), null);
  const failing = fakeHerdr(t, {});
  assert.strictEqual(herdrOpenWorktree({ root, dest, env: failing.env }), null);
  assert.strictEqual(herdrCloseWorktree({ root, dest, env: failing.env }), null);
  const garbled = fakeHerdr(t, { 'worktree open': 'not json' });
  assert.strictEqual(herdrOpenWorktree({ root, dest, env: garbled.env }), null);
});

const listed = (id) => ({ result: { worktrees: [{ path: root, open_workspace_id: 'w1' }, { path: dest, open_workspace_id: id }] } });

test('a removed worktree closes its workspace', (t) => {
  const { env, calls } = fakeHerdr(t, {
    'worktree list': listed('wF'),
    'pane list': { result: { panes: [{ workspace_id: 'wF', pane_id: 'wF:p1' }] } },
    'workspace close': '',
  });
  assert.deepStrictEqual(herdrCloseWorktree({ root, dest, env }), { closed: 'wF' });
  assert.deepStrictEqual(calls().at(-1), ['workspace', 'close', 'wF']);
});

test('a workspace an agent runs in, or this command runs from, is left open', (t) => {
  const busy = fakeHerdr(t, {
    'worktree list': listed('wF'),
    'pane list': { result: { panes: [{ workspace_id: 'wF', agent: 'claude' }] } },
    'workspace close': '',
  });
  assert.deepStrictEqual(herdrCloseWorktree({ root, dest, env: busy.env }), { kept: 'wF', reason: 'an agent runs in it' });
  assert.ok(!busy.calls().some((c) => c[1] === 'close'));

  const self = fakeHerdr(t, { 'worktree list': listed('wF'), 'workspace close': '' });
  assert.deepStrictEqual(herdrCloseWorktree({ root, dest, env: { ...self.env, HERDR_WORKSPACE_ID: 'wF' } }), {
    kept: 'wF',
    reason: 'this command runs from it',
  });
  assert.ok(!self.calls().some((c) => c[1] === 'close'));
});

test('a worktree with no open workspace closes nothing', (t) => {
  const { env, calls } = fakeHerdr(t, { 'worktree list': { result: { worktrees: [{ path: dest }] } } });
  assert.strictEqual(herdrCloseWorktree({ root, dest, env }), null);
  assert.deepStrictEqual(calls().map((c) => c.slice(0, 2).join(' ')), ['worktree list']);
});

test('worktree add opens it in Herdr, worktree remove closes it', (t) => {
  const { execFileSync } = require('node:child_process');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-herdr-repo-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('-c', 'init.defaultBranch=main', 'init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  git('add', '.');
  git('commit', '-m', 'init');

  const wt = fs.realpathSync(base) + '/repo-worktrees/side';
  const { env, calls } = fakeHerdr(t, {
    'worktree open': { result: { workspace: { workspace_id: 'wZ' } } },
    'worktree list': { result: { worktrees: [{ path: wt, open_workspace_id: 'wZ' }] } },
    'pane list': { result: { panes: [] } },
    'workspace close': '',
  });
  const cli = (...args) =>
    execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'ai-flow.js'), 'worktree', ...args], {
      cwd: repo,
      env: { ...env, HOME: process.env.HOME },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  assert.match(cli('add', 'side', '--deps', 'skip'), /herdr: opened as workspace wZ/);
  cli('remove', 'side');
  const made = calls().map((c) => c.slice(0, 2).join(' '));
  assert.deepStrictEqual(made, ['worktree open', 'worktree list', 'pane list', 'workspace close']);
  assert.strictEqual(path.relative(fs.realpathSync(base), calls()[0][5]).split(path.sep).join('/'), 'repo-worktrees/side');
});
