'use strict';

// Story 26-03: `ai-flow docs check` reports, with their line, the backticked
// repository paths, the npm/pnpm script names and the relative links a doc
// names that no longer resolve — mechanically, so a reader can trust a clean
// result. Each test builds a throwaway repository and runs the real CLI.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-flow.js');

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// files: { relativePath: content }. Commits everything on `main`.
function repo(t, files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-docs-check-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function cli(cwd, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}`, stdout: res.stdout };
}

function check(cwd, args = []) {
  const res = cli(cwd, ['docs', 'check', '--json', ...args]);
  assert.ok(res.code === 0 || res.code === 1, res.out);
  return { ...JSON.parse(res.stdout), code: res.code };
}

const brief = (findings) => findings.map((f) => `${f.file}:${f.line} ${f.kind} ${f.target}${f.suggestion ? ` -> ${f.suggestion}` : ''}`);

// Criterion 1.
test('a backticked path renamed since is reported with its line and the new path as suggestion', (t) => {
  const dir = repo(t, {
    'src/old.js': 'module.exports = function parse(text) { return text.split("\\n"); };\n',
    'docs/guide.md': '# Guide\n\nThe entry point is `src/old.js`.\n\nOld notes: see `src/old.js` for the parser.\n',
  });
  git(dir, ['mv', 'src/old.js', 'src/new.js']);
  git(dir, ['commit', '-q', '-m', 'rename']);
  write(dir, { 'docs/guide.md': '# Guide\n\nThe entry point is `src/new.js`.\n\nOld notes: see `src/old.js` for the parser.\n' });

  const result = check(dir);
  assert.deepEqual(brief(result.findings), ['docs/guide.md:5 path src/old.js -> src/new.js']);
  assert.equal(result.code, 1);

  const plain = cli(dir, ['docs', 'check']);
  assert.equal(plain.code, 1);
  assert.match(plain.out, /docs\/guide\.md:5/);
  assert.match(plain.out, /src\/old\.js/);
  assert.match(plain.out, /src\/new\.js/);
});

// Criterion 2.
test('pnpm --filter <pkg> run <script> with no such script in that package is reported', (t) => {
  const dir = repo(t, {
    'package.json': JSON.stringify({ name: 'root', scripts: { seed: 'node seed.js' } }),
    'apps/api/package.json': JSON.stringify({ name: 'api', scripts: { start: 'node .', seeds: 'x' } }),
    'docs/setup.md': [
      '# Setup',
      '',
      '```bash',
      'pnpm --filter api run start',
      'pnpm --filter api run seed',
      'npm run seed',
      'pnpm --filter unknown-pkg run whatever',
      '```',
      '',
      'Or `npm run sead` from the root.',
      '',
    ].join('\n'),
  });

  const result = check(dir);
  assert.deepEqual(brief(result.findings), [
    'docs/setup.md:5 script api: seed -> seeds',
    'docs/setup.md:10 script sead -> seed',
  ]);
});

// Criterion 3.
test('a link to another doc with a missing anchor is reported; a good anchor and a missing file are told apart', (t) => {
  const dir = repo(t, {
    'docs/other.md': '# Other page\n\n## Set up the `harness` file\n\nText.\n\n## Set up the `harness` file\n',
    'docs/index.md': [
      '# Index',
      '',
      '- [ok](other.md#other-page)',
      '- [ok too](other.md#set-up-the-harness-file-1)',
      '- [broken](other.md#missing)',
      '- [gone](gone.md)',
      '- [self](#index)',
      '- [self broken](#nope)',
      '- [web](https://example.com/x#y) and [mail](mailto:a@b.c)',
      '',
    ].join('\n'),
  });

  const result = check(dir);
  assert.deepEqual(brief(result.findings).sort(), [
    'docs/index.md:5 anchor other.md#missing',
    'docs/index.md:6 link gone.md',
    'docs/index.md:8 anchor #nope',
  ].sort());
});

