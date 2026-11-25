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

// Review round 1, P1: only the project's tracked code and config hide a path —
// never a run record (every verify lists changed and deleted files) nor a notes file.
test('a stale path named only in a run record or a notes file is still reported', (t) => {
  const dir = repo(t, {
    'src/old.js': 'module.exports = 1;\n',
    'docs/guide.md': 'See `src/old.js`.\n',
  });
  git(dir, ['mv', 'src/old.js', 'src/new.js']);
  git(dir, ['commit', '-q', '-m', 'rename']);
  write(dir, {
    'CHANGES.txt': 'renamed src/old.js\n',
    'NEWS': 'src/old.js moved\n',
    '.coding-flow/runs/v-verify.json': '{"changedFiles":["src/old.js","src/new.js"]}\n',
    '.coding-flow/config.json': '{"note":"src/old.js"}\n',
  });
  git(dir, ['add', 'CHANGES.txt', 'NEWS', '.coding-flow/config.json']);
  git(dir, ['commit', '-q', '-m', 'notes']);
  write(dir, { 'src/draft.js': '// src/old.js\n' });
  assert.deepEqual(brief(check(dir).findings), ['docs/guide.md:1 path src/old.js -> src/new.js']);
});

// Review round 1, P2: where a script call runs.
test('a script call resolves against the package it runs in: cd, -w and --workspace', (t) => {
  const dir = repo(t, {
    'package.json': JSON.stringify({ name: 'root', scripts: { test: 'x' } }),
    'apps/web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'x' } }),
    'packages/ui/package.json': JSON.stringify({ name: '@x/ui', scripts: { build: 'x' } }),
    'docs/run.md': [
      '```bash',
      'cd apps/web && npm run dev',
      'npm run build',
      '```',
      '',
      '```bash',
      'cd apps/web',
      'npm run dev',
      '```',
      '',
      '```bash',
      'npm run dev',
      'npm run build --workspace=@x/ui',
      'npm run build -w packages/ui',
      'npm run lint -w @x/ui',
      'cd ../elsewhere && npm run anything',
      'npm run anything --workspaces',
      '```',
      '',
    ].join('\n'),
  });
  assert.deepEqual(brief(check(dir).findings), [
    'docs/run.md:3 script build',
    'docs/run.md:12 script dev',
    'docs/run.md:15 script @x/ui: lint',
  ]);
});

// Review round 1, P2: `path#anchor` and `path#L10` are the path; real names
// holding a placeholder word are judged; a trailing slash on a file is the file.
test('a path with #fragment is judged by its path; real names with placeholder words are judged', (t) => {
  const dir = repo(t, {
    'src/a.js': '\n',
    'lib/keep.ts': '\n',
    'epics/.keep': '',
    'docs/guide.md': [
      '`docs/gone.md#setup`, `src/gone.js#L10`, `src/a.js#L1`, `src/a.js/`,',
      '`src/x-name.js`, `lib/slug.ts`, `epics/epic-NN-name/spec.md`, `src/YYYY-MM-DD.log`.',
      '',
    ].join('\n'),
  });
  assert.deepEqual(brief(check(dir).findings), [
    'docs/guide.md:1 path docs/gone.md',
    'docs/guide.md:1 path src/gone.js',
    'docs/guide.md:2 path src/x-name.js',
    'docs/guide.md:2 path lib/slug.ts',
  ]);
});

// Review round 1, P2: a deleted file gets no look-alike, it gets its deletion.
test('a path deleted in history is reported as deleted, with no suggestion', (t) => {
  const dir = repo(t, {
    'src/dead.js': 'module.exports = 1;\n',
    'src/deal.js': 'module.exports = 2;\n',
    'docs/a.md': 'See `src/dead.js`.\n',
  });
  git(dir, ['rm', '-q', 'src/dead.js']);
  git(dir, ['commit', '-q', '-m', 'drop dead']);
  const sha = git(dir, ['rev-parse', '--short', 'HEAD']).trim();
  const result = check(dir);
  assert.deepEqual(brief(result.findings), ['docs/a.md:1 path src/dead.js']);
  assert.equal(result.findings[0].deleted, sha);
  assert.match(cli(dir, ['docs', 'check']).out, new RegExp(`deleted in ${sha}`));
});

