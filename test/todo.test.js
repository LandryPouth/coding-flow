'use strict';

// `ai-flow todo`: one read-only list of everything waiting on a human, across
// all epics. Each test lays out epic files in a throwaway directory and asserts
// on what the command prints (plain and --json), never on its internals.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

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

function project(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-todo-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, '.coding-flow'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.coding-flow', 'config.json'), JSON.stringify({ storage: 'local' }));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return repo;
}

function write(repo, rel, body) {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function config(repo, value) {
  fs.writeFileSync(path.join(repo, '.coding-flow', 'config.json'), JSON.stringify({ storage: 'local', ...value }));
}

function todoJson(repo) {
  const res = run(repo, ['todo', '--json']);
  assert.strictEqual(res.code, 0, res.output);
  return JSON.parse(res.output);
}

function texts(payload) {
  return payload.epics.flatMap((epic) => epic.items.map((item) => `${epic.epic}|${item.kind}|${item.text}`));
}

test('two epics with maintainer to-dos and a Needs you story are all listed, grouped by epic', (t) => {
  const repo = project(t);
  write(repo, 'epics/epic-01-auth/index.md', '# Epic 01\n\n## Maintainer to-do\n\n- [ ] rotate the staging key\n- [x] already done\n');
  write(repo, 'epics/epic-02-billing/index.md', '# Epic 02\n\n## Maintainer cleanup on delivery\n\n- [ ] delete the old webhook\n');
  write(
    repo,
    'epics/epic-02-billing/story-02-01-refunds/story.md',
    '# Story 02-01 — Refunds\n\n## Needs you\n\n- Reset the dev database (destroys local data; restore with `npm run seed`).\n\n## Status: blocked\n',
  );

  const payload = todoJson(repo);
  assert.deepStrictEqual(payload.epics.map((e) => e.epic), ['epic-01-auth', 'epic-02-billing']);
  assert.deepStrictEqual(texts(payload), [
    'epic-01-auth|maintainer|rotate the staging key',
    'epic-02-billing|maintainer|delete the old webhook',
    'epic-02-billing|needs-you|Reset the dev database (destroys local data; restore with `npm run seed`).',
  ]);
  assert.strictEqual(payload.count, 3);

  const plain = run(repo, ['todo']);
  assert.strictEqual(plain.code, 0, plain.output);
  assert.match(plain.output, /epic-01-auth[\s\S]*rotate the staging key[\s\S]*epic-02-billing[\s\S]*delete the old webhook[\s\S]*Reset the dev database/);
  assert.match(plain.output, /story-02-01-refunds/, 'a story item names its story');
  assert.doesNotMatch(plain.output, /already done/);
});

test("a project's own heading set in todo.headings is listed too", (t) => {
  const repo = project(t);
  config(repo, { todo: { headings: ['À faire côté utilisateur'] } });
  write(repo, 'epics/epic-03-kyc/index.md', '# Epic 03\n\n## À faire côté utilisateur\n\n- [ ] créer le compte de test KYC\n\n## Maintainer to-do\n\n- [ ] not a configured heading any more\n');

  const payload = todoJson(repo);
  assert.deepStrictEqual(texts(payload), ['epic-03-kyc|maintainer|créer le compte de test KYC']);
});

test('without todo.headings the two default headings are read, at any heading level and case', (t) => {
  const repo = project(t);
  write(repo, 'epics/epic-01-a/index.md', '# Epic\n\n### maintainer TO-DO\n\n- [ ] nested level item\n  - [ ] an indented sub-item\n\n## Other\n\n- [ ] not a to-do heading\n');

  assert.deepStrictEqual(texts(todoJson(repo)), [
    'epic-01-a|maintainer|nested level item',
    'epic-01-a|maintainer|an indented sub-item',
  ]);
});

test('a malformed todo.headings falls back to the defaults', (t) => {
  const repo = project(t);
  config(repo, { todo: { headings: 'Maintainer to-do' } });
  write(repo, 'epics/epic-01-a/index.md', '## Maintainer to-do\n\n- [ ] still read\n');

  assert.deepStrictEqual(texts(todoJson(repo)), ['epic-01-a|maintainer|still read']);
});

test('deferred criteria and Owner: human stories that are not done are listed; done ones are not', (t) => {
  const repo = project(t);
  write(
    repo,
    'epics/epic-04-x/story-04-01-a/spec.md',
    '# Story 04-01 — A\n\nOwner: human\n\n## Acceptance Criteria\n\n- [x] shipped\n- [~] the WSL default is measured (deferred to 24-02)\n',
  );
  write(repo, 'epics/epic-04-x/story-04-01-a/tasks.md', '# Tasks\n\n## Status: planned\n');
  write(repo, 'epics/epic-04-x/story-04-02-b/story.md', '# Story 04-02 — B\n\nOwner: human\n\n## Status: done\n');
  write(repo, 'epics/epic-04-x/story-04-03-c/story.md', '# Story 04-03 — C\n\nOwner: agent\n\n## Status: planned\n');

  assert.deepStrictEqual(texts(todoJson(repo)), [
    'epic-04-x|human-owner|Story 04-01 — A',
    'epic-04-x|deferred|the WSL default is measured (deferred to 24-02)',
  ]);
});

test('an empty Needs you section and checked Needs you items are not listed', (t) => {
  const repo = project(t);
  write(repo, 'epics/epic-05-y/story-05-01-a/story.md', '# Story 05-01 — A\n\n## Needs you\n\n## Status: planned\n');
  write(repo, 'epics/epic-05-y/story-05-02-b/story.md', '# Story 05-02 — B\n\n## Needs you\n\n- [x] answered already\n- [ ] still open\n');

  assert.deepStrictEqual(texts(todoJson(repo)), ['epic-05-y|needs-you|still open']);
});

test('a Needs you section written as a paragraph is one item', (t) => {
  const repo = project(t);
  write(repo, 'epics/epic-06-z/story-06-01-a/story.md', '# Story 06-01 — A\n\n## Needs you\n\nWhich currency rounds\nhalf-up here?\n\n## Status: blocked\n');

  assert.deepStrictEqual(texts(todoJson(repo)), ['epic-06-z|needs-you|Which currency rounds half-up here?']);
});

test('epics are ordered oldest first by their number, not by name', (t) => {
  const repo = project(t);
  write(repo, 'epics/epic-10-late/index.md', '## Maintainer to-do\n\n- [ ] ten\n');
  write(repo, 'epics/epic-9-early/index.md', '## Maintainer to-do\n\n- [ ] nine\n');

  assert.deepStrictEqual(todoJson(repo).epics.map((e) => e.epic), ['epic-9-early', 'epic-10-late']);
});

test('nothing waiting prints a clear line and an empty --json list, and writes nothing', (t) => {
  const repo = project(t);
  write(repo, 'epics/epic-01-a/index.md', '# Epic\n');
  const before = fs.readdirSync(path.join(repo, '.coding-flow')).sort();

  const plain = run(repo, ['todo']);
  assert.strictEqual(plain.code, 0, plain.output);
  assert.match(plain.output, /Nothing is waiting on you/);
  assert.deepStrictEqual(todoJson(repo), { count: 0, epics: [] });
  assert.deepStrictEqual(fs.readdirSync(path.join(repo, '.coding-flow')).sort(), before);
});

test('a wrapped item is read whole, and headings or [~] lines inside code fences are examples', (t) => {
  const repo = project(t);
  write(
    repo,
    'epics/epic-07-w/index.md',
    '## Maintainer to-do\n\n- [ ] remove the proof gate from the workflow\n  once 29-01 ships; the workflow then\n  calls the scan\n- [ ] second item\n',
  );
  write(
    repo,
    'epics/epic-07-w/story-07-01-a/story.md',
    '# Story 07-01 — A\n\nAn example:\n\n```markdown\n## Needs you\n\n- an example question\n- [~] an example deferral\n```\n\n## Status: planned\n',
  );

  assert.deepStrictEqual(texts(todoJson(repo)), [
    'epic-07-w|maintainer|remove the proof gate from the workflow once 29-01 ships; the workflow then calls the scan',
    'epic-07-w|maintainer|second item',
  ]);
});

test('a code block inside a to-do section is an example, fenced or indented', (t) => {
  const repo = project(t);
  write(
    repo,
    'epics/epic-08-c/index.md',
    '## Maintainer to-do\n\n- [ ] real item\n\n```\n- [ ] fenced example\n```\n\nSome text:\n\n    - [ ] indented example\n\n~~~~\n- [ ] tilde example\n~~~~\n',
  );

  assert.deepStrictEqual(texts(todoJson(repo)), ['epic-08-c|maintainer|real item']);
});

test('a Needs you question followed by a fenced command lists the question, not the command', (t) => {
  const repo = project(t);
  write(
    repo,
    'epics/epic-09-d/story-09-01-a/story.md',
    '# Story 09-01 — A\n\n## Needs you\n\nRun this to reset the dev data (it destroys local rows):\n\n```bash\n- rm -rf data\n```\n\n## Status: blocked\n',
  );

  assert.deepStrictEqual(texts(todoJson(repo)), [
    'epic-09-d|needs-you|Run this to reset the dev data (it destroys local rows):',
  ]);
});

test('a Needs you section mixing prose and a list keeps both, in order', (t) => {
  const repo = project(t);
  write(
    repo,
    'epics/epic-09-d/story-09-02-b/story.md',
    '# Story 09-02 — B\n\n## Needs you\n\nWhich rounding rule applies?\n\n- half-up\n- [x] banker (ruled out)\n',
  );

  assert.deepStrictEqual(texts(todoJson(repo)), [
    'epic-09-d|needs-you|Which rounding rule applies?',
    'epic-09-d|needs-you|half-up',
  ]);
});

test('Owner: human counts only on its own line, outside code', (t) => {
  const repo = project(t);
  write(repo, 'epics/epic-10-e/story-10-01-a/story.md', '# Story 10-01 — A\n\nOwner: human-in-the-loop\n\n## Status: planned\n');
  write(repo, 'epics/epic-10-e/story-10-02-b/story.md', '# Story 10-02 — B\n\n```\nOwner: human\n```\n\n## Status: planned\n');
  write(repo, 'epics/epic-10-e/story-10-03-c/story.md', '# Story 10-03 — C\n\n- **Owner:** human\n\n## Status: planned\n');

  assert.deepStrictEqual(texts(todoJson(repo)), ['epic-10-e|human-owner|Story 10-03 — C']);
});

test('a [~] under Needs you is listed once, and [~] tasks in tasks.md are not criteria', (t) => {
  const repo = project(t);
  const dir = 'epics/epic-11-f/story-11-01-a';
  write(repo, `${dir}/spec.md`, '# Story 11-01 — A\n\n## Acceptance Criteria\n\n- [~] the real deferral\n\n## Needs you\n\n- [~] pick a provider\n');
  write(repo, `${dir}/tasks.md`, '# Tasks\n\n- [~] a task left for later\n\n## Status: planned\n');

  assert.deepStrictEqual(texts(todoJson(repo)), [
    'epic-11-f|needs-you|pick a provider',
    'epic-11-f|deferred|the real deferral',
  ]);
});

test('an empty checkbox [] is unchecked', (t) => {
  const repo = project(t);
  write(repo, 'epics/epic-12-g/index.md', '## Maintainer to-do\n\n- [] terse box\n');

  assert.deepStrictEqual(texts(todoJson(repo)), ['epic-12-g|maintainer|terse box']);
});

test('an unknown flag is refused', (t) => {
  const repo = project(t);
  const res = run(repo, ['todo', '--jsn']);
  assert.notStrictEqual(res.code, 0);
  assert.match(res.output, /unknown flag "--jsn"/);
});

// One table, one run: each case is its own epic, so every Markdown shape is
// read by the same scanner in a single CLI call.
const MAINTAINER_CASES = [
  ['fence at the margin', '- [ ] real\n```\n- [ ] example\n```\n', ['real']],
  ['fence at 2 spaces under an item', '- [ ] do this:\n  ```\n  - [ ] example\n  ```\n', ['do this:']],
  ['fence at 4 spaces under an item', '- [ ] do this:\n    ```\n    - [ ] example\n    ```\n', ['do this:']],
  ['fence at 6 spaces under a nested item', '- [ ] parent\n    - [ ] child:\n      ```\n      - [ ] example\n      ```\n', ['parent', 'child:']],
  ['tilde fence', '- [ ] real\n~~~\n- [ ] example\n~~~\n', ['real']],
  ['longer fence closed only by a run as long', '- [ ] real\n````\n```\n- [ ] example\n````\n- [ ] after\n', ['real', 'after']],
  ['unclosed fence runs to the end', '- [ ] before\n```\n- [ ] after\n', ['before']],
  ['indented code right after the heading', '    - [ ] code\n\n- [ ] real\n', ['real']],
  ['indented code after a paragraph closes the list', '- [ ] a\n\nSome text.\n\n    - [ ] code\n', ['a']],
  ['nested items at 4 spaces are listed', '- [ ] parent\n    - [ ] nested\n', ['parent', 'nested']],
  ['a nested item after a blank line stays in the list', '- [ ] parent\n\n    - [ ] nested later\n', ['parent', 'nested later']],
  ['empty and checked boxes', '- [] terse\n- [X] done\n- [x] done too\n', ['terse']],
];

test('table: what a to-do section lists, for every code and list shape', (t) => {
  const repo = project(t);
  MAINTAINER_CASES.forEach(([, body], index) => {
    write(repo, `epics/epic-${index + 1}-case/index.md`, `# Epic\n\n## Maintainer to-do\n\n${body}`);
  });
  // A heading closes the list: the indented block under the next heading is code.
  write(repo, 'epics/epic-99-heading/index.md', '## Maintainer to-do\n\n- [ ] a\n\n## Maintainer cleanup on delivery\n    - [ ] code\n');

  const payload = todoJson(repo);
  const byEpic = new Map(payload.epics.map((epic) => [epic.epic, epic.items.map((item) => item.text)]));
  MAINTAINER_CASES.forEach(([name, , expected], index) => {
    assert.deepStrictEqual(byEpic.get(`epic-${index + 1}-case`) || [], expected, name);
  });
  assert.deepStrictEqual(byEpic.get('epic-99-heading'), ['a'], 'a heading closes the list');
});

const STORY_CASES = [
  ['blockquote Owner: human', '> Owner: human\n', ['human-owner|S']],
  ['front matter owner, any case', null, ['human-owner|S'], '---\nOWNER: Human\ntitle: x\n---\n# S\n'],
  ['front matter owner agent', null, [], '---\nowner: agent\n---\n# S\n'],
  ['Owner line next to another line', 'Mode: STANDARD\nOwner: human\n', ['human-owner|S']],
  ['a verified story is finished', 'Owner: human\n\n## Status: verified\n', []],
  ['a stale story is finished', 'Owner: human\n\n## Status: stale\n', []],
  ['an in-review story is not', 'Owner: human\n\n## Status: in-review\n', ['human-owner|S']],
  ['Needs you sub-bullets are options', '## Needs you\n\n- Which provider?\n  - A: Stripe\n  - B: Adyen\n', ['needs-you|Which provider?|A: Stripe;B: Adyen']],
  ['Needs you with a fence under the item', '## Needs you\n\n- Run this:\n    ```\n    - rm -rf data\n    ```\n', ['needs-you|Run this:']],
  ['[~] under Tasks is bookkeeping', '## Acceptance Criteria\n\n- [~] the deferral\n\n## Tasks\n\n- [~] a task for later\n', ['deferred|the deferral']],
];

test('table: what a story lists, for owner, status, Needs you and criteria shapes', (t) => {
  const repo = project(t);
  STORY_CASES.forEach(([, body, , whole], index) => {
    write(repo, `epics/epic-${index + 1}-s/story-${index + 1}-01-s/story.md`, whole || `# S\n\n${body}`);
  });

  const payload = todoJson(repo);
  const byEpic = new Map(
    payload.epics.map((epic) => [
      epic.epic,
      epic.items.map((item) => [item.kind, item.text, ...(item.options && item.options.length ? [item.options.join(';')] : [])].join('|')),
    ]),
  );
  STORY_CASES.forEach(([name, , expected], index) => {
    assert.deepStrictEqual(byEpic.get(`epic-${index + 1}-s`) || [], expected, name);
  });

  const plain = run(repo, ['todo']);
  assert.match(plain.output, /Which provider\?.*\n\s+- A: Stripe\n\s+- B: Adyen/, 'options print under their question');
});

test('an extra argument is refused', (t) => {
  const repo = project(t);
  const res = run(repo, ['todo', 'done']);
  assert.notStrictEqual(res.code, 0);
  assert.match(res.output, /unexpected argument "done"/);
});