// Criterion 4.
test('placeholders, URLs, globs and paths of another project are never reported', (t) => {
  const dir = repo(t, {
    'src/a.js': '\n',
    'docs/guide.md': [
      '# Guide',
      '',
      'Write `<placeholder>/path`, `src/<name>.js`, `https://example.com/src/x.js`,',
      '`src/**/*.js`, `www.example.com/a/b`, `~/.config/x/y.json`, `$HOME/a/b`,',
      '`/etc/hosts/x`, `--flag=a/b`, `@scope/pkg`, `apps/web/page.tsx` (no apps/ here),',
      'and `src/a.js:12` or `src/a.js::a test` which exist.',
      '',
    ].join('\n'),
  });

  const result = check(dir);
  assert.deepEqual(result.findings, []);
  assert.equal(result.code, 0);
});

// Criterion 5.
test('--changed <base> checks only the docs that mention a file changed since the base', (t) => {
  const dir = repo(t, {
    'src/app.js': 'a\n',
    'lib/kept.js': 'k\n',
    'docs/mentions.md': '# M\n\nSee `src/app.js` and `src/missing.js`.\n',
    'docs/unrelated.md': '# U\n\nSee `lib/kept.js` and `lib/gone.js`.\n',
  });
  git(dir, ['branch', 'develop']);
  git(dir, ['checkout', '-q', '-b', 'story']);
  write(dir, { 'src/app.js': 'changed\n' });

  const all = check(dir);
  assert.deepEqual(brief(all.findings).sort(), [
    'docs/mentions.md:3 path src/missing.js',
    'docs/unrelated.md:3 path lib/gone.js',
  ]);

  const changed = check(dir, ['--changed', 'develop']);
  assert.deepEqual(brief(changed.findings), ['docs/mentions.md:3 path src/missing.js']);
  assert.equal(changed.docs, 1);

  const bad = cli(dir, ['docs', 'check', '--changed', 'no-such-base']);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /no-such-base/);
});

test('code blocks, comments and indented code are not read for paths; a list item indented 4 is', (t) => {
  const dir = repo(t, {
    'src/a.js': '\n',
    'docs/guide.md': [
      '# Guide',
      '',
      '```js',
      'require("`src/fence.js`")',
      '```',
      '',
      '- item',
      '    ```',
      '    `src/nested-fence.js`',
      '    ```',
      '',
      '<!-- `src/commented.js`',
      '`src/still-commented.js` -->',
      '',
      '    `src/indented-code.js`',
      '',
      '- item',
      '',
      '    continuation naming `src/in-list.js`',
      '',
      'Escape `<!--` in titles, then `src/after-inline-comment.js`.',
      '',
      '~~~~',
      '`src/tilde.js`',
      '~~~~',
      '',
    ].join('\n'),
  });

  const result = check(dir);
  assert.deepEqual(brief(result.findings), [
    'docs/guide.md:19 path src/in-list.js',
    'docs/guide.md:21 path src/after-inline-comment.js',
  ]);
});

test('a gitignored path and a path under docs.check.ignorePaths are skipped; include and exclude pick the docs', (t) => {
  const dir = repo(t, {
    '.gitignore': 'build/\n',
    'build/.keep-dir-name': '',
    'src/a.js': '\n',
    '.coding-flow/config.json': JSON.stringify({
      docs: { check: { include: ['docs/**/*.md', 'guides/*.md'], exclude: ['docs/archive/**'], ignorePaths: ['src/generated/**'] } },
    }),
    'docs/a.md': 'See `build/out.js`, `src/generated/x.js` and `src/real-missing.js`.\n',
    'docs/archive/old.md': 'See `src/archived-missing.js`.\n',
    'guides/g.md': 'See `src/guide-missing.js`.\n',
    'README.md': 'See `src/readme-missing.js`.\n',
  });

  const result = check(dir);
  assert.deepEqual(brief(result.findings).sort(), [
    'docs/a.md:1 path src/real-missing.js',
    'guides/g.md:1 path src/guide-missing.js',
  ]);
});

test('a missing path the project\'s own code names is one it writes: not reported', (t) => {
  const dir = repo(t, {
    'bin/report.js': 'fs.writeFileSync("reports/weekly.md", text);\n',
    'docs/a.md': 'The report lands in `reports/weekly.md`; the old one was `reports/daily.md`.\n',
    'reports/.keep': '',
  });
  assert.deepEqual(brief(check(dir).findings), ['docs/a.md:1 path reports/daily.md']);
});

