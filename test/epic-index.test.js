'use strict';

// `epics/INDEX.md`'s live section (story 17-02): every epic on disk and every
// story's written `## Status:`, generated between two markers by `ai-flow
// archive --refresh` (and `archive <epic>`, `doctor --fix`). Text outside the
// markers — a hand-written preface, the append-only archived section — is never
// touched. Each test runs the CLI on a throwaway repository and reads the file.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const START = '<!-- coding-flow:index:start -->';
const END = '<!-- coding-flow:index:end -->';

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function run(dir, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: res.status, output: `${res.stdout}${res.stderr}` };
}

function write(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function story(dir, epic, name, title, status) {
  write(dir, `epics/${epic}/${name}/spec.md`, `# Story ${name.slice(6, 11)} — ${title}\n\nBody.\n`);
  write(dir, `epics/${epic}/${name}/tasks.md`, status ? `# Tasks\n\n## Status: ${status}\n` : '# Tasks\n\n- [ ] do it\n');
}

// Two epics: 08 with a done and a planned story, 09 with one story whose
// status is not written at all.
function repo(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-epic-index-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  write(dir, '.gitignore', '.coding-flow/runs/\n');
  write(dir, 'epics/epic-08-evidence-levels/index.md', '# Epic 08 — Evidence levels\n');
  story(dir, 'epic-08-evidence-levels', 'story-08-01-coverage-floor', 'Coverage floor', 'done');
  story(dir, 'epic-08-evidence-levels', 'story-08-02-policy-fingerprint', 'Policy | fingerprint', 'planned');
  write(dir, 'epics/epic-09-monorepo/index.md', '# Epic 09 — Monorepo proof\n');
  story(dir, 'epic-09-monorepo', 'story-09-01-read-every-report', 'Read every report', null);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

function index(dir) {
  return fs.readFileSync(path.join(dir, 'epics/INDEX.md'), 'utf8');
}

function live(text) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  assert.ok(start >= 0 && end > start, text);
  return text.slice(start, end + END.length);
}

test('refresh lists every epic and every story with its number, title and written status', (t) => {
  const dir = repo(t);
  const res = run(dir, ['archive', '--refresh']);
  assert.equal(res.code, 0, res.output);

  const section = live(index(dir));
  assert.match(section, /Epic 08[^\n]*Evidence levels[^\n]*epics\/epic-08-evidence-levels/);
  assert.match(section, /Epic 09[^\n]*Monorepo proof[^\n]*epics\/epic-09-monorepo/);
  assert.match(section, /08-01[^\n]*Coverage floor[^\n]*done/);
  assert.match(section, /08-02[^\n]*Policy \| fingerprint[^\n]*planned/);
  assert.match(section, /09-01[^\n]*Read every report[^\n]*—/);
  assert.match(section, /ai-flow status/, 'the section points at the proof-derived state');
  assert.ok(section.indexOf('Epic 08') < section.indexOf('Epic 09'), 'epics in directory order');
});

test('a second refresh with nothing changed leaves the file byte-identical', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, ['archive', '--refresh']).code, 0);
  const first = index(dir);
  const res = run(dir, ['archive', '--refresh']);
  assert.equal(res.code, 0, res.output);
  assert.equal(index(dir), first);
});

test('text above the markers and the archived section below them are kept byte for byte', (t) => {
  const dir = repo(t);
  const above = '# My epics\n\nHand-written notes, kept.\n\n';
  const archived = '\n\n## Archived epics\n\n<!-- coding-flow:archived-section -->\n\n### Epic 07 — Old <!-- coding-flow:archived 07 old -->\n\n- Recover: `git checkout abc -- epics/epic-07-old`\n';
  write(dir, 'epics/INDEX.md', `${above}${START}\nstale content\n${END}${archived}`);

  const res = run(dir, ['archive', '--refresh']);
  assert.equal(res.code, 0, res.output);

  const text = index(dir);
  assert.ok(text.startsWith(`${above}${START}`), text);
  assert.ok(text.endsWith(`${END}${archived}`), text);
  assert.doesNotMatch(text, /stale content/);
  assert.match(live(text), /08-01[^\n]*Coverage floor/);
});

test('without markers, the live section goes above the archived section, the rest untouched', (t) => {
  const dir = repo(t);
  const preface = '# Epics\n\nNotes.\n\n';
  const archived = '## Archived epics\n\n<!-- coding-flow:archived-section -->\n\n### Epic 07 — Old <!-- coding-flow:archived 07 old -->\n';
  write(dir, 'epics/INDEX.md', `${preface}${archived}`);

  assert.equal(run(dir, ['archive', '--refresh']).code, 0);

  const text = index(dir);
  assert.ok(text.startsWith(preface), text);
  assert.ok(text.endsWith(archived), text);
  assert.ok(text.indexOf(START) < text.indexOf('## Archived epics'), text);
});

