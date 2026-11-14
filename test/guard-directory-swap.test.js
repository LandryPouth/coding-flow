'use strict';

// A blocked glob `X/**` names everything under X — and X itself (story 13-09).
// Swapping the whole directory (`mv X /tmp/x`, edit, `mv /tmp/x <parent>/`) or
// extracting an archive or a patch into it rewrites the proof as surely as a
// redirect into one of its files does.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { decide } = require('../bin/lib/guard');
const { checkSensitivePaths } = require('../bin/lib/security-policy');
const { EVIDENCE_BLOCKED_PATHS } = require('../bin/lib/harness-config');

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.coding-flow', 'runs'), { recursive: true });
  return dir;
}

function guard(cwd, command) {
  try {
    execFileSync(process.execPath, [CLI, 'guard'], {
      cwd,
      input: JSON.stringify({ cwd, tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 20000,
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

const bash = (dir, command) => decide({ tool_name: 'Bash', cwd: dir, tool_input: { command } }, dir);

test('swapping the evidence directory back in is refused, end to end', (t) => {
  const dir = tmp(t);
  assert.equal(guard(dir, 'mv .coding-flow/runs /tmp/runs && sed -i s/failed/passed/ /tmp/runs/*.json && mv /tmp/runs .coding-flow/'), 2);
  assert.equal(guard(dir, 'cp -R /tmp/runs .coding-flow/'), 2);
  assert.equal(guard(dir, 'cp -r /tmp/r2/ .coding-flow/runs'), 2);
});

test('a write whose destination is a blocked directory itself is refused, and names it', (t) => {
  const dir = tmp(t);
  for (const command of ['mv /tmp/runs .coding-flow/', 'cp /tmp/x node_modules', 'rsync -a /tmp/r/ .coding-flow/runs', 'cp -a /tmp/k .ssh']) {
    const result = bash(dir, command);
    assert.equal(result.decision, 'deny', command);
  }
  assert.match(bash(dir, 'cp -r /tmp/r2/ .coding-flow/runs').reason, /\.coding-flow\/runs\b.*\.coding-flow\/runs\/\*\*/);
});

test('moving a blocked directory out is refused; moving one file out is a deletion and stays allowed', (t) => {
  const dir = tmp(t);
  assert.equal(bash(dir, 'mv .coding-flow/runs /tmp/runs').decision, 'deny');
  assert.equal(bash(dir, 'mv .coding-flow /tmp/cf').decision, 'deny');
  assert.equal(bash(dir, 'mv node_modules node_modules.old').decision, 'deny');
  assert.equal(bash(dir, 'mv .coding-flow/runs/a-verify.json /tmp/a.json').decision, 'allow');
});

test('an archive extracted into a blocked directory is refused; elsewhere in the project it is unchecked', (t) => {
  const dir = tmp(t);
  for (const command of ['tar -xf a.tar -C .coding-flow/runs', 'tar --directory=.coding-flow/runs -xzf a.tgz', 'tar xf a.tar --directory .coding-flow/runs', 'unzip a.zip -d .coding-flow/runs', 'unzip -o a.zip -d node_modules']) {
    assert.equal(bash(dir, command).decision, 'deny', command);
  }
  // `.coding-flow` holds `.coding-flow/runs`: extracting there is refused (review of 13-09).
  for (const command of ['tar -xf a.tar', 'cd src && tar -xzf ../a.tgz']) {
    const result = bash(dir, command);
    assert.equal(result.decision, 'unchecked', command);
    assert.match(result.reason, /archive/, command);
  }
});

test('reading or making an archive, or extracting outside the project, is not a write here', (t) => {
  const dir = tmp(t);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-out-')));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  for (const command of ['tar -cf /tmp/a.tar .', 'tar -tf a.tar', `tar -xf a.tar -C ${outside}`, 'unzip -l a.zip', `unzip a.zip -d ${outside}`, 'unzip -p a.zip x > /dev/null']) {
    assert.equal(bash(dir, command).decision, 'allow', command);
  }
});

test('git apply judges the paths its patch names; an unreadable patch or a stash is unchecked', (t) => {
  const dir = tmp(t);
  const patch = (name, file) => fs.writeFileSync(path.join(dir, name), `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-a\n+b\n`);
  patch('forge.diff', '.coding-flow/runs/a-verify.json');
  patch('ok.diff', 'src/a.js');
  fs.writeFileSync(path.join(dir, 'rename.diff'), 'diff --git a/x.json b/.coding-flow/runs/x.json\nsimilarity index 100%\nrename from x.json\nrename to .coding-flow/runs/x.json\n');

  assert.equal(bash(dir, 'git apply forge.diff').decision, 'deny');
  assert.equal(bash(dir, 'git apply --index -p1 forge.diff').decision, 'deny');
  assert.equal(bash(dir, 'git apply rename.diff').decision, 'deny');
  assert.equal(bash(dir, 'git apply ok.diff').decision, 'allow');
  assert.equal(bash(dir, 'git apply --check forge.diff').decision, 'allow');
  assert.equal(bash(dir, 'git apply --stat forge.diff').decision, 'allow');
  // `< forge.diff` is read like a named patch (review of 13-09).
  assert.equal(bash(dir, 'git apply < forge.diff').decision, 'deny');
  for (const command of ['git apply missing.diff', 'git stash pop', 'git stash apply stash@{1}']) {
    assert.equal(bash(dir, command).decision, 'unchecked', command);
  }
  for (const command of ['git stash', 'git stash list', 'git stash show -p']) {
    assert.equal(bash(dir, command).decision, 'allow', command);
  }
});

test('ordinary copies and moves between unblocked paths stay allowed', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'src'));
  for (const command of ['cp a b', 'mv a b', 'cp -r src dst', 'mv src lib', 'cp x .coding-flow/', 'rsync -a src/ build/', 'cp -R /tmp/runs ./runs-copy']) {
    assert.equal(bash(dir, command).decision, 'allow', command);
  }
});

test('the commit check exempts evidence by the same match the doctor uses', () => {
  const files = ['.coding-flow/runs/x-verify.json', '.coding-flow/ledger.jsonl', '.coding-flow/runs/nested/y.json', '.env'].map((f) => path.join(process.cwd(), f));
  for (const blockedPaths of [['.coding-flow/**', '.env'], ['.coding-flow/runs/*', '.coding-flow/ledger.jsonl', '.env'], [...EVIDENCE_BLOCKED_PATHS, '.env']]) {
    const report = { errors: [], warnings: [] };
    checkSensitivePaths(files, { blockedPaths, sensitiveGlobs: [] }, report);
    assert.deepEqual(report.errors.map((e) => e.file), ['.env'], JSON.stringify(blockedPaths));
  }
});

test('verify still writes its run file with the default blocked paths', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-verify-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  fs.writeFileSync(path.join(dir, '.coding-flow', 'config.json'), JSON.stringify({ validation: { commands: ['node -e "process.exit(0)"'] } }));
  fs.writeFileSync(path.join(dir, 'README.md'), '# app\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);

  execFileSync(process.execPath, [CLI, 'verify'], { cwd: dir, stdio: 'ignore' });

  const runs = fs.readdirSync(path.join(dir, '.coding-flow', 'runs')).filter((f) => f.endsWith('-verify.json'));
  assert.equal(runs.length, 1);
  const { blockedPaths } = require('../bin/lib/harness-config').readHarnessConfig(dir).config;
  for (const entry of EVIDENCE_BLOCKED_PATHS) assert.ok(blockedPaths.includes(entry), entry);
});

// --- review of 13-09: the spellings the reviewer forged proof with ---------------
// The guard reads heuristically: it refuses when it knows a target touches a blocked
// path, and logs `unchecked` when it cannot read the target — never a silent allow
// for a write form it does not model.

function repo(t) {
  const dir = tmp(t);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'src'));
  const patch = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const created = (header) => `${header}\nnew file mode 100644\n--- /dev/null\n`;
  patch('p_plain.patch', `${created('diff --git a/.coding-flow/runs/x.json b/.coding-flow/runs/x.json')}+++ b/.coding-flow/runs/x.json\n@@ -0,0 +1 @@\n+forged\n`);
  patch('p_quoted.patch', `${created('diff --git "a/.coding-flow/runs/q.json" "b/.coding-flow/runs/q.json"')}+++ "b/.coding-flow/runs/q.json"\n@@ -0,0 +1 @@\n+forged\n`);
  patch('p_dir.patch', `${created('diff --git a/runs/d.json b/runs/d.json')}+++ b/runs/d.json\n@@ -0,0 +1 @@\n+forged\n`);
  patch('p_p2.patch', `${created('diff --git a/z/.coding-flow/runs/p2.json b/z/.coding-flow/runs/p2.json')}+++ b/z/.coding-flow/runs/p2.json\n@@ -0,0 +1 @@\n+forged\n`);
  patch('p_noprefix.patch', '--- /dev/null\n+++ .coding-flow/runs/np.json\n@@ -0,0 +1 @@\n+forged\n');
  patch('p_ok.patch', 'diff --git a/src/a.txt b/src/a.txt\n--- a/src/a.txt\n+++ b/src/a.txt\n@@ -1 +1 @@\n-hi\n+ho\n');
  return dir;
}