test('by default docs/**, README.md and RULES.md are read; explicit paths narrow the check', (t) => {
  const dir = repo(t, {
    'src/a.js': '\n',
    'docs/a.md': 'See `src/one.js`.\n',
    'docs/deep/b.md': 'See `src/two.js`.\n',
    'README.md': 'See `src/three.js`.\n',
    'RULES.md': 'See `src/four.js`.\n',
    'notes/n.md': 'See `src/not-read.js`.\n',
  });

  assert.deepEqual(brief(check(dir).findings).sort(), [
    'README.md:1 path src/three.js',
    'RULES.md:1 path src/four.js',
    'docs/a.md:1 path src/one.js',
    'docs/deep/b.md:1 path src/two.js',
  ]);
  assert.deepEqual(brief(check(dir, ['notes/n.md', 'docs/deep']).findings).sort(), [
    'docs/deep/b.md:1 path src/two.js',
    'notes/n.md:1 path src/not-read.js',
  ]);
});

test('a path relative to the doc folder resolves; one relative to the root does too', (t) => {
  const dir = repo(t, {
    'src/a.js': '\n',
    'docs/sub/local.md': '\n',
    'docs/sub/page.md': 'See `./local.md`, `../sub/local.md`, `src/a.js` and `./absent.md`.\n',
  });

  assert.deepEqual(brief(check(dir).findings), ['docs/sub/page.md:1 path ./absent.md']);
});

test('an unknown flag and a missing subcommand are refused; outside git the check still runs', (t) => {
  const dir = repo(t, { 'docs/a.md': 'Fine.\n' });
  const unknown = cli(dir, ['docs', 'check', '--jsn']);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.out, /--jsn/);
  const bare = cli(dir, ['docs']);
  assert.notEqual(bare.code, 0);
  assert.match(bare.out, /docs check/);

  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-docs-nogit-')));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  write(plain, { 'src/a.js': '\n', 'docs/a.md': 'See `src/a.js` and `src/other.js`.\n' });
  assert.deepEqual(brief(check(plain).findings), ['docs/a.md:1 path src/other.js']);
});

test('doctor prints the finding count and the command, and does not fail on it', (t) => {
  const dir = repo(t, {
    'src/a.js': '\n',
    'docs/a.md': 'See `src/gone.js`.\n',
    '.coding-flow/config.json': JSON.stringify({ install: 'minimal' }),
    '.coding-flow/harness.json': '{}',
  });
  const res = cli(dir, ['doctor', '--json']);
  const report = JSON.parse(res.stdout);
  const line = report.warnings.find((w) => w.code === 'docs_stale');
  assert.ok(line, res.stdout);
  assert.ok(!report.errors.some((e) => e.code === 'docs_stale'));
  assert.match(line.message, /1 finding/);
  assert.match(line.message, /ai-flow docs check/);

  write(dir, { 'docs/a.md': 'See `src/a.js`.\n' });
  const clean = JSON.parse(cli(dir, ['doctor', '--json']).stdout);
  assert.ok(!clean.warnings.some((w) => w.code === 'docs_stale'));
});

test('a 10 KB adversarial line is read in linear time', (t) => {
  const dir = repo(t, { 'src/a.js': '\n' });
  const lines = [
    '`'.repeat(1) + ' `` '.repeat(2500),
    '[a]('.repeat(2500),
    '<!--'.repeat(2500),
    'npm run '.repeat(1300),
    '](' + '('.repeat(10000),
    '# ' + '`x` '.repeat(2500),
  ];
  write(dir, { 'docs/big.md': `${lines.join('\n')}\n` });
  const started = Date.now();
  const res = cli(dir, ['docs', 'check', '--json']);
  const elapsed = Date.now() - started;
  assert.ok(res.code === 0 || res.code === 1, res.out);
  assert.ok(elapsed < 5000, `took ${elapsed} ms`);
});
