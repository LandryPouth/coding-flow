'use strict';

// Tests of `ai-flow trace`: parses the traceability table, links story <-> commits
// <-> evidence <-> tests, and flags the missing links.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseTraceabilityTable } = require('../bin/lib/trace');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY_REL = 'epics/epic-01/story-01-01-demo';

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

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

function makeTestsMd({ mapped = true } = {}) {
  return [
    '# Tests',
    '',
    '## Acceptance Traceability',
    '',
    '| Acceptance criterion | Test proving it (`file::test`) |',
    '| --- | --- |',
    `| User can log in | ${mapped ? '`auth.test.ts::logs in`' : ''} |`,
    '',
    '## Commands',
    '',
    '```bash',
    'npm test',
    '```',
    '',
  ].join('\n');
}

function scaffoldStory(dir, { mapped = true } = {}) {
  const storyDir = path.join(dir, STORY_REL);
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Demo story\n');
  fs.writeFileSync(path.join(storyDir, 'plan.md'), makeTestsMd({ mapped }));
}

function writeVerifyRun(dir, { ok = true, story = STORY_REL, when = '2026-07-21T10:00:00.000Z' } = {}) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const evidence = {
    generatedAt: when,
    provenance: { git: { shortCommit: 'abc1234' } },
    story,
    commandSource: 'plan.md',
    commandsFound: 1,
    ok,
    results: [{ command: 'npm test', ok, exitCode: ok ? 0 : 1, timedOut: false, durationMs: 5 }],
  };
  fs.writeFileSync(path.join(runs, `${when.replace(/[:.]/g, '-')}-verify.json`), JSON.stringify(evidence));
}

test('parseTraceabilityTable extracts the criteria and their test', () => {
  const rows = parseTraceabilityTable(makeTestsMd({ mapped: true }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].criterion, 'User can log in');
  assert.equal(rows[0].test, 'auth.test.ts::logs in');
  assert.equal(rows[0].mapped, true);
});

test('parseTraceabilityTable marks a criterion without a test as unmapped', () => {
  const rows = parseTraceabilityTable(makeTestsMd({ mapped: false }));
  assert.equal(rows[0].mapped, false);
});

test('trace links a complete story with no gap', (t) => {
  const dir = tmp('trace-full');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Ada']);
  git(dir, ['config', 'user.email', 'ada@example.com']);
  scaffoldStory(dir, { mapped: true });
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'story-01-01: demo']);
  writeVerifyRun(dir, { ok: true });

  const res = run(dir, ['trace', '--story', STORY_REL, '--json']);
  assert.equal(res.code, 0, res.output);
  const { stories } = JSON.parse(res.output);
  assert.equal(stories.length, 1);
  const chain = stories[0];
  assert.equal(chain.criteria[0].mapped, true);
  assert.ok(chain.commits.length >= 1, 'a commit touches the story');
  assert.ok(chain.evidence && chain.evidence.ok, 'green verify evidence linked');
  assert.deepEqual(chain.gaps, [], 'no missing link');
});

test('trace flags the missing links (no evidence, unmapped criterion)', (t) => {
  const dir = tmp('trace-gaps');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Ada']);
  git(dir, ['config', 'user.email', 'ada@example.com']);
  scaffoldStory(dir, { mapped: false });
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'wip']);
  // No verify run written.

  const res = run(dir, ['trace', '--story', STORY_REL, '--json']);
  const chain = JSON.parse(res.output).stories[0];
  assert.ok(chain.gaps.some((g) => /without a mapped test/.test(g)), 'unmapped criterion flagged');
  assert.ok(chain.gaps.some((g) => /no verify evidence/.test(g)), 'missing evidence flagged');
});

test('trace without --story discovers the stories under epics/', (t) => {
  const dir = tmp('trace-discover');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Ada']);
  git(dir, ['config', 'user.email', 'ada@example.com']);
  scaffoldStory(dir, { mapped: true });
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'demo']);
  writeVerifyRun(dir, { ok: true });

  const res = run(dir, ['trace', '--json']);
  const { stories } = JSON.parse(res.output);
  assert.equal(stories.length, 1, 'the story is discovered automatically');
  assert.equal(stories[0].story, STORY_REL);
});
