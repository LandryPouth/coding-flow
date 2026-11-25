'use strict';

// Story 26-07 — We need you. `## Human to-do` items, `next`'s We need you
// block, `todo done`, the uncaptured-prose warning in verify and doctor, the
// secret masking, and what ship and land say out loud. Every test lays out
// epic files in a throwaway git repo and asserts on what the CLI prints, exits
// with, or leaves on disk.

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

function repo(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-human-todo-'));
  const dir = path.join(base, 'repo');
  fs.mkdirSync(path.join(dir, '.coding-flow'), { recursive: true });
  sh(dir, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(dir, 'git', ['config', 'user.email', 'test@example.com']);
  sh(dir, 'git', ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, '.coding-flow', 'config.json'), JSON.stringify({ storage: 'local' }));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return dir;
}

function write(dir, rel, body) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

const STORY = 'epics/epic-01-shop/story-01-01-backfill';

function story(dir, rel, { status = 'in-progress', todo = '', result = '', extra = '' } = {}) {
  write(
    dir,
    `${rel}/story.md`,
    `# Story — ${path.basename(rel)}\n\n## Status: ${status}\n\n## Acceptance Criteria\n\n- [x] it works\n${extra}` +
      (todo ? `\n## Human to-do\n\n${todo}\n` : '') +
      (result ? `\n## Result\n\n${result}\n` : ''),
  );
}

function needsYou(dir) {
  const res = run(dir, ['next', '--json']);
  assert.strictEqual(res.code, 0, res.output);
  return JSON.parse(res.output).needsYou;
}

test('criterion 1: a before-deploy item is printed above the recommendation, with its id', (t) => {
  const dir = repo(t);
  story(dir, STORY, { todo: '- [ ] (before: deploy) Run the backfill' });
  story(dir, 'epics/epic-01-shop/story-01-02-next', { status: 'planned' });

  const res = run(dir, ['next']);
  assert.strictEqual(res.code, 0, res.output);
  const [id] = needsYou(dir).map((entry) => entry.id);
  assert.match(id, /^[0-9a-f]{7}$/);
  const lines = res.output.split('\n');
  assert.strictEqual(lines[0], 'We need you (1)');
  assert.match(lines[1], new RegExp(`\\(before: deploy\\) Run the backfill — story-01-01-backfill \\[${id}\\]`));
  const recommendation = lines.findIndex((line) => line.includes('[planned]'));
  assert.ok(recommendation > 1, `the recommendation comes after the block:\n${res.output}`);
});

test('criterion 2: deploy first, then next-story items and the question, then one later line', (t) => {
  const dir = repo(t);
  story(dir, STORY, {
    todo: '- [ ] (before: later) Rotate the old key\n- [ ] (before: next-story) Create the test account\n- [ ] (before: deploy) Run the backfill',
  });
  story(dir, 'epics/epic-01-shop/story-01-02-ask', { extra: '\n## Needs you\n\nWhich provider: A or B?\n' });
  story(dir, 'epics/epic-01-shop/story-01-03-sign', { status: 'planned', extra: '\nOwner: human — signs the terms\n' });
  write(dir, 'epics/epic-01-shop/index.md', '# Epic 01\n\n## Maintainer to-do\n\n- [ ] archive the old bucket\n');

  const res = run(dir, ['next']);
  assert.strictEqual(res.code, 0, res.output);
  const block = res.output.split('\n\n')[0].split('\n');
  assert.deepStrictEqual(block.map((line) => line.replace(/ — (story-[\w-]+ \[[0-9a-f]{7}\]|ai-flow todo)$/, '')), [
    'We need you (6)',
    '  - (before: deploy) Run the backfill',
    '  - (before: next-story) Create the test account',
    '  - (needs you) Which provider: A or B?',
    '  - (yours to do) Story — story-01-03-sign',
    '  + 2 later',
  ]);
  assert.match(block[5], /\+ 2 later — ai-flow todo$/);
});

