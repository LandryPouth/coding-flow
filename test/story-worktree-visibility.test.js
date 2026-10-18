'use strict';

// A story whose work sits in its own worktree is judged there, from every entry
// point (DOGFOODING, 2026-10-16: `/flow-review` told the user a story was
// unimplemented while its work was in `../<repo>-worktrees/<story>`). Measured
// before the fix, from the primary checkout: `status` said `planned`, `next`
// said "nothing waiting on you", and `verify --story` went green on the primary
// checkout's copy and recorded that as the story's proof.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-01-x/story-01-01-a';

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function cli(cwd, args) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function commitAll(cwd, message) {
  sh(cwd, 'git', ['add', '-A']);
  sh(cwd, 'git', ['commit', '-m', message]);
}

function setup(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-wt-vis-')));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, STORY), { recursive: true });
  fs.mkdirSync(path.join(repo, '.coding-flow'));
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'epics', 'epic-01-x', 'index.md'), '# Epic\n\n## Stories\n\n1. **story-01-01-a**\n');
  fs.writeFileSync(path.join(repo, STORY, 'story.md'), '# Story A\n\n## Acceptance Criteria\n\n- [ ] it works\n\n## Result\n');
  fs.writeFileSync(path.join(repo, '.coding-flow', 'config.json'), JSON.stringify({ validation: { commands: ['node -e 0'] } }));
  commitAll(repo, 'init');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const added = cli(repo, ['worktree', 'add', '--story', STORY]);
  assert.equal(added.code, 0, added.output);
  return { repo, wt: path.join(base, 'repo-worktrees', 'story-01-01-a') };
}

function storyStatus(repo) {
  const { code, output } = cli(repo, ['status', '--json']);
  assert.equal(code, 0, output);
  const model = JSON.parse(output);
  const epics = model.epics || model;
  return epics.flatMap((epic) => epic.stories).find((s) => s.name === 'story-01-01-a');
}

function runFiles(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  return fs.existsSync(runs) ? fs.readdirSync(runs) : [];
}

test('status, run from the primary checkout, reads a story with committed work in its worktree as in progress', (t) => {
  const { repo, wt } = setup(t);
  fs.writeFileSync(path.join(wt, 'a.js'), 'module.exports = 1;\n');
  commitAll(wt, 'impl');

  const story = storyStatus(repo);
  assert.equal(story.status, 'in-progress');
  assert.equal(story.statusFrom, 'worktree');
  assert.match(story.worktree, /story-01-01-a/);
});

test("status reads the worktree's own story file and verify, not the primary checkout's copy", (t) => {
  const { repo, wt } = setup(t);
  fs.writeFileSync(path.join(wt, 'a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(wt, 'a.test.js'), "require('node:assert').equal(require('./a'), 1);\n");
  fs.writeFileSync(path.join(wt, STORY, 'story.md'), '# Story A\n\n## Acceptance Criteria\n\n- [x] it works\n\n## Result\n\nDone.\n');
  commitAll(wt, 'impl');
  const verified = cli(wt, ['verify', '--story', STORY]);
  assert.equal(verified.code, 0, verified.output);

  assert.equal(storyStatus(repo).status, 'verified');
});

test('a fresh worktree with nothing in it yet keeps the story planned', (t) => {
  const { repo } = setup(t);
  const story = storyStatus(repo);
  assert.equal(story.status, 'planned');
  assert.equal(story.statusFrom, undefined);
});

test('verify --story from the primary checkout refuses while the work is in the worktree, and records nothing', (t) => {
  const { repo, wt } = setup(t);
  fs.writeFileSync(path.join(wt, 'a.js'), 'module.exports = 1;\n');
  commitAll(wt, 'impl');

  for (const args of [['verify', '--story', STORY], ['harness', 'verify', '--story', STORY]]) {
    const { code, output } = cli(repo, args);
    assert.notEqual(code, 0, `${args.join(' ')} must refuse`);
    assert.match(output, /is in its worktree/);
    assert.match(output, /1 commit\(s\) not in this checkout/);
    assert.match(output, /cd \.\.\/repo-worktrees\/story-01-01-a && ai-flow verify --story/);
  }
  assert.deepStrictEqual(runFiles(repo), [], 'no proof of the wrong tree may be recorded');
});

test('verify --story refuses for uncommitted work in the worktree too', (t) => {
  const { repo, wt } = setup(t);
  fs.writeFileSync(path.join(wt, 'a.js'), 'module.exports = 1;\n');
  const { code, output } = cli(repo, ['verify', '--story', STORY]);
  assert.notEqual(code, 0);
  assert.match(output, /uncommitted change/);
});

test('verify --story runs normally from the worktree itself, and from the primary when the worktree is empty', (t) => {
  const { repo, wt } = setup(t);
  assert.equal(cli(repo, ['verify', '--story', STORY]).code, 0, 'nothing in the worktree yet: nothing to point at');

  fs.writeFileSync(path.join(wt, 'a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(wt, 'a.test.js'), "require('node:assert').equal(require('./a'), 1);\n");
  commitAll(wt, 'impl');
  const inside = cli(wt, ['verify', '--story', STORY]);
  assert.equal(inside.code, 0, inside.output);
});

test('next, from the primary checkout, reads the proof in the worktree and points its command there', (t) => {
  const { repo, wt } = setup(t);
  fs.writeFileSync(path.join(wt, 'a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(wt, STORY, 'story.md'), '# Story A\n\n## Status: done\n\n## Result\n');
  commitAll(wt, 'impl, marked done without a verify');

  const { code, output } = cli(repo, ['next']);
  assert.equal(code, 0, output);
  assert.match(output, /no captured verify/);
  assert.match(output, /cd \.\.\/repo-worktrees\/story-01-01-a && ai-flow verify --story/);
});
