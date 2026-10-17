'use strict';

// Every case from the 2026-10-16 guard measurement (docs/plans/hardening-roadmap.md,
// "Guard") and every limit 05-01/05-04 handed over, one row each with the decision
// it gets today, so a regression is one failing row with a readable name.
//
// A row with a fifth element is a documented limit: that element is the phrase in
// README.md#what-the-guard-does-not-see that owns it, and the last test fails when
// the README stops saying it — changing a limit means changing the docs.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluate } = require('../bin/lib/guard');

const KEY = `AKIA${'IOSFODNN7EXAMPLE'}`;
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

const write = (file_path, content = 'A=1') => ({ tool_name: 'Write', tool_input: { file_path, content } });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
const put = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const policy = (dir, config) => put(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify(config));

// setup(dir, ctx) runs in a fresh git repository with `.coding-flow/` and `sub/`, and
// returns the session's cwd (default: the repository). `ctx.home` points HOME at a
// throwaway directory for the row; `ctx.symlink` skips the row on Windows. hook is
// an object, or (dir) => object.
const ROWS = [
  // Direct and relative paths.
  ['Write .env', null, write('.env'), 'deny'],
  ['Write sub/../.env', null, write('sub/../.env'), 'deny'],
  ['Write ../.env from sub/', (dir) => path.join(dir, 'sub'), write('../.env'), 'deny'],

  // Links.
  ['Write through a symlink to .env', (dir, ctx) => ctx.symlink('.env', path.join(dir, 'alias')), write('alias'), 'deny'],
  ['Bash redirection through a symlink to .env', (dir, ctx) => ctx.symlink('.env', path.join(dir, 'alias')), bash('echo A=1 > alias'), 'deny'],
  ['ln -s .env then write the alias', null, bash('ln -s .env x && echo A=1 > x'), 'deny'],

  // The shell's own cwd.
  ['cd sub && echo > ../.env', null, bash('cd sub && echo A=1 > ../.env'), 'deny'],
  ['cd .. from sub/ then echo > .env', (dir) => path.join(dir, 'sub'), bash('cd .. && echo A=1 > .env'), 'deny'],
  ['subshell cd sub && echo > ../.env', null, bash('(cd sub && echo A=1 > ../.env)'), 'deny'],
  ['a subshell cd does not leak out', null, bash('(cd sub) && echo A=1 > sub/ok.txt'), 'allow'],

  // Outside the root.
  ['echo >> ~/.ssh/authorized_keys', (dir, ctx) => ctx.home(), bash('echo k >> ~/.ssh/authorized_keys'), 'deny'],
  ['a worktree writing the primary checkout .env by absolute path', worktree, (dir) => write(path.join(dir, '.env')), 'deny'],
  ['a worktree writing the primary checkout .env by ../', worktree, (dir) => write(`../${path.basename(dir)}/.env`), 'deny'],
  ['monorepo subdirectory writing ../../.env', (dir) => mkdir(dir, 'packages/app'), write('../../.env'), 'deny'],
  ['monorepo subdirectory writing the root .env by absolute path', (dir) => mkdir(dir, 'packages/app'), (dir) => write(path.join(dir, '.env')), 'deny'],

  // Git writing a file.
  ['git checkout <ref> -- .env', null, bash('git checkout stash@{0} -- .env'), 'deny'],
  ['git restore --source <ref> .env', null, bash('git restore --source=HEAD~1 .env'), 'deny'],

  // Interpreters.
  ['python -c naming .env', null, bash(`python3 -c "open('.env','w').write('A=1')"`), 'deny'],
  ['node -e building the name by concatenation', null, bash(`node -e "require('fs').writeFileSync('.e'+'nv','A=1')"`), 'allow', 'Computed paths'],
  ['bash script.sh', null, bash('bash script.sh'), 'allow', 'Scripts and compiled programs'],

  // What the guard cannot judge is unchecked, never allowed.
  ['a variable write target', null, bash('F=.env; echo A=1 > $F'), 'unchecked'],
  ['an unknown write tool carrying a path', null, { tool_name: 'FancyWrite', tool_input: { file_path: '.env', content: 'x' } }, 'unchecked'],
  ['unparseable input (no tool name)', null, { tool_name: 42 }, 'unchecked'],

  // The common shell write forms.
  ['tee .env', null, bash('echo A=1 | tee .env'), 'deny'],
  ['cp a .env', null, bash('cp a .env'), 'deny'],
  ['mv a .env', null, bash('mv a .env'), 'deny'],
  ['sed -i .env', null, bash('sed -i s/a/b/ .env'), 'deny'],
  ['dd of=.env', null, bash('dd if=a of=.env'), 'deny'],

  // Secrets.
  ['a secret in written content', null, write('src/a.js', `const k = "${KEY}";`), 'deny'],
  ['a secret in the command', null, bash(`echo ${KEY} > src/a.js`), 'deny'],

  // Handed over from 05-01.
  ['mkdir d && cp .env d (a directory made in the same command)', null, bash('mkdir d && cp .env d'), 'allow', 'A copy into a directory the same command creates'],
  [
    'Write .ENV (case-insensitive mounts on Linux)',
    null,
    write('.ENV'),
    CASE_INSENSITIVE ? 'deny' : 'allow',
    ...(CASE_INSENSITIVE ? [] : ['case-insensitive mounts on Linux']),
  ],
  [
    "nested pkg/.env from the outer project, under a root-anchored outer policy",
    (dir) => {
      policy(dir, { blockedPaths: ['/.env'] });
      mkdir(dir, 'pkg/.coding-flow');
    },
    write('pkg/.env'),
    'allow',
    'judged by the outer policy from outside it',
  ],
  [
    'the same .env from inside pkg/',
    (dir) => {
      policy(dir, { blockedPaths: ['/.env'] });
      return mkdir(dir, 'pkg/.coding-flow', '..');
    },
    write('.env'),
    'deny',
  ],
  [
    'a nested git repo without .coding-flow re-imposes a lifted .env refusal',
    (dir) => {
      policy(dir, { blockedPaths: ['*.pem'] });
      const nested = mkdir(dir, 'vendor/lib');
      git(nested, 'init', '-q');
      return nested;
    },
    write('.env'),
    'deny',
    'a nested git repo with no `.coding-flow/` gets the default policy',
  ],
  [
    'a $HOME that is a git repo makes ~/.coding-flow govern a project under it',
    (dir, ctx) => {
      const home = ctx.home();
      git(home, 'init', '-q');
      policy(home, { blockedPaths: ['**/*.txt'] });
      return mkdir(home, 'work/proj/.coding-flow', '..');
    },
    write('notes.txt', 'x'),
    'deny',
    'a `$HOME` that is a git repo makes `~/.coding-flow/` govern every project under it',
  ],

  // Handed over from 05-04.
  [
    'a strict .coding-flow between the outermost and the nearest is not read',
    (dir) => {
      policy(path.join(dir, 'a'), { mode: 'strict' });
      return mkdir(dir, 'a/b/.coding-flow', '..');
    },
    bash('F=.env; echo A=1 > $F'),
    'unchecked',
    'a `.coding-flow/` between the outermost and the nearest one (and its `mode`) is not read',
  ],
];