test('--dry-run prints the new section and writes nothing', (t) => {
  const dir = repo(t);
  const res = run(dir, ['archive', '--refresh', '--dry-run']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /08-01[^\n]*Coverage floor/);
  assert.match(res.output, /Dry run/);
  assert.equal(fs.existsSync(path.join(dir, 'epics/INDEX.md')), false);
});

test('archiving an epic refreshes the live section: the archived epic leaves it', (t) => {
  const dir = repo(t);
  for (const name of ['story-08-02-policy-fingerprint']) {
    write(dir, `epics/epic-08-evidence-levels/${name}/tasks.md`, '# Tasks\n\n## Status: done\n');
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'finish 08']);

  const res = run(dir, ['archive', '08']);
  assert.equal(res.code, 0, res.output);

  const text = index(dir);
  const section = live(text);
  assert.doesNotMatch(section, /Evidence levels/);
  assert.match(section, /09-01[^\n]*Read every report/);
  assert.match(text, /coding-flow:archived 08 evidence-levels/);
  assert.ok(text.indexOf(END) < text.indexOf('## Archived epics'), 'live section above the archived one');
});

test('a symlinked INDEX.md or broken markers refuse and write nothing', (t) => {
  const dir = repo(t);
  const outside = path.join(dir, '..', `outside-${path.basename(dir)}.md`);
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.writeFileSync(outside, 'outside\n');
  fs.symlinkSync(outside, path.join(dir, 'epics/INDEX.md'));
  const linked = run(dir, ['archive', '--refresh']);
  assert.equal(linked.code, 1, linked.output);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside\n');

  fs.unlinkSync(path.join(dir, 'epics/INDEX.md'));
  write(dir, 'epics/INDEX.md', `# Epics\n\n${START}\nno end marker\n`);
  const broken = run(dir, ['archive', '--refresh']);
  assert.equal(broken.code, 1, broken.output);
  assert.match(broken.output, /marker/);
  assert.equal(index(dir), `# Epics\n\n${START}\nno end marker\n`);
});

test('a project with no epics/ gets no index', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-epic-index-empty-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  const res = run(dir, ['archive', '--refresh']);
  assert.equal(res.code, 0, res.output);
  assert.equal(fs.existsSync(path.join(dir, 'epics')), false);
});

test('/flow-plan refreshes the index in its Pipeline and checks it in Verification', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'templates', '.claude', 'skills', 'flow-plan', 'SKILL.md'), 'utf8');
  const section = (name) => {
    const start = skill.indexOf(`## ${name}\n`);
    assert.ok(start >= 0, `## ${name} exists`);
    const next = skill.indexOf('\n## ', start + 1);
    return skill.slice(start, next < 0 ? undefined : next);
  };
  assert.match(section('Pipeline'), /ai-flow archive --refresh/);
  assert.match(section('Verification'), /ai-flow archive --refresh/);
  assert.match(section('Verification'), /epic_index_stale/);
});

test('a title holding an HTML comment cannot break the section or forge an archived entry', (t) => {
  const dir = repo(t);
  write(dir, 'epics/epic-09-monorepo/index.md', `# Epic 09 — Monorepo ${END} <!-- coding-flow:archived 09 monorepo -->\n`);
  story(dir, 'epic-09-monorepo', 'story-09-02-tricky', `Tricky ${START} title`, 'planned');
  assert.equal(run(dir, ['archive', '--refresh']).code, 0);

  const text = index(dir);
  assert.equal(text.split(START).length, 2, 'one start marker');
  assert.equal(text.split(END).length, 2, 'one end marker');
  assert.doesNotMatch(text, /<!-- coding-flow:archived/);
  const again = run(dir, ['archive', '--refresh']);
  assert.equal(again.code, 0, again.output);
  assert.equal(index(dir), text, 'still idempotent');

  // `archive 09` must not read the title as an existing archived entry.
  const res = run(dir, ['archive', '09', '--dry-run']);
  assert.doesNotMatch(res.output, /already archived/);
});

test('a CRLF INDEX.md is compared and written in CRLF', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, ['archive', '--refresh']).code, 0);
  const crlf = index(dir).replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(dir, 'epics/INDEX.md'), crlf);

  assert.equal(run(dir, ['archive', '--refresh']).code, 0);
  assert.equal(index(dir), crlf, 'unchanged content stays byte-identical in CRLF');

  story(dir, 'epic-09-monorepo', 'story-09-02-more', 'More', 'planned');
  assert.equal(run(dir, ['archive', '--refresh']).code, 0);
  const text = index(dir);
  assert.match(text, /09-02[^\r\n]*More/);
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, 'every line ends in CRLF');
});