test('the block never prints more than 5 lines plus the count', (t) => {
  const dir = repo(t);
  const todo = Array.from({ length: 8 }, (_, i) => `- [ ] (before: deploy) Step ${i + 1}`).join('\n');
  story(dir, STORY, { todo: `${todo}\n- [ ] Someday` });
  story(dir, 'epics/epic-01-shop/story-01-02-next', { status: 'planned' });

  const res = run(dir, ['next']);
  const lines = res.output.split('\n');
  const items = lines.filter((line) => line.startsWith('  - '));
  assert.strictEqual(items.length, 5, res.output);
  assert.ok(lines.includes('  + 3 more, 1 later — ai-flow todo'), res.output);
  assert.match(res.output, /^We need you \(9\)$/m);
});

test('criterion 3: no ranked command and one open to-do prints "No command to run — but we need you:"', (t) => {
  const dir = repo(t);
  story(dir, STORY, { status: 'in-progress', todo: '- [ ] (before: next-story) Set STRIPE_KEY in the dev env' });

  const res = run(dir, ['next']);
  assert.strictEqual(res.code, 0, res.output);
  assert.match(res.output, /^No command to run — but we need you:\n {2}- \(before: next-story\) Set STRIPE_KEY in the dev env/);
  assert.doesNotMatch(res.output, /Nothing waiting on you/);
});

test('with nothing waiting and no command, next still says Nothing waiting on you', (t) => {
  const dir = repo(t);
  story(dir, STORY, { status: 'in-progress', todo: '- [x] (before: deploy) already done' });

  const res = run(dir, ['next']);
  assert.match(res.output, /Nothing waiting on you/);
  assert.doesNotMatch(res.output, /We need you/);
  assert.deepStrictEqual(needsYou(dir), []);
});

test('criterion 4: a landed epic whose index holds an open before-deploy item is still listed', (t) => {
  const dir = repo(t);
  story(dir, 'epics/epic-01-done/story-01-01-a', { status: 'done' });
  write(dir, 'epics/epic-01-done/index.md', '# Epic 01 — landed\n\n## Status: done\n\n## Human to-do\n\n- [ ] (before: deploy) Drop the old column after the deploy window\n');

  const entries = needsYou(dir);
  assert.deepStrictEqual(entries.map((entry) => [entry.when, entry.epic, entry.story, entry.text]), [
    ['deploy', 'epic-01-done', null, 'Drop the old column after the deploy window'],
  ]);
  assert.match(run(dir, ['next']).output, /Drop the old column/);
});

test('criterion 5: todo done ticks only that line, and neither next nor todo lists it again', (t) => {
  const dir = repo(t);
  story(dir, STORY, { todo: '- [ ] (before: deploy) Run the backfill\n- [ ] (before: later) Rotate the key' });
  const file = path.join(dir, STORY, 'story.md');
  const before = fs.readFileSync(file, 'utf8');
  const id = needsYou(dir).find((entry) => entry.text === 'Run the backfill').id;

  const res = run(dir, ['todo', 'done', id]);
  assert.strictEqual(res.code, 0, res.output);
  assert.match(res.output, /Ticked epics\/epic-01-shop\/story-01-01-backfill\/story\.md:\d+/);
  assert.match(res.output, /- \[x\] \(before: deploy\) Run the backfill/);

  const after = fs.readFileSync(file, 'utf8');
  assert.strictEqual(after, before.replace('- [ ] (before: deploy) Run the backfill', '- [x] (before: deploy) Run the backfill'));
  assert.deepStrictEqual(needsYou(dir).map((entry) => entry.text), ['Rotate the key']);
  assert.doesNotMatch(run(dir, ['todo']).output, /Run the backfill/);
});