// Review round 1, P2: 0 clean, 1 findings, 2 a usage or input error.
test('exit codes: 0 clean, 1 findings, 2 for a usage error or an unreadable base', (t) => {
  const dir = repo(t, { 'docs/a.md': 'Fine.\n' });
  assert.equal(cli(dir, ['docs', 'check']).code, 0);
  assert.equal(cli(dir, ['docs', 'check', '--jsn']).code, 2);
  assert.equal(cli(dir, ['docs']).code, 2);
  assert.equal(cli(dir, ['docs', 'check', '--changed']).code, 2);
  assert.equal(cli(dir, ['docs', 'check', '--changed', 'no-such-ref']).code, 2);
  assert.equal(cli(dir, ['docs', 'check', 'nowhere/']).code, 2);
  write(dir, { 'docs/a.md': '`docs/b.md`\n' });
  assert.equal(cli(dir, ['docs', 'check']).code, 1);
});

// Review round 1, P2: inside an indented code block, ``` is text, not a fence.
test('a fence marker inside an indented code block does not open a fence', (t) => {
  const dir = repo(t, {
    'src/.keep': '',
    'docs/a.md': 'Para.\n\n    ```\n    `src/in-code.js`\n\nThen `src/after.js`.\n',
  });
  assert.deepEqual(brief(check(dir).findings), ['docs/a.md:6 path src/after.js']);
});

// Review round 2, P1: what git recorded beats what a comment still says.
test('a path git recorded renamed or deleted is reported even when code still names it', (t) => {
  const dir = repo(t, {
    'src/old.ts': 'export const a = 1;\n',
    'src/dead.ts': 'export const b = 2;\n',
    'docs/a.md': 'See `src/old.ts` and `src/dead.ts`.\n',
  });
  git(dir, ['mv', 'src/old.ts', 'src/new.ts']);
  git(dir, ['rm', '-q', 'src/dead.ts']);
  write(dir, { 'src/other.ts': '// moved from src/old.ts; src/dead.ts is gone\nexport {};\n' });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'move']);
  const result = check(dir);
  assert.deepEqual(brief(result.findings), ['docs/a.md:1 path src/old.ts -> src/new.ts', 'docs/a.md:1 path src/dead.ts']);
  assert.ok(result.findings[1].deleted);
});

// Review round 2, P1: Next.js route folders are path segments, not globs.
test('route segments like [locale], (group) and [...slug] are judged; a partial bracket or a glob is not', (t) => {
  const dir = repo(t, {
    'apps/web/app/[locale]/page.tsx': '\n',
    'apps/web/app/[locale]/old/View.tsx': '\n',
    'apps/web/app/(group)/x/[id]/page.tsx': '\n',
    'apps/web/app/[...slug]/page.tsx': '\n',
    'apps/web/pages/[id].tsx': '\n',
    'docs/a.md': [
      '`apps/web/app/[locale]/page.tsx`, `apps/web/app/(group)/x/[id]/page.tsx`, `apps/web/app/[...slug]/page.tsx`,',
      '`apps/web/pages/[id].tsx`, `apps/web/app/[locale]/old/View.tsx`, `apps/web/app/(group)/x/[id]/gone.tsx`,',
      '`apps/web/pages/[slug].tsx`, `apps/web/src/[ab]*.js`.',
      '',
    ].join('\n'),
  });
  git(dir, ['rm', '-q', 'apps/web/app/[locale]/old/View.tsx']);
  git(dir, ['commit', '-q', '-m', 'drop view']);
  const result = check(dir);
  assert.deepEqual(brief(result.findings), [
    'docs/a.md:2 path apps/web/app/[locale]/old/View.tsx',
    'docs/a.md:2 path apps/web/app/(group)/x/[id]/gone.tsx',
  ]);
  assert.ok(result.findings[0].deleted);
});