function mkdir(dir, rel, back = '.') {
  const full = path.join(dir, rel);
  fs.mkdirSync(full, { recursive: true });
  return path.resolve(full, back);
}

// A story worktree of the fixture repository, the way `worktree add` makes one: the
// session runs in the worktree, the primary checkout's .env sits next to it.
function worktree(dir) {
  put(path.join(dir, '.env'), 'X=1');
  put(path.join(dir, 'f'), 'x');
  git(dir, 'add', 'f');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const tree = `${dir}-wt`;
  git(dir, 'worktree', 'add', '-q', tree);
  fs.mkdirSync(path.join(tree, '.coding-flow'));
  return tree;
}

function scratch(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

for (const [name, setup, hook, expected] of ROWS) {
  test(`${name} → ${expected}`, (t) => {
    const dir = scratch(t, 'coding-flow-adversarial-');
    t.after(() => fs.rmSync(`${dir}-wt`, { recursive: true, force: true }));
    git(dir, 'init', '-q');
    fs.mkdirSync(path.join(dir, '.coding-flow'));
    fs.mkdirSync(path.join(dir, 'sub'));

    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    t.after(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    let skipped = false;
    const ctx = {
      symlink(target, at) {
        if (process.platform === 'win32') {
          skipped = true;
          return t.skip('symlinks need privileges on Windows');
        }
        fs.symlinkSync(target, at);
      },
      home() {
        const home = scratch(t, 'coding-flow-adversarial-home-');
        process.env.HOME = home;
        process.env.USERPROFILE = home;
        return home;
      },
    };

    const cwd = (setup && setup(dir, ctx)) || dir;
    if (skipped) return;
    const call = typeof hook === 'function' ? hook(dir) : hook;
    const result = evaluate({ ...call, cwd }, cwd);
    assert.equal(result.decision, expected, result.reason);
  });
}

test('every documented limit is still written in README.md#what-the-guard-does-not-see', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const start = readme.indexOf('### What the guard does not see');
  assert.notEqual(start, -1, 'README has no "What the guard does not see" section');
  const section = readme.slice(start, readme.indexOf('\n## ', start));

  assert.ok(section.split('\n').length <= 16, 'the section stays short (≤ 15 lines)');
  for (const [name, , , , limit] of ROWS) {
    if (limit) {
      assert.ok(section.includes(limit), `${name}: README no longer documents "${limit}"`);
    }
  }
  for (const point of ['Network downloads', 'TOCTOU', 'validation commands', 'mode: strict', 'container']) {
    assert.ok(section.includes(point), `README section misses "${point}"`);
  }
});
