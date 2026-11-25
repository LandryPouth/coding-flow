'use strict';

// Story 26-07, criterion 7: `ai-flow ship` says the open `before: deploy` items
// of the stories in the branch — printed, and as a `Before you deploy` section
// of the PR body — and never blocks on them. The PR is a fake `gh` on PATH that
// keeps the body in a file, behind an origin whose path names github.com, so
// the real ship code path runs end to end with no network.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { buildDeployBlock, upsertDeployBlock } = require('../bin/lib/ship');

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function run(cwd, args, env = {}) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// gh stand-in: `--version`, `pr view <b> --json url,state|body`, `pr edit <b> --body <text>`.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const state = process.env.FAKE_GH_DIR;
const args = process.argv.slice(2);
const bodyFile = path.join(state, 'body.md');
if (args[0] === '--version') { process.stdout.write('gh version 0.0.0\\n'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'view') {
  const fields = args[args.indexOf('--json') + 1];
  if (fields === 'body') { process.stdout.write(JSON.stringify({ body: fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '' })); process.exit(0); }
  process.stdout.write(JSON.stringify({ url: 'https://github.com/o/r/pull/1', state: 'OPEN' })); process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'edit') { fs.writeFileSync(bodyFile, args[args.indexOf('--body') + 1]); process.exit(0); }
process.exit(1);
`;

function shipRepo(t, { todo }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-ship-deploy-'));
  const origin = path.join(base, 'github.com', 'origin.git');
  const repo = path.join(base, 'repo');
  const bin = path.join(base, 'bin');
  const state = path.join(base, 'gh-state');
  fs.mkdirSync(path.dirname(origin), { recursive: true });
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(state, 'body.md'), 'Written by a human.');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  sh(base, 'git', ['init', '--bare', origin]);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  sh(repo, 'git', ['remote', 'add', 'origin', origin]);
  fs.mkdirSync(path.join(repo, '.coding-flow'));
  fs.writeFileSync(path.join(repo, '.coding-flow', 'config.json'), JSON.stringify({ storage: 'local' }));
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  sh(repo, 'git', ['push', '-u', 'origin', 'main']);

  const name = 'story-01-01-backfill';
  const dir = path.join(repo, 'epics', 'epic-01-shop', name);
  sh(repo, 'git', ['checkout', '-b', name]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'story.md'), `# Story 01-01\n\n## Status: in-progress\n${todo ? `\n## Human to-do\n\n${todo}\n` : ''}`);
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'story']);

  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GH_DIR: state };
  return { repo, env, body: () => fs.readFileSync(path.join(state, 'body.md'), 'utf8') };
}

const posixOnly = { skip: process.platform === 'win32' ? 'the fake gh is a shebang script' : false };

test('criterion 7: ship prints the before-deploy item and the PR body gets a Before you deploy section', posixOnly, (t) => {
  const { repo, env, body } = shipRepo(t, { todo: '- [ ] (before: deploy) Run the backfill\n- [ ] (before: later) Rotate the key' });

  const res = run(repo, ['ship', '--no-evidence'], env);
  assert.strictEqual(res.code, 0, res.output);
  assert.match(res.output, /Before you deploy \(1\):\n {2}- \[ \] Run the backfill \(story-01-01-backfill\) \[[0-9a-f]{7}\]/);
  assert.doesNotMatch(res.output, /Rotate the key/);

  const pr = body();
  assert.match(pr, /^Written by a human\./);
  assert.match(pr, /### Before you deploy\n\n- \[ \] Run the backfill \(`story-01-01-backfill`/);
  assert.doesNotMatch(pr, /Rotate the key/);

  // Idempotent: a second ship leaves one section.
  assert.strictEqual(run(repo, ['ship', '--no-evidence'], env).code, 0);
  assert.strictEqual(body().split('### Before you deploy').length, 2);
});

test('criterion 7: with no before-deploy item, ship prints nothing and the section is absent (or removed)', posixOnly, (t) => {
  const { repo, env, body } = shipRepo(t, { todo: '- [x] (before: deploy) Run the backfill' });
  fs.writeFileSync(path.join(env.FAKE_GH_DIR, 'body.md'), `Written by a human.\n\n${buildDeployBlock([{ text: 'old', story: 's', id: 'abcdef0' }])}\n`);

  const res = run(repo, ['ship', '--no-evidence'], env);
  assert.strictEqual(res.code, 0, res.output);
  assert.doesNotMatch(res.output, /Before you deploy/);
  assert.strictEqual(body(), 'Written by a human.\n');
});

test('ship --dry-run lists the before-deploy items too', posixOnly, (t) => {
  const { repo, env } = shipRepo(t, { todo: '- [ ] (before: deploy) Run the backfill' });
  const res = run(repo, ['ship', '--dry-run'], env);
  assert.strictEqual(res.code, 0, res.output);
  assert.match(res.output, /Before you deploy \(1\):[\s\S]*Run the backfill/);
});

test('upsertDeployBlock keeps the human text, replaces its own section, and removes it when empty', () => {
  const block = buildDeployBlock([{ text: 'Run the backfill', story: 'story-01-01-x', id: 'abc1234' }]);
  assert.strictEqual(buildDeployBlock([]), null);

  const once = upsertDeployBlock('Human text.', block);
  assert.strictEqual(upsertDeployBlock(once, block), once);
  assert.match(once, /^Human text\.\n\n<!-- coding-flow:before-deploy:start -->/);
  assert.strictEqual(upsertDeployBlock(once, null), 'Human text.\n');
  assert.strictEqual(upsertDeployBlock('Human text.', null), 'Human text.');
  assert.strictEqual(upsertDeployBlock('', block), `${block}\n`);
});
