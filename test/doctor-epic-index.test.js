'use strict';

// `doctor` and `epics/INDEX.md` (story 17-02): the live section is generated
// from the epics on disk and their *written* statuses, so `doctor` can tell a
// current index from a stale one — `epic_index_stale` — and `doctor --fix`
// regenerates it. A proof going stale is not an index change: the file carries
// no proof-derived state.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-doctor-index-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init']).code, 0);
  return dir;
}

function writeStory(dir, epic, name, status) {
  const storyDir = path.join(dir, 'epics', epic, name);
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'story.md'), `# Story — ${name}\n\n## Status: ${status}\n`);
}

function staleWarning(dir) {
  const res = run(dir, ['doctor', '--json']);
  assert.equal(res.code, 0, res.output);
  return JSON.parse(res.output).warnings.find((w) => w.code === 'epic_index_stale');
}

test('epics with no index warn epic_index_stale, naming the fix', (t) => {
  const dir = project(t);
  writeStory(dir, 'epic-01-checkout', 'story-01-01-cart', 'done');

  const found = staleWarning(dir);
  assert.ok(found, 'expected an epic_index_stale warning');
  assert.match(found.message, /ai-flow archive --refresh|doctor --fix/);
});

test('a story added after the refresh warns; doctor --fix clears it', (t) => {
  const dir = project(t);
  writeStory(dir, 'epic-01-checkout', 'story-01-01-cart', 'done');
  assert.equal(run(dir, ['archive', '--refresh']).code, 0);
  assert.equal(staleWarning(dir), undefined, 'fresh index: no warning');

  writeStory(dir, 'epic-01-checkout', 'story-01-02-coupon', 'planned');
  assert.ok(staleWarning(dir), 'a new story makes the index stale');

  const fixed = run(dir, ['doctor', '--fix']);
  assert.equal(fixed.code, 0, fixed.output);
  assert.equal(staleWarning(dir), undefined, 'doctor --fix regenerated the live section');
  assert.match(fs.readFileSync(path.join(dir, 'epics/INDEX.md'), 'utf8'), /01-02[^\n]*planned/);
});

test('a proof going stale without a written-status change does not warn', (t) => {
  const dir = project(t);
  writeStory(dir, 'epic-01-checkout', 'story-01-01-cart', 'done');
  assert.equal(run(dir, ['archive', '--refresh']).code, 0);

  // A captured verify for the story, then the tree moves: the proof-derived
  // state changes (no proof → verified → stale), the written status does not.
  fs.mkdirSync(path.join(dir, '.coding-flow', 'runs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.coding-flow', 'runs', '2026-11-01T00-00-00-000Z-verify.json'),
    JSON.stringify({ ok: true, story: 'epics/epic-01-checkout/story-01-01-cart', generatedAt: '2026-11-01T00:00:00.000Z', results: [], provenance: { git: { treeToken: 'old' } } }),
  );
  fs.writeFileSync(path.join(dir, 'src.js'), 'changed\n');

  assert.equal(staleWarning(dir), undefined);
});

test('an epics/ with no epic in it gets no index and no warning', (t) => {
  const dir = project(t); // init lays down epics/.gitkeep only
  assert.equal(staleWarning(dir), undefined);
  assert.equal(fs.existsSync(path.join(dir, 'epics/INDEX.md')), false);
});