test('todo done refuses an unknown id, a question, and an extra argument, and changes nothing', (t) => {
  const dir = repo(t);
  story(dir, STORY, { extra: '\n## Needs you\n\nWhich provider?\n' });
  const file = path.join(dir, STORY, 'story.md');
  const before = fs.readFileSync(file, 'utf8');

  const unknown = run(dir, ['todo', 'done', 'deadbee']);
  assert.strictEqual(unknown.code, 1);
  assert.match(unknown.output, /no open to-do has the id "deadbee"/);

  const question = needsYou(dir)[0];
  const refused = run(dir, ['todo', 'done', question.id]);
  assert.strictEqual(refused.code, 1);
  assert.match(refused.output, /is not a checkbox/);

  assert.strictEqual(run(dir, ['todo', 'done']).code, 1);
  assert.strictEqual(run(dir, ['todo', 'done', 'a', 'b']).code, 1);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('todo done keeps CRLF line endings and ticks a maintainer to-do in an index', (t) => {
  const dir = repo(t);
  write(dir, 'epics/epic-01-shop/index.md', '# Epic\r\n\r\n## Maintainer to-do\r\n\r\n- [ ] archive the bucket\r\n- [ ] keep me\r\n');
  const id = needsYou(dir).find((entry) => entry.text === 'archive the bucket').id;

  assert.strictEqual(run(dir, ['todo', 'done', id]).code, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(dir, 'epics/epic-01-shop/index.md'), 'utf8'),
    '# Epic\r\n\r\n## Maintainer to-do\r\n\r\n- [x] archive the bucket\r\n- [ ] keep me\r\n',
  );
});

test('criterion 9: next --json holds needsYou with id, when, epic, story, text, source', (t) => {
  const dir = repo(t);
  story(dir, STORY, { todo: '- [ ] (before: deploy) Run the backfill' });

  const [entry] = needsYou(dir);
  assert.deepStrictEqual(Object.keys(entry).filter((key) => key !== 'kind').sort(), ['epic', 'id', 'source', 'story', 'text', 'when']);
  assert.deepStrictEqual(
    { when: entry.when, epic: entry.epic, story: entry.story, text: entry.text, source: entry.source },
    { when: 'deploy', epic: 'epic-01-shop', story: 'story-01-01-backfill', text: 'Run the backfill', source: `${STORY}/story.md` },
  );
});

test('the same text under a story and the epic index is listed once, the story wins', (t) => {
  const dir = repo(t);
  story(dir, STORY, { todo: '- [ ] (before: deploy) Run the backfill' });
  write(dir, 'epics/epic-01-shop/index.md', '# Epic\n\n## Human to-do\n\n- [ ] (before: deploy)  run the   backfill\n');

  const entries = needsYou(dir);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].story, 'story-01-01-backfill');
});

test('a misspelled or missing when reads as later, and doctor warns with the three values', (t) => {
  const dir = repo(t);
  story(dir, STORY, { todo: '- [ ] (before: prod) Flip the flag\n- [ ] No deadline given' });

  assert.deepStrictEqual(needsYou(dir).map((entry) => [entry.when, entry.text]), [
    ['later', 'Flip the flag'],
    ['later', 'No deadline given'],
  ]);
  const doctor = run(dir, ['doctor', '--json']);
  const report = JSON.parse(doctor.output.slice(doctor.output.indexOf('{')));
  const when = report.warnings.filter((warning) => warning.code === 'todo_when');
  assert.strictEqual(when.length, 2, JSON.stringify(report.warnings));
  assert.match(when[0].message, /unknown "prod".*\(before: deploy\), \(before: next-story\), \(before: later\)/);
  assert.match(when[1].message, /is missing/);
});

test('criterion 8: a to-do holding a secret is a doctor error and is printed masked', (t) => {
  const dir = repo(t);
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  story(dir, STORY, { todo: `- [ ] (before: deploy) Set AWS_ACCESS_KEY_ID=${key} in production` });

  const doctor = run(dir, ['doctor', '--json']);
  const report = JSON.parse(doctor.output.slice(doctor.output.indexOf('{')));
  const errors = report.errors.filter((error) => error.code === 'todo_secret');
  assert.strictEqual(errors.length, 1, JSON.stringify(report.errors));
  assert.ok(!errors[0].message.includes(key), errors[0].message);
  assert.notStrictEqual(doctor.code, 0);

  for (const args of [['next'], ['next', '--json'], ['todo'], ['todo', '--json'], ['status']]) {
    const res = run(dir, args);
    assert.ok(!res.output.includes(key), `${args.join(' ')} printed the secret:\n${res.output}`);
  }
  assert.match(run(dir, ['todo']).output, /\[masked\]/);
});