// Review round 2, P2: a folder git recorded deleted or moved.
test('a deleted folder says deleted in <sha>; a moved folder suggests its new place', (t) => {
  const dir = repo(t, {
    'src/agency/a.ts': 'a\n',
    'src/agency/b.ts': 'b\n',
    'src/agency-console/agency/c.ts': 'c\n',
    'lib/old/x.ts': 'x\n',
    'docs/a.md': 'See `src/agency/` and `lib/old/`.\n',
  });
  git(dir, ['rm', '-q', '-r', 'src/agency']);
  git(dir, ['mv', 'lib/old', 'lib/fresh']);
  git(dir, ['commit', '-q', '-m', 'reshape']);
  const result = check(dir);
  assert.deepEqual(brief(result.findings), ['docs/a.md:1 path src/agency/', 'docs/a.md:1 path lib/old/ -> lib/fresh']);
  assert.ok(result.findings[0].deleted);
});

// Review round 2, P2: subshells, pushd/popd, comments.
test('a subshell cd ends at its parenthesis, pushd/popd stack, and a comment is not a command', (t) => {
  const dir = repo(t, {
    'package.json': JSON.stringify({ name: 'root', scripts: { test: 'x' } }),
    'apps/web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'x' } }),
    'docs/a.md': [
      '```bash',
      '(cd apps/web && npm run dev)',
      'npm run dev',
      'pushd apps/web',
      'npm run dev',
      'popd',
      'npm run dev',
      '# cd apps/web && npm run nothing',
      '```',
      '',
    ].join('\n'),
  });
  assert.deepEqual(brief(check(dir).findings), ['docs/a.md:3 script dev', 'docs/a.md:7 script dev']);
});

// Review round 2, P2: a filter naming no package of a workspace.
test('pnpm --filter naming no package of the workspace is reported', (t) => {
  const dir = repo(t, {
    'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
    'package.json': JSON.stringify({ name: 'root' }),
    'apps/api/package.json': JSON.stringify({ name: 'api', scripts: { seed: 'x' } }),
    'docs/a.md': '```bash\npnpm --filter apii run seed\npnpm --filter api run seed\n```\n',
  });
  assert.deepEqual(brief(check(dir).findings), ['docs/a.md:2 script apii: seed -> api']);
});

// Review round 3, P1: `cd apps/web/` (a tab-completed trailing slash) is apps/web.
test('a cd with a trailing slash runs the script in that package', (t) => {
  const dir = repo(t, {
    'package.json': JSON.stringify({ name: 'root', scripts: { test: 'x' } }),
    'apps/web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'x' } }),
    'docs/a.md': '```bash\ncd apps/web/ && npm run dev\n```\n\n```bash\ncd apps/web/ && npm run nothing\n```\n',
  });
  assert.deepEqual(brief(check(dir).findings), ['docs/a.md:6 script nothing']);
});