const at = (dir, sub, command) => decide({ tool_name: 'Bash', cwd: path.join(dir, sub), tool_input: { command } }, dir);

function expectDecisions(dir, decision, commands) {
  for (const command of commands) {
    const [sub, text] = Array.isArray(command) ? command : ['.', command];
    assert.equal(at(dir, sub, text).decision, decision, `${sub}: ${text}`);
  }
}

test('a copy into a directory that holds a blocked one is refused', (t) => {
  const dir = repo(t);
  expectDecisions(dir, 'deny', [
    'rsync -a /tmp/cf/ .coding-flow/',
    'rsync -a /tmp/cf/ .coding-flow',
    'cp -rT /tmp/cf .coding-flow',
    'cp -r /tmp/cf/. .coding-flow/',
    'cp -r /tmp/cf/. .coding-flow',
    'cp -r /tmp/cf/runs .coding-flow/',
    'git checkout HEAD~1 -- .coding-flow',
    'git restore --source HEAD~1 -- .coding-flow',
    'git restore --source=HEAD~1 .coding-flow',
    'tar -xf /tmp/a.tar -C .coding-flow',
    'unzip /tmp/a.zip -d .coding-flow',
  ]);
  // Onto the project root (`git restore .`, `cp -r /tmp/x/. .` stay everyday
  // commands), a copy is refused when its source brings a blocked path in.
  const forged = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-cf-')));
  t.after(() => fs.rmSync(forged, { recursive: true, force: true }));
  fs.mkdirSync(path.join(forged, '.coding-flow', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(forged, '.coding-flow', 'runs', 'x-verify.json'), '{}');
  expectDecisions(dir, 'deny', [`rsync -a ${forged}/ .`, `cp -r ${forged}/. .`, `cp -rT ${forged} .`, ['src', `rsync -a ${forged}/ ..`]]);
  expectDecisions(dir, 'allow', ['rsync -a /tmp/cf/ .', `rsync -a ${path.join(forged, '.coding-flow', 'runs')}/ /tmp/elsewhere`]);
  expectDecisions(dir, 'allow', ['cp -r src /tmp/s', 'rsync -a src/ /tmp/s', 'cp -r src lib', 'cp -r /tmp/x .', 'cp -r /tmp/x src/', 'git checkout -- src', 'cp x .coding-flow/']);
});

test('a patch names its paths from the repository top, quoted or not; a shifted prefix is unchecked', (t) => {
  const dir = repo(t);
  const p = (name) => path.join(dir, name);
  expectDecisions(dir, 'deny', [
    `git apply ${p('p_plain.patch')}`,
    `git apply -p1 ${p('p_plain.patch')}`,
    `git apply ${p('p_quoted.patch')}`,
    ['.coding-flow', `git apply ${p('p_plain.patch')}`],
    ['src', `git apply ${p('p_plain.patch')}`],
    `cd .coding-flow && git apply ${p('p_plain.patch')}`,
    'git apply < p_plain.patch',
  ]);
  expectDecisions(dir, 'unchecked', [
    `git apply -p2 ${p('p_p2.patch')}`,
    `git apply -p0 ${p('p_noprefix.patch')}`,
    `git apply --directory=.coding-flow ${p('p_dir.patch')}`,
    `git apply --directory .coding-flow ${p('p_dir.patch')}`,
    `git apply --no-prefix ${p('p_noprefix.patch')}`,
    `git apply --unsafe-paths ${p('p_plain.patch')}`,
    `cat ${p('p_plain.patch')} | git apply`,
  ]);
  expectDecisions(dir, 'allow', [`git apply ${p('p_ok.patch')}`, `git apply --check ${p('p_plain.patch')}`]);
});

test('patch and git am are read like git apply', (t) => {
  const dir = repo(t);
  expectDecisions(dir, 'deny', ['patch -p1 < p_plain.patch', 'patch -p1 -i p_plain.patch', 'patch -p1 --input=p_plain.patch', 'git am p_plain.patch', 'git am < p_plain.patch', ['src', 'git am ../p_plain.patch']]);
  expectDecisions(dir, 'unchecked', ['patch < p_plain.patch', 'patch -p2 < p_plain.patch', 'cat p_plain.patch | patch -p1', 'patch -p1 < missing.patch', 'git am -p2 p_plain.patch']);
  expectDecisions(dir, 'allow', ['patch -p1 < p_ok.patch', 'git am p_ok.patch', 'patch --dry-run -p1 < p_plain.patch']);
});

test('archive options as they are really spelled', (t) => {
  const dir = repo(t);
  expectDecisions(dir, 'deny', [
    'unzip -od .coding-flow/runs /tmp/a.zip',
    'unzip -qd .coding-flow/runs /tmp/a.zip',
    'unzip -qod .coding-flow/runs /tmp/a.zip',
    'unzip -d.coding-flow/runs /tmp/a.zip',
    `tar -x -f /tmp/a.tar -C /tmp -C ${path.join(dir, '.coding-flow', 'runs')}`,
    'tar --extr -f /tmp/a.tar -C .coding-flow/runs',
    'tar -x -f /tmp/a.tar --dir=.coding-flow/runs',
    'tar -xf /tmp/a.tar --one-top-level=.coding-flow/runs',
    'bsdtar -xf /tmp/a.tar -C .coding-flow',
    'gtar -xf /tmp/a.tar -C .coding-flow',
    '7z x /tmp/a.7z -o.coding-flow',
    'python3 -m zipfile -e /tmp/a.zip .coding-flow',
    ['.coding-flow/runs', 'cpio -idm < /tmp/a.cpio'],
  ]);
  expectDecisions(dir, 'unchecked', ['cpio -idm < /tmp/a.cpio', 'bsdtar -xf /tmp/a.tar', '7z x /tmp/a.7z']);
  expectDecisions(dir, 'allow', ['tar -xOf /tmp/a.tar f', 'tar -x --to-stdout -f /tmp/a.tar', 'tar -czf /tmp/o.tgz .coding-flow/runs', 'tar -tf /tmp/a.tar', 'unzip -l /tmp/a.zip', 'unzip -o /tmp/a.zip -d /tmp/out']);
});

test('git mv is a move; braces, find -exec, xargs and a substituted verb are unchecked', (t) => {
  const dir = repo(t);
  expectDecisions(dir, 'deny', ['git mv .coding-flow/runs x', 'git mv x .coding-flow/runs', 'git mv src/a.txt .coding-flow/runs/a.json']);
  expectDecisions(dir, 'unchecked', [
    'cp -r .coding-flow/runs{.bak,}',
    'find .coding-flow -name runs -exec mv {} /tmp/r \;',
    'echo .coding-flow/runs | xargs -I{} mv {} /tmp/r',
    '$(echo mv) .coding-flow/runs /tmp/r',
  ]);
  expectDecisions(dir, 'allow', ['git mv src lib', 'git mv src/a.txt src/b.txt', 'find . -name "*.js" -exec grep x {} +', 'ls | xargs echo', 'git stash', 'git stash list']);
});

// --- re-review of 13-09: a write form that may land a blocked path is refused
// when known, else unchecked — never a silent allow.

function forgedTree(t, dir) {
  const forged = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-forged-')));
  t.after(() => fs.rmSync(forged, { recursive: true, force: true }));
  fs.mkdirSync(path.join(forged, '.coding-flow', 'runs'), { recursive: true });
  fs.mkdirSync(path.join(forged, path.basename(dir), '.coding-flow', 'runs'), { recursive: true });
  return forged;
}

test('a move or copy whose destination names a blocked directory is judged as it, existing or not', (t) => {
  const dir = repo(t);
  const forged = forgedTree(t, dir);
  expectDecisions(dir, 'deny', [
    `mv ${forged}/.coding-flow .coding-flow`,
    `cp -r ${forged}/.coding-flow .coding-flow`,
    `mv -T ${forged}/.coding-flow .coding-flow`,
    `rm -rf .coding-flow && mv ${forged}/.coding-flow .coding-flow`,
    `trash .coding-flow && mv ${forged}/.coding-flow .coding-flow`,
    `rm -rf .coding-flow && cp -r ${forged}/.coding-flow .coding-flow`,
    `cp -r .coding-flow /tmp/cf && sed -i s/failed/passed/ /tmp/cf/runs/a.json && rm -rf .coding-flow && mv /tmp/cf .coding-flow`,
    'git mv x .coding-flow',
  ]);
  // `mv X .coding-flow/` is judged as `.coding-flow` too since the third review:
  // onto a missing `dst/`, mv creates dst.
  expectDecisions(dir, 'deny', [`mv ${forged}/x .coding-flow/`]);
  expectDecisions(dir, 'allow', ['mv src lib', 'cp -r src lib', 'git mv src lib']);
});

test('a tree copied onto the project root from a source the guard cannot read is unchecked', (t) => {
  const dir = repo(t);
  const forged = forgedTree(t, dir);
  const made = path.join(os.tmpdir(), `coding-flow-dir-swap-made-${process.pid}`);
  expectDecisions(dir, 'unchecked', [
    `mkdir -p ${made}/.coding-flow/runs && echo '{}' > ${made}/.coding-flow/runs/a.json && rsync -a ${made}/ .`,
    `mkdir -p ${made}/.coding-flow/runs && cp .coding-flow/runs/a.json ${made}/.coding-flow/runs/ && cp -r ${made}/. .`,
    `cp -r ${forged}/.[!.]* .`,
    `cp -r ${forged}/.c* .`,
    `cp -r ${forged}/.coding* ./`,
    `rsync -a ${forged}/.c* .`,
    `cp -r ${forged}/* .`,
  ]);
  // A missing source nothing in the command makes: the copy fails, nothing lands.
  expectDecisions(dir, 'allow', [`cp -r ${made}-never/. .`]);
});

test('a tree or an extraction landing on an ancestor of the project is judged as the root', (t) => {
  const dir = repo(t);
  const forged = forgedTree(t, dir);
  expectDecisions(dir, 'deny', [`cp -r ${forged}/. ..`, `rsync -a ${forged}/ ..`]);
  expectDecisions(dir, 'unchecked', [
    'tar -xf /tmp/a.tar -C ..',
    'tar -xf /tmp/a.tar -C /',
    'unzip /tmp/a.zip -d ..',
    '7z x /tmp/a.7z -o..',
    'tar -xPf /tmp/a.tar -C /tmp',
    'tar -x --absolute-names -f /tmp/a.tar',
    'tar -xf /tmp/a.tar --to-command=sh -C /tmp',
  ]);
  // A sibling of the project, not an ancestor (the project itself lives under the temp dir).
  const sibling = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-sibling-')));
  t.after(() => fs.rmSync(sibling, { recursive: true, force: true }));
  expectDecisions(dir, 'allow', [`tar -xf /tmp/a.tar -C ${sibling}`, `unzip /tmp/a.zip -d ${sibling}`]);
});

test('git pathspec magic, clustered patch flags, cpio -D and context diffs', (t) => {
  const dir = repo(t);
  fs.writeFileSync(path.join(dir, 'p_context.patch'), '*** a/.coding-flow/runs/c.json\n--- b/.coding-flow/runs/c.json\n***************\n*** 1 ****\n! a\n--- 1 ----\n! b\n');
  fs.writeFileSync(path.join(dir, 'p_context_ok.patch'), '*** a/src/a.txt\n--- b/src/a.txt\n***************\n*** 1 ****\n! a\n--- 1 ----\n! b\n');
  expectDecisions(dir, 'deny', [
    "git checkout HEAD~1 -- ':/.coding-flow/runs/a.json'",
    "git checkout HEAD~1 -- ':(top).coding-flow/runs'",
    "git restore -s HEAD~1 -- ':/.coding-flow'",
    ['src', "git checkout HEAD~1 -- ':/.coding-flow/runs'"],
    'patch -Np1 < p_plain.patch',
    'patch -N -p1 -i p_plain.patch',
    'cpio -idm -D .coding-flow/runs < /tmp/a.cpio',
    'cpio -i --directory=.coding-flow/runs < /tmp/a.cpio',
  ]);
  expectDecisions(dir, 'unchecked', ["git checkout HEAD~1 -- ':(glob).coding-flow/**'", "git checkout HEAD~1 -- ':!src'", 'patch -p1 < p_context.patch', 'patch -p1 < p_context_ok.patch']);
  expectDecisions(dir, 'allow', ['patch -Np1 < p_ok.patch', 'patch -Np1 --dry-run < p_plain.patch', "git checkout -- ':/src'", 'cpio -idm -D /tmp/out < /tmp/a.cpio']);
});

// --- third review of 13-09: prefer unchecked over path-text matching -------------

test('a tree copied onto the root after another segment of the same command is unchecked', (t) => {
  const dir = repo(t);
  const forged = forgedTree(t, dir);
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-empty-')));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const missing = path.join(os.tmpdir(), `coding-flow-dir-swap-missing-${process.pid}`);
  expectDecisions(dir, 'unchecked', [
    `mkdir -p ${empty}/.coding-flow/runs && echo '{}' > ${empty}/.coding-flow/runs/a.json && rsync -a ${empty}/ .`,
    `rm -rf ${empty} && mv ${forged} ${empty} && cp -r ${empty}/. .`,
    `unzip /tmp/forge.zip -d /var/tmp && rsync -a ${missing}/f/ .`,
    `D=${missing}; mkdir -p $D/.coding-flow/runs && cp -r ${missing}/. .`,
    `mkdir -p ${missing} && bash -c 'cp -r ${missing}/. .'`,
    `true; rsync -a ${empty}/ ..`,
  ]);
  // One segment: the source is read on disk as it is.
  expectDecisions(dir, 'allow', [`cp -r ${empty}/. .`, 'git checkout -- src', 'git restore --staged .']);
});

test('a trailing slash or a link does not bring the swap back', (t) => {
  const dir = repo(t);
  const forged = forgedTree(t, dir);
  expectDecisions(dir, 'deny', [
    `rm -rf .coding-flow && mv ${forged}/.coding-flow .coding-flow/`,
    `rm -rf .coding-flow && cp -r ${forged}/.coding-flow .coding-flow/`,
    `rm -rf .coding-flow && mv ${forged}/.coding-flow ./.coding-flow/`,
    `rm -rf .coding-flow && ln -s ${forged}/.coding-flow .coding-flow`,
    `ln -sfn ${forged}/.coding-flow .coding-flow`,
  ]);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.mkdirSync(path.join(dir, 'build'));
  expectDecisions(dir, 'allow', ['mv build dist', 'mv a.txt src', 'mv a.txt src/', `cp -r ${forged}/x src/`, 'ln -s ../a.txt src/a', 'tar -xf /tmp/a.tar -C /opt', 'unzip /tmp/a.zip -d ~/Downloads', 'patch -p1 < /dev/null']);
});

// --- fourth review of 13-09 --------------------------------------------------------

test('a substitution in the copy\'s own segment, a remote source or a remote shell is unchecked', (t) => {
  const dir = repo(t);
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-dir-swap-subst-')));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  expectDecisions(dir, 'unchecked', [
    `rsync -a ${empty}/ . --exclude=$(mkdir -p ${empty}/.coding-flow/runs; echo zz)`,
    `rsync -a ${empty}/ . --exclude=\`mkdir -p ${empty}/.coding-flow/runs\``,
    `rsync -a ${empty}/ . --exclude-from=<(mkdir -p ${empty}/.coding-flow/runs)`,
    'rsync -a host:/x/ .',
    'rsync -a rsync://h/m/ .',
    'rsync -a h::m/ .',
    'rsync -a -e /tmp/loc.sh h:/x/ src/',
    'rsync -avze ssh src/ h:/x/',
    'rsync --rsh=/tmp/loc.sh -a h:/x/ src/',
  ]);
  expectDecisions(dir, 'allow', [`rsync -a ${empty}/ . --exclude='$(x)'`, 'rsync -a src/ build/', 'patch -p1 < /dev/null', 'patch < /dev/null']);
});