test('criterion 6: a Result in French with no Human to-do passes verify with a todo.uncaptured warning; doctor too', (t) => {
  const dir = repo(t);
  write(dir, 'package.json', JSON.stringify({ name: 'x', scripts: { test: 'node -e "process.exit(0)"' } }));
  fs.writeFileSync(path.join(dir, '.coding-flow', 'config.json'), JSON.stringify({ storage: 'local', validation: { commands: ['node -e "process.exit(0)"'] } }));
  story(dir, STORY, { result: 'Done.\nLancer le script de backfill avant le déploiement, dans cet ordre.' });
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-qm', 'init']);

  const verify = run(dir, ['verify', '--story', STORY]);
  assert.strictEqual(verify.code, 0, verify.output);
  assert.match(verify.output, /Harness verify passed/);
  assert.match(verify.output, /Warning — todo\.uncaptured: 1 line\(s\)/);
  assert.match(verify.output, /story-01-01-backfill\/story\.md:\d+: Lancer le script de backfill avant le déploiement/);
  assert.match(verify.output, /- \[ \] \(before: deploy\|next-story\|later\)/);

  const doctor = run(dir, ['doctor', '--json']);
  const report = JSON.parse(doctor.output.slice(doctor.output.indexOf('{')));
  const uncaptured = report.warnings.filter((warning) => warning.code === 'todo_uncaptured');
  assert.strictEqual(uncaptured.length, 1, JSON.stringify(report.warnings));
  assert.match(uncaptured[0].message, /story\.md:\d+: .*avant le déploiement/);
});

test('an open Human to-do item silences the uncaptured warning, and todo.uncapturedPatterns replaces the phrases', (t) => {
  const dir = repo(t);
  story(dir, STORY, { result: 'Run the seed in production.', todo: '- [ ] (before: deploy) Run the seed' });
  story(dir, 'epics/epic-01-shop/story-01-02-b', { result: 'Ping the on-call team first.' });

  const warnings = () => {
    const doctor = run(dir, ['doctor', '--json']);
    return JSON.parse(doctor.output.slice(doctor.output.indexOf('{'))).warnings.filter((warning) => warning.code === 'todo_uncaptured');
  };
  assert.deepStrictEqual(warnings(), []);

  fs.writeFileSync(path.join(dir, '.coding-flow', 'config.json'), JSON.stringify({ storage: 'local', todo: { uncapturedPatterns: ['on-call team', '(unclosed'] } }));
  const found = warnings();
  assert.strictEqual(found.length, 1);
  assert.match(found[0].message, /story-01-02-b.*Ping the on-call team/);
});

test('a phrase in a fenced block of the Result is an example, not a to-do', (t) => {
  const dir = repo(t);
  story(dir, STORY, { result: '```\necho "before the deploy"\n```\n' });
  const doctor = run(dir, ['doctor', '--json']);
  const report = JSON.parse(doctor.output.slice(doctor.output.indexOf('{')));
  assert.deepStrictEqual(report.warnings.filter((warning) => warning.code === 'todo_uncaptured'), []);
});

test('status prints one header line with the count and the before-deploy count', (t) => {
  const dir = repo(t);
  story(dir, STORY, { todo: '- [ ] (before: deploy) Run the backfill\n- [ ] (before: later) Rotate the key' });
  assert.match(run(dir, ['status']).output, /^We need you: 2 \(1 before deploy\) — ai-flow next$/m);

  const clean = repo(t);
  story(clean, STORY, {});
  assert.doesNotMatch(run(clean, ['status']).output, /We need you/);
});

test('todo lists human to-dos with their when and id', (t) => {
  const dir = repo(t);
  story(dir, STORY, { status: 'done', todo: '- [ ] (before: deploy) Run the backfill' });
  const res = run(dir, ['todo']);
  assert.match(res.output, /- \[before: deploy\] Run the backfill \(story-01-01-backfill\) \[[0-9a-f]{7}\]/);
});