// Review round 3, P1: pnpm reads `--filter openapi-client` as `@scope/openapi-client`
// when one package has that name; two packages sharing it make the call unjudged.
test('pnpm --filter without the scope picks the one package with that name; two namesakes are not judged', (t) => {
  const dir = repo(t, {
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - other/*\n',
    'package.json': JSON.stringify({ name: 'root' }),
    'packages/client/package.json': JSON.stringify({ name: '@workspace/openapi-client', scripts: { generate: 'x' } }),
    'packages/ui/package.json': JSON.stringify({ name: '@a/ui', scripts: { build: 'x' } }),
    'other/ui/package.json': JSON.stringify({ name: '@b/ui', scripts: { build: 'x' } }),
    'docs/a.md': [
      '```bash',
      'pnpm --filter openapi-client run generate',
      'pnpm --filter openapi-client run nothing',
      'pnpm --filter ui run nothing',
      '```',
      '',
    ].join('\n'),
  });
  assert.deepEqual(brief(check(dir).findings), ['docs/a.md:3 script openapi-client: nothing']);
});

// Review round 3, P1: a top-level folder git recorded moved or deleted is judged
// even though its first segment no longer exists.
test('a top-level folder git recorded moved or deleted is judged', (t) => {
  const dir = repo(t, {
    'lib/a.js': 'a\n',
    'lib/b.js': 'b\n',
    'api/src/main.ts': 'm\n',
    'docs/a.md': 'See `lib/`, `lib/b.js` and `api/src/main.ts`; `web/x.ts` is another project.\n',
  });
  fs.mkdirSync(path.join(dir, 'src'));
  git(dir, ['mv', 'lib', 'src/core']);
  git(dir, ['rm', '-q', '-r', 'api']);
  git(dir, ['commit', '-q', '-m', 'move']);
  const result = check(dir);
  assert.deepEqual(brief(result.findings), [
    'docs/a.md:1 path lib/ -> src/core',
    'docs/a.md:1 path lib/b.js -> src/core/b.js',
    'docs/a.md:1 path api/src/main.ts',
  ]);
  assert.ok(result.findings[2].deleted);
});

// Review round 3, P2: a lowercase x/y/n after a dash is a placeholder; a leading one is a name.
test('a lowercase x, y or n word after a dash is a placeholder; a leading one is a name', (t) => {
  const dir = repo(t, {
    'src/a.js': '\n',
    'epics/README.md': '\n',
    'docs/a.md': 'See `epics/epic-x/story-x-02-b`, `epics/epic-n/story.md` and `src/x-name.js`.\n',
  });
  assert.deepEqual(brief(check(dir).findings), ['docs/a.md:1 path src/x-name.js']);
});

// Review round 3, P2: `cd my-app` after a scaffold is a folder this repo does not have.
test('scripts after a cd into a folder the repository does not have are not judged', (t) => {
  const dir = repo(t, {
    'package.json': JSON.stringify({ name: 'root', scripts: { test: 'x' } }),
    'docs/a.md': '```bash\nnpx create-next-app my-app\ncd my-app\nnpm run dev\n```\n\n```bash\nnpm run dev\n```\n',
  });
  assert.deepEqual(brief(check(dir).findings), ['docs/a.md:8 script dev']);
});

// Review round 3, P2: a folder name with one namesake far away is not a move.
test('a lone namesake folder in another context is not suggested; a lone namesake file is', (t) => {
  const dir = repo(t, {
    'apps/web/app/[locale]/admin/page.tsx': 'p\n',
    'src/lib/format.ts': 'f\n',
    'docs/a.md': 'See `apps/admin` and `src/utils/format.ts`.\n',
  });
  assert.deepEqual(brief(check(dir).findings), ['docs/a.md:1 path apps/admin', 'docs/a.md:1 path src/utils/format.ts -> src/lib/format.ts']);
});

// Review round 3, P2: outside git the walk is breadth-first, docs/ first, and says when it stopped.
test('outside git the walk reads docs/ before a big folder and says when it hit its limit', (t) => {
  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-docs-walk-')));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  write(plain, { 'src/a.js': '\n', 'docs/guide/a.md': 'See `src/other.js`.\n' });
  for (const name of ['aa', 'zz']) {
    const big = path.join(plain, name, 'deep');
    fs.mkdirSync(big, { recursive: true });
    for (let i = 0; i < 10001; i += 1) fs.writeFileSync(path.join(big, `f${i}.txt`), '');
  }
  const res = cli(plain, ['docs', 'check', '--json']);
  assert.equal(res.code, 1, res.out);
  assert.deepEqual(brief(JSON.parse(res.stdout).findings), ['docs/guide/a.md:1 path src/other.js']);
  assert.match(res.out, /20000 files/);
});
