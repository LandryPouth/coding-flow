'use strict';

// Story 34-02: `next` on a repository of ~200 stories took 3 min 28 s, nearly
// all of it git spawned again for every story to read facts of the checkout
// that cannot change during one run (its tree token above all). A `git` wrapper
// placed first on PATH counts every spawn: the count must not grow with the
// number of stories.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A `git` that appends one line per call to `counter`, then runs the real one.
function gitWrapper(base) {
  const realGit = sh(base, 'sh', ['-c', 'command -v git']).trim();
  const binDir = path.join(base, 'bin');
  const counter = path.join(base, 'git-calls');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, 'git'), `#!/bin/sh\necho x >> "${counter}"\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  return { binDir, counter };
}

// `count` stories over epics of ten: every other one marked done with a green
// verify (the path that read the tree token several times per story), the rest
// planned.
function generateRepo(base, count) {
  const repo = path.join(base, `repo-${count}`);
  fs.mkdirSync(repo);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  const runs = path.join(repo, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });

  for (let i = 0; i < count; i += 1) {
    const epic = `epic-${String(Math.floor(i / 10) + 1).padStart(2, '0')}-e`;
    const story = `story-${String(Math.floor(i / 10) + 1).padStart(2, '0')}-${String((i % 10) + 1).padStart(2, '0')}-s`;
    const dir = path.join(repo, 'epics', epic, story);
    fs.mkdirSync(dir, { recursive: true });
    const done = i % 2 === 0;
    fs.writeFileSync(path.join(dir, 'story.md'), `# ${story}\n\n${done ? '## Status: done\n' : 'nothing yet\n'}`);
    if (done) {
      fs.writeFileSync(
        path.join(runs, `${String(i).padStart(4, '0')}-verify.json`),
        JSON.stringify({ generatedAt: new Date().toISOString(), story: `epics/${epic}/${story}`, ok: true, commandsFound: 1, results: [] }),
      );
    }
  }

  sh(repo, 'git', ['add', '-A']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  return repo;
}

function gitSpawnsOfNext(base, wrapper, repo) {
  fs.writeFileSync(wrapper.counter, '');
  const output = execFileSync(process.execPath, [CLI, 'next', '--all', '--json'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${wrapper.binDir}${path.delimiter}${process.env.PATH}` },
  });
  const items = JSON.parse(output).items;
  const calls = fs.readFileSync(wrapper.counter, 'utf8').split('\n').filter(Boolean).length;
  return { calls, items };
}

test('next spawns as many git processes for 200 stories as for 20', { skip: process.platform === 'win32' }, (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-next-spawns-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const wrapper = gitWrapper(base);

  const small = gitSpawnsOfNext(base, wrapper, generateRepo(base, 20));
  const large = gitSpawnsOfNext(base, wrapper, generateRepo(base, 200));

  t.diagnostic(`git spawns: ${small.calls} for 20 stories, ${large.calls} for 200`);
  // The stories were all read: 10 vs 100 planned ones are ranked.
  assert.equal(small.items.filter((item) => item.tier === 7).length, 10);
  assert.equal(large.items.filter((item) => item.tier === 7).length, 100);
  assert.ok(small.calls > 0, 'the wrapper saw the git calls');
  assert.ok(
    large.calls <= small.calls + 5,
    `git spawns grew with the stories: ${small.calls} for 20, ${large.calls} for 200`,
  );
});