test('after a land, the landed story\'s open before-deploy items are printed; other stories\' are not', (t) => {
  const dir = repo(t);
  story(dir, STORY, { status: 'done', todo: '- [ ] (before: deploy) Run the backfill\n- [ ] (before: later) Rotate the key' });
  story(dir, 'epics/epic-01-shop/story-01-02-other', { todo: '- [ ] (before: deploy) Not this one' });

  const say = (storyPath) =>
    execFileSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(path.join(__dirname, '..', 'bin', 'lib', 'worktree.js'))}).sayDeployTodos(process.argv[1], { story: { path: process.argv[2] } })`, dir, storyPath],
      { cwd: dir, encoding: 'utf8' },
    );

  const out = say(STORY);
  assert.match(out, /^Before you deploy \(1\):\n {2}- \[ \] Run the backfill \(story-01-01-backfill\) \[[0-9a-f]{7}\]\n$/);
  assert.strictEqual(say(`./${STORY}/`), out, 'a ./ prefix or a trailing slash names the same story');
  assert.strictEqual(say('epics/epic-01-shop/story-01-09-none'), '');
});

// --- Review round 1 -------------------------------------------------------

// Key-shaped strings are built at run time: no literal key is ever written.
const stripeKey = () => 'sk_' + 'live_' + 'abcdefghijklmnop0123';
const awsKey = () => 'AKIA' + 'QRSTUVWXYZ234567';

function doctorWarnings(dir, code) {
  const doctor = run(dir, ['doctor', '--json']);
  return JSON.parse(doctor.output.slice(doctor.output.indexOf('{'))).warnings.filter((warning) => warning.code === code);
}

test('the uncaptured warning masks a secret of the Result line, in verify and in doctor', (t) => {
  const dir = repo(t);
  const key = stripeKey();
  fs.writeFileSync(path.join(dir, '.coding-flow', 'config.json'), JSON.stringify({ storage: 'local', validation: { commands: ['node -e "process.exit(0)"'] } }));
  story(dir, STORY, { result: `In production set STRIPE_KEY=${key} on the web service.` });
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-qm', 'init']);

  const verify = run(dir, ['verify', '--story', STORY]);
  assert.match(verify.output, /Warning — todo\.uncaptured: 1 line\(s\)/);
  assert.match(verify.output, /In production set STRIPE_KEY=\[masked\]/);
  assert.ok(!verify.output.includes(key), verify.output);

  const doctor = run(dir, ['doctor', '--json']);
  assert.ok(!doctor.output.includes(key), doctor.output);
  const found = doctorWarnings(dir, 'todo_uncaptured');
  assert.strictEqual(found.length, 1);
  assert.match(found[0].message, /\[masked\]/);
});

test('the options of a Needs you question are masked in todo and todo --json', (t) => {
  const dir = repo(t);
  const key = awsKey();
  story(dir, STORY, { extra: `\n## Needs you\n\n- Which access key?\n  - keep ${key}\n  - rotate it\n` });

  for (const args of [['todo'], ['todo', '--json'], ['next'], ['next', '--json']]) {
    const res = run(dir, args);
    assert.ok(!res.output.includes(key), `${args.join(' ')} printed the secret:\n${res.output}`);
  }
  assert.match(run(dir, ['todo']).output, /- keep \[masked\]/);
  assert.match(run(dir, ['todo']).output, /- rotate it/);
});

test('todo done refuses when the line changed between the read and the lock', (t) => {
  const dir = repo(t);
  story(dir, STORY, { todo: '- [ ] (before: deploy) Run the backfill' });
  const file = path.join(dir, STORY, 'story.md');
  const id = needsYou(dir)[0].id;
  const lib = path.join(__dirname, '..', 'bin', 'lib');
  // Another writer edits the line while `todo done` waits for the lock.
  const script = `
    const fs = require('fs');
    const store = require(${JSON.stringify(path.join(lib, 'placement-store.js'))});
    const real = store.withFileLock;
    store.withFileLock = (lock, fn, opts) => {
      const file = process.argv[2];
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Run the backfill', 'Drop the table'));
      return real(lock, fn, opts);
    };
    const todo = require(${JSON.stringify(path.join(lib, 'todo.js'))});
    try { todo.todoDone(process.cwd(), process.argv[1]); console.log('ticked'); } catch (e) { console.log('refused: ' + e.message); }
  `;
  const out = execFileSync(process.execPath, ['-e', script, id, file], { cwd: dir, encoding: 'utf8' });
  assert.match(out, /^refused: .*changed/m);
  assert.match(fs.readFileSync(file, 'utf8'), /- \[ \] \(before: deploy\) Drop the table/);
});

