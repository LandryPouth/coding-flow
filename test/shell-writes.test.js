'use strict';

// The exact targets `shellWrites` reads from each shell form, not only the
// guard's verdict on them: a deny holds as long as ONE target matches, so a
// form that loses its second target (`cp a b keys` writing keys/b) still denies
// `.env` and hides the loss. These pin the reading itself, so a change to how
// the shell is read shows up here before it shows up as a hole.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { shellWrites, shellWriteTargets, isShellLimit } = require('../bin/lib/guard');

const EXPANSION = 'write target depends on shell expansion';
const UNKNOWN_CWD = 'the working directory depends on shell expansion';

const write = (target) => ({ target, kind: 'write' });
const alias = (target) => ({ target, kind: 'alias' });
const inline = (target) => ({ target, kind: 'inline' });
const unchecked = (target, reason, kind = 'write') => ({ target, kind, unchecked: reason });

// `keys/` is an existing directory, `a -> real/deep` a symlinked one.
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-shell-writes-')));
  fs.mkdirSync(path.join(dir, 'keys'));
  fs.mkdirSync(path.join(dir, 'real', 'deep'), { recursive: true });
  fs.symlinkSync('real/deep', path.join(dir, 'a'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function expectReads(t, cases) {
  const dir = fixture(t);
  for (const [command, expected] of cases) {
    const at = typeof expected === 'function' ? expected(dir) : expected;
    assert.deepStrictEqual(shellWrites(command, dir), at, command);
  }
}

test('nothing to read is nothing written', () => {
  assert.deepStrictEqual(shellWrites(''), []);
  assert.deepStrictEqual(shellWrites('   \n '), []);
  assert.deepStrictEqual(shellWrites(undefined), []);
  assert.deepStrictEqual(shellWrites(42), []);
});

test('redirections name their target, descriptor duplications and devices none', (t) => {
  expectReads(t, [
    ['echo a > .env', [write('.env')]],
    ['echo a>>.env 2>&1', [write('.env')]],
    ['echo a >| .env &> b &>> c', [write('.env'), write('b'), write('c')]],
    ['echo a >&out 2>&1 >&2', [write('out')]],
    ["echo 'x > .env' > \"q f\"", [write('q f')]],
    ['echo a > /dev/null > /dev/stderr', []],
    ['echo > "$OUT" > ~x > *.env', [unchecked('$OUT', EXPANSION), unchecked('~x', EXPANSION), unchecked('*.env', EXPANSION)]],
    ['echo "a" > $HOME/x > ${HOME}/y > ~/z', [write('$HOME/x'), write('${HOME}/y'), write('~/z')]],
    ['echo a \\\n> cont', [write('cont')]],
    ["cat <<'EOF' > out\necho a > .env\nEOF", [write('out')]],
    ['echo a > out & echo b > out2', [write('out'), write('out2')]],
    ['echo a > x; echo b > x', [write('x')]],
  ]);
});

test('tee and sponge write every file operand, quotes and escapes reduced', (t) => {
  expectReads(t, [
    ['tee -a a b < in', [write('a'), write('b')]],
    ['sponge out', [write('out')]],
    ['ls |& tee t', [write('t')]],
    ['tee .e""nv \'.en\'v .e\\nv', [write('.env')]],
  ]);
});

test('sed -i edits its file operands, never its script', (t) => {
  expectReads(t, [
    ['sed -i s/a/b/ f1 f2', [write('f1'), write('f2')]],
    ['sed -i -e s/a/b/ f1', [write('f1')]],
    ['sed -ie s/a/b/ f1', [write('f1')]],
    ['sed --in-place=.bak --expression s/a/b/ f1 f2', [write('f1'), write('f2')]],
    ['sed -i --expression=s/a/b/ f1', [write('f1')]],
    ['sed -i --line-length 5 s/a/b/ f1', [write('f1')]],
    ['sed -i --file script.sed -- f1 -f2', [write('f1')]],
    ['sed -i -l5 s/a/b/ f1', [write('f1')]],
    ['sed -n p f1', []],
  ]);
  assert.deepStrictEqual(shellWriteTargets('sed -i -es/a/b/ .env other'), ['.env', 'other']);
});

test('copy, move and link destinations, into a directory when it is one', (t) => {
  expectReads(t, [
    ['cp a b', [write('b')]],
    ['cp a keys', [write('keys'), write('keys/a')]],
    ['cp a keys/', [write('keys/'), write('keys/a')]],
    ['cp a b keys', [write('keys'), write('keys/a'), write('keys/b')]],
    ['cp -t keys a b', [write('keys'), write('keys/a'), write('keys/b')]],
    ['cp -rt keys a', [write('keys'), write('keys/a')]],
    ['cp --target-directory=keys a', [write('keys'), write('keys/a')]],
    ['cp -T a keys', [write('keys'), write('keys/a')]],
    ['mv a ./', [write('./'), write('a')]],
    ['install -Dt keys f', [write('keys'), write('keys/f')]],
    ['rsync -a src/ dst', [write('dst')]],
    ['cd keys && cp a b', [write('keys/b')]],
    // `-tkeys` spells an `s`: read as symbolic, so the source is also an alias.
    ['cp -tkeys a', (dir) => [write('keys'), write('keys/a'), alias('a'), alias('keys/a'), alias(path.join(dir, 'keys', 'a'))]],
    ['cp -s a b', (dir) => [write('b'), alias('a'), alias('b/a'), alias(path.join(dir, 'b', 'a'))]],
  ]);
});

test('a link aliases its source, read from the link\'s real directory', (t) => {
  expectReads(t, [
    ['ln a', [write('a'), alias('a')]],
    ['ln -sf /tmp/x/.env', [write('.env'), alias('/tmp/x/.env')]],
    ['ln -s ../.env a/x', (dir) => [
      write('a/x'), alias('../.env'), alias('a/.env'), alias(path.join(dir, 'real', 'deep', '.env')),
      alias('.env'), alias(path.join(dir, 'real', '.env')),
    ]],
    ['ln -s ../.env keys', (dir) => [write('keys'), write('keys/.env'), alias('../.env'), alias('.env'), alias(path.join(dir, '.env'))]],
    ['ln -sT ../.env keys', (dir) => [write('keys'), write('keys/.env'), alias('../.env'), alias('.env'), alias(path.join(dir, '.env'))]],
    ['ln -s ../x keys/', (dir) => [write('keys/'), write('keys/x'), alias('../x'), alias('x'), alias(path.join(dir, 'x'))]],
  ]);
});

test('in-place editors, truncation and downloads write their named files', (t) => {
  expectReads(t, [
    ["perl -pi -e 's/a/b/' f1 f2", [write('f1'), write('f2')]],
    ['perl -pi f1', [write('f1')]],
    ["awk -i inplace '{print}' f1 f2", [write('f1'), write('f2')]],
    ['ed f1', [write('f1')]],
    ['ex f1', [write('f1')]],
    ['patch f1 p.diff', [write('f1'), write('p.diff')]],
    ['truncate -s 0 f1 f2', [write('f1'), write('f2')]],
    ['truncate --reference ref f1', [write('f1')]],
    ['curl -o out http://x', [write('out')]],
    ['curl --output=out2 -so out3 http://x', [write('out2'), write('out3')]],
    ['wget -O w1 -o log --output-document=w2 http://x', [write('w1'), write('log'), write('w2')]],
    ['dd if=a of=b bs=1', [write('b')]],
  ]);
});

test('git overwrites the paths checkout and restore name', (t) => {
  expectReads(t, [
    ['git checkout -- f1 f2', [write('f1'), write('f2')]],
    ['git checkout main f1', [write('main'), write('f1')]],
    ['git -C sub checkout f1', [write('sub/f1')]],
    ['git -C $X checkout f1', [unchecked('f1', UNKNOWN_CWD)]],
    ['git -c a=b restore --source HEAD -- f1', [write('f1')]],
    ['git restore -s HEAD f1 f2', [write('f1'), write('f2')]],
    ['git restore --staged f1', []],
    ['git restore --staged --worktree f1', [write('f1')]],
    ['git restore --pathspec-from-file=list', [unchecked('(pathspec file)', 'git reads its paths from a file')]],
    ['git status', []],
  ]);
});

test('a script handed to a shell or eval is read as a command of its own', (t) => {
  expectReads(t, [
    ['eval "echo a > .env"', [write('.env')]],
    ['eval "\'echo a > x\'"', [write('x')]],
    ['bash -c "echo a > .env"', [write('.env')]],
    ["sh -ec 'cat > x'", [write('x')]],
    ['bash -c', []],
    ['cd $X && bash -c "echo > o; echo > /abs/p"', [unchecked('o', UNKNOWN_CWD), write('/abs/p')]],
    ['cd $X && bash -c "echo > \\"$Y\\""', [unchecked('$Y', EXPANSION)]],
  ]);
});

test('inline programs name the literals they hold', (t) => {
  expectReads(t, [
    ["python3 -c \"open('.env','w')\"", [inline('.env')]],
    ["python -Bc \"open('w')\"", []],
    ["node -e \"fs.writeFileSync('.env','x')\"", [inline('.env')]],
    ['node --eval=\'require("out")\'', [inline('out')]],
    // A bare open() mode is not a path.
    ["python -c \"open('x')\"", []],
    ["perl -e 'open(F, \">.env\")'", [inline('>.env'), inline('.env')]],
    ["ruby -e 'File.write(\".env\", 1)'", [inline('.env')]],
    ["deno eval --ext=ts \"Deno.writeTextFile('.env')\"", [inline('.env')]],
  ]);
});

test('a program the splitter only sees as data is unchecked, as a shell limit', (t) => {
  const program = (name, reason) => unchecked(`(${name} program)`, reason);
  expectReads(t, [
    ["node <<EOF\nfs.writeFileSync('.env')\nEOF", [program('node', 'an interpreter reads its program from a heredoc')]],
    ['curl x | bash', [program('bash', 'an interpreter reads its program from a pipe')]],
    ['curl x | bash -s -- --yes', [program('bash', 'an interpreter reads its program from a pipe')]],
    ['bash <(curl x)', [program('bash', 'an interpreter reads its program from a process substitution')]],
    ['bash', []],
  ]);
  for (const entry of shellWrites('curl x | bash; node <<EOF\nx\nEOF\n; bash <(curl x); echo > "$X"; cd $Y && echo > z; git restore --pathspec-from-file=l')) {
    assert.ok(isShellLimit(entry.unchecked), entry.unchecked);
  }
  assert.equal(isShellLimit('could not resolve a path (ELOOP)'), false);
});

test('cd, pushd, popd and subshells move where a relative write lands', (t) => {
  expectReads(t, [
    ['cd sub && echo a > b', [write('sub/b')]],
    ['cd sub || echo a > c; echo a > d', [write('c'), write('sub/d')]],
    ['cd $X && echo > e', [unchecked('e', UNKNOWN_CWD)]],
    ['cd $X && echo > /abs/f', [write('/abs/f')]],
    ['cd - ; echo > g', [unchecked('g', UNKNOWN_CWD)]],
    ['(cd sub && echo > i) ; echo > j', [write('sub/i'), write('j')]],
    ['cd sub | echo > k', [write('k')]],
    ['cd sub & echo > k2', [write('k2')]],
    ['pushd sub && echo > l', [write('sub/l')]],
    ['popd; echo > m', [unchecked('m', UNKNOWN_CWD)]],
    ['cd a && echo > ../n', [write('real/n')]],
    ['cd /abs && echo > o', (dir) => [write(path.relative(dir, '/abs/o'))]],
    ['cd $X && cd rel && echo > p', [unchecked('p', UNKNOWN_CWD)]],
    ['cd && echo > h', (dir) => [write(path.relative(dir, path.join(fs.realpathSync(os.homedir()), 'h')))]],
  ]);
});

test('a start directory that does not exist is read lexically', () => {
  assert.deepStrictEqual(shellWrites('cd sub && echo > b', '/nonexistent-coding-flow/x'), [write('sub/b')]);
});

test('wrappers and compound keywords step aside for the real verb', (t) => {
  expectReads(t, [
    ['sudo -u root tee f', [write('f')]],
    ['env FOO=1 tee g', [write('g')]],
    ['timeout -s 9 5 tee h', [write('h')]],
    ['nice -n 5 tee i', [write('i')]],
    ['if true; then tee j; fi', [write('j')]],
    ['/usr/bin/tee k', [write('k')]],
  ]);
});