test('todo done --dry-run prints the line it would tick and writes nothing', (t) => {
  const dir = repo(t);
  story(dir, STORY, { todo: '- [ ] (before: deploy) Run the backfill' });
  const file = path.join(dir, STORY, 'story.md');
  const before = fs.readFileSync(file, 'utf8');
  const id = needsYou(dir)[0].id;

  const res = run(dir, ['todo', 'done', id, '--dry-run']);
  assert.strictEqual(res.code, 0, res.output);
  assert.match(res.output, /Would tick epics\/epic-01-shop\/story-01-01-backfill\/story\.md:\d+/);
  assert.match(res.output, /- \[x\] \(before: deploy\) Run the backfill/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  assert.strictEqual(needsYou(dir).length, 1);
});

test('verify with no --story warns for the story it resolved itself (a Spec Kit feature)', (t) => {
  const dir = repo(t);
  fs.writeFileSync(path.join(dir, '.coding-flow', 'config.json'), JSON.stringify({ storage: 'local', validation: { commands: ['node -e "process.exit(0)"'] } }));
  fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });
  write(dir, 'specs/001-backfill/spec.md', '# Feature\n\n## Result\n\nRun the backfill before the deploy.\n');
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-qm', 'init']);

  const verify = run(dir, ['verify']);
  assert.match(verify.output, /Harness verify passed/);
  assert.match(verify.output, /Warning — todo\.uncaptured: 1 line\(s\)/);
  assert.match(verify.output, /specs\/001-backfill\/spec\.md:\d+: Run the backfill before the deploy/);
});

test('autoland announces the before-deploy items of every story of the landed chain, an absolute path included', (t) => {
  const dir = repo(t);
  write(dir, 'epics/epic-01-shop/index.md', '# Epic\n\n## Stories\n\n1. [story-01-01-backfill](story-01-01-backfill/story.md)\n2. [story-01-02-seed](story-01-02-seed/story.md)\n');
  story(dir, STORY, { status: 'done', todo: '- [ ] (before: deploy) Run the backfill' });
  story(dir, 'epics/epic-01-shop/story-01-02-seed', { status: 'done', todo: '- [ ] (before: deploy) Seed the plans' });
  const lib = path.join(__dirname, '..', 'bin', 'lib');

  const paths = JSON.parse(
    execFileSync(
      process.execPath,
      ['-e', `console.log(JSON.stringify(require(${JSON.stringify(path.join(lib, 'worktree-plan.js'))}).chainStoryPaths(process.cwd(), process.argv[1], process.argv[2])))`, path.join(dir, 'epics/epic-01-shop'), path.join(dir, 'epics/epic-01-shop/story-01-02-seed')],
      { cwd: dir, encoding: 'utf8' },
    ),
  );
  assert.deepStrictEqual(paths, [STORY, 'epics/epic-01-shop/story-01-02-seed']);

  const out = execFileSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(path.join(lib, 'worktree.js'))}).sayDeployTodos(process.cwd(), { stories: process.argv.slice(1) })`, path.join(dir, STORY), 'epics/epic-01-shop/story-01-02-seed'],
    { cwd: dir, encoding: 'utf8' },
  );
  assert.match(out, /^Before you deploy \(2\):/);
  assert.match(out, /Run the backfill/);
  assert.match(out, /Seed the plans/);
});

test('a bare "in production" or "en prod" is not a to-do; an action in production is; Rollback sub-blocks are skipped', (t) => {
  const dir = repo(t);
  story(dir, STORY, { result: 'Logs are JSON, one line in production.\nLes logs JSON une ligne en production.\n\n### Rollback Notes\n\nRevert, then redeploy before the deploy window.\n' });
  story(dir, 'epics/epic-01-shop/story-01-02-b', { result: 'Run the seed in production once.' });
  story(dir, 'epics/epic-01-shop/story-01-03-c', { result: 'Script à lancer en prod après la fusion.' });

  const found = doctorWarnings(dir, 'todo_uncaptured').map((warning) => warning.message);
  assert.strictEqual(found.length, 2, found.join('\n'));
  assert.ok(found.some((message) => /story-01-02-b.*Run the seed in production/.test(message)), found.join('\n'));
  assert.ok(found.some((message) => /story-01-03-c.*à lancer en prod/.test(message)), found.join('\n'));
});
