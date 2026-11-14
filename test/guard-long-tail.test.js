'use strict';

// The forms story 13-09 left out (story 13-13): git plumbing that writes the work
// tree, scp/sftp, busybox applets, other archivers — and an extraction inside
// the project whose archive is on disk, judged by the members it holds instead
// of being logged unchecked.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { decide } = require('../bin/lib/guard');

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-long-tail-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.coding-flow', 'runs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'));
  return dir;
}

const bash = (dir, command) => decide({ tool_name: 'Bash', cwd: dir, tool_input: { command } }, dir);

function expect(dir, decision, commands) {
  for (const command of commands) {
    assert.equal(bash(dir, command).decision, decision, command);
  }
}

// A ustar archive built by hand: [{ name, type?: '0'|'2'|'5', link?, body? }].
function tar(members) {
  const blocks = [];
  for (const member of members) {
    const body = Buffer.from(member.body || '');
    const header = Buffer.alloc(512);
    header.write(member.name, 0, 100, 'utf8');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);
    header.write(member.type || '0', 156);
    header.write(member.link || '', 157, 100, 'utf8');
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

// A stored (uncompressed) zip: [{ name, symlink? }].
function zip(members) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name);
    const body = Buffer.from(member.body || '');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt32LE(zlib.crc32 ? zlib.crc32(body) : 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((member.symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('git plumbing that writes the work tree is judged: named paths refused, the whole index unchecked', (t) => {
  const dir = tmp(t);
  expect(dir, 'deny', [
    'git checkout-index -f .coding-flow/runs/a-verify.json',
    'git checkout-index -f -- .coding-flow/runs/a-verify.json',
    'git update-index --add --cacheinfo 100644,e69de29bb2d1d6434b8b29ae775ad8c2e48c5391,.coding-flow/runs/x.json && git checkout-index -f .coding-flow/runs/x.json',
  ]);
  expect(dir, 'unchecked', ['git checkout-index -a -f', 'git checkout-index --all', 'git checkout-index --prefix=out/ -a', 'git ls-files | git checkout-index --stdin', 'git read-tree -u -m HEAD~1', 'git read-tree --reset -u HEAD']);
  expect(dir, 'allow', ['git checkout-index -f src/a.js', 'git read-tree HEAD', 'git update-index --refresh', 'git ls-files -s']);
});

test('git clone and git worktree add into a blocked path are refused', (t) => {
  const dir = tmp(t);
  expect(dir, 'deny', ['git clone /tmp/forged .coding-flow/runs', 'git clone --depth 1 /tmp/forged .coding-flow', 'git worktree add .coding-flow/runs/wt', 'git -C .coding-flow clone /tmp/forged runs']);
  expect(dir, 'allow', ['git clone https://example.com/x/y.git vendor/y', 'git clone /tmp/r', 'git worktree add ../wt-x', 'git worktree list', 'git clone -b main /tmp/r lib/r']);
});

test('scp and sftp into a blocked path are refused; uploads and ordinary downloads pass', (t) => {
  const dir = tmp(t);
  expect(dir, 'deny', ['scp host:/x .coding-flow/runs/a-verify.json', 'scp -r host:/r .coding-flow/', 'scp -P 2222 -i key host:/x .coding-flow/runs/x.json', 'sftp host:/x .coding-flow/runs/x.json']);
  expect(dir, 'unchecked', ['sftp -b batch.txt host']);
  expect(dir, 'allow', ['scp -P 22 dist/app.js host:/srv/', 'scp host:/a.txt src/a.txt', 'scp -r build host:/var/www/']);
});

test('a busybox applet is read as the command it names', (t) => {
  const dir = tmp(t);
  expect(dir, 'deny', ['busybox cp /tmp/x .coding-flow/runs/a-verify.json', 'busybox tar -xf a.tar -C .coding-flow/runs', 'busybox mv /tmp/r .coding-flow/runs', 'busybox sed -i s/a/b/ .coding-flow/runs/a.json']);
  expect(dir, 'allow', ['busybox ls -la', 'busybox cp a.txt src/b.txt']);
});

test('unrar, jar and pax extractions are refused into a blocked path, else unchecked', (t) => {
  const dir = tmp(t);
  expect(dir, 'deny', ['unrar x a.rar .coding-flow/runs/', 'cd .coding-flow/runs && jar xf /tmp/a.jar', 'cd .coding-flow/runs && pax -r -f /tmp/a.pax', 'pax -rw src .coding-flow/runs']);
  expect(dir, 'unchecked', ['unrar x a.rar', 'unrar e a.rar', 'jar xf a.jar', 'jar -xf a.jar', 'pax -r < a.pax', 'pax -r -s ,^,x/, -f a.pax']);
  expect(dir, 'allow', ['unrar l a.rar', 'jar tf a.jar', 'jar cf out.jar src', 'pax -f a.pax']);
});

test('a substitution before the copy source still makes a copy onto the project unchecked', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'E'));
  expect(dir, 'unchecked', ['rsync -a --exclude-from=<(true) E/ .', 'rsync -a --exclude-from <(true) E/ .']);
});

test('an extraction inside the project is judged by the members of an archive on disk', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'vendor.tar'), tar([{ name: 'vendor/', type: '5' }, { name: 'vendor/a.js', body: 'x' }]));
  fs.writeFileSync(path.join(dir, 'vendor.tgz'), zlib.gzipSync(tar([{ name: 'lib/b.js', body: 'y' }])));
  fs.writeFileSync(path.join(dir, 'forged.tar'), tar([{ name: '.coding-flow/runs/a-verify.json', body: '{}' }]));
  fs.writeFileSync(path.join(dir, 'forged.tgz'), zlib.gzipSync(tar([{ name: './.coding-flow/runs/a-verify.json', body: '{}' }])));
  fs.writeFileSync(path.join(dir, 'ok.zip'), zip([{ name: 'lib/c.js', body: 'z' }]));
  fs.writeFileSync(path.join(dir, 'forged.zip'), zip([{ name: '.coding-flow/runs/a-verify.json', body: '{}' }]));
  fs.writeFileSync(path.join(dir, 'link.tar'), tar([{ name: 'src/x', type: '2', link: '../.coding-flow/runs' }, { name: 'src/x/a.json', body: '{}' }]));
  fs.writeFileSync(path.join(dir, 'dots.tar'), tar([{ name: '../outside.js', body: 'x' }]));
  fs.writeFileSync(path.join(dir, 'zlink.zip'), zip([{ name: 'src/l', symlink: true, body: '../.coding-flow' }]));

  expect(dir, 'allow', ['tar -xf vendor.tar', 'tar -xzf vendor.tgz', 'tar xzf vendor.tgz', 'tar --extract --file=vendor.tar', 'unzip ok.zip', 'unzip -o ok.zip -d src', 'cd src && tar -xf ../vendor.tar']);
  expect(dir, 'deny', ['tar -xf forged.tar', 'tar -xzf forged.tgz', 'unzip forged.zip', 'unzip -q forged.zip', 'tar -xf forged.tar -C .']);
  expect(dir, 'unchecked', [
    'tar -xf link.tar',
    'tar -xf dots.tar',
    'unzip zlink.zip',
    'tar --strip-components=1 -xf vendor.tar',
    'unzip -j ok.zip',
    'cp /tmp/forged.tar vendor.tar && tar -xf vendor.tar',
    'tar -xf - < vendor.tar',
    'tar -xjf vendor.tar.bz2',
  ]);
});

test('an extraction onto an ancestor of the project is judged by its members too', (t) => {
  const dir = tmp(t);
  const name = path.basename(dir);
  fs.writeFileSync(path.join(dir, 'up.tar'), tar([{ name: `${name}/.coding-flow/runs/a-verify.json`, body: '{}' }]));
  fs.writeFileSync(path.join(dir, 'clean.tar'), tar([{ name: `${name}-sibling/a.js`, body: 'x' }]));
  assert.equal(bash(dir, 'tar -xf up.tar -C ..').decision, 'deny');
  assert.equal(bash(dir, 'tar -xf clean.tar -C ..').decision, 'allow');
});

// Forged archives from the review of 13-13: each one lists benign members to a
// lenient reader while tar or unzip writes the evidence directory. The lister
// trusts only a strict subset of each format; anything else is unchecked.
function header(name, { type = '0', size = 0, magic = 'ustar\x0000', at345 = null } = {}) {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'utf8');
  block.write('0000644\0', 100);
  block.write('0000000\0', 108);
  block.write('0000000\0', 116);
  block.write(size.toString(8).padStart(11, '0') + '\0', 124);
  block.write('00000000000\0', 136);
  block.write(type, 156);
  block.write(magic, 257, 'latin1');
  if (at345 !== null) block.write(at345, 345, 'latin1');
  block.fill(32, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return block;
}
const padded = (buf) => Buffer.concat([buf, Buffer.alloc((512 - (buf.length % 512)) % 512)]);
const member = (name, body = 'forged\n', options = {}) => [header(name, { ...options, size: Buffer.byteLength(body) }), padded(Buffer.from(body))];
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  for (let n = 1; n < 1000; n += 1) if (String(n).length + body.length === n) return `${n}${body}`;
  return null;
}
const ending = Buffer.alloc(1024);
const FORGED = '.coding-flow/runs/x.json';
const pax = (records) => { const text = Buffer.from(records.join('')); return [header('PaxHeaders/x', { type: 'x', size: text.length }), padded(text)]; };

test('a forged tar or zip that a lenient lister would read as benign is unchecked, never allowed', (t) => {
  const dir = tmp(t);
  const write = (name, parts) => fs.writeFileSync(path.join(dir, name), Buffer.concat(parts));
  write('A.tar', [...pax([paxRecord('path', 'src/ok.txt'), paxRecord('path', FORGED)]), ...member('src/ok.txt'), ending]);
  write('B.tar', [...pax([paxRecord('comment', 'x\n99 path=src/ok.txt'), paxRecord('path', FORGED)]), ...member('src/ok.txt'), ending]);
  write('C.tar', [...pax([paxRecord('GNU.sparse.name', FORGED)]), ...member('src/ok.txt'), ending]);
  write('D.tar', [...member(FORGED, 'forged\n', { magic: 'ustar  \0', at345: 'src\0' }), ending]);
  write('E.tar', [...member('src/ok.txt'), Buffer.alloc(512), ...member(FORGED), ending]);
  const longName = Buffer.from(`${FORGED}\0`);
  write('G.tar', [...pax([paxRecord('path', 'src/ok.txt')]), header('././@LongLink', { type: 'L', size: longName.length }), padded(longName), ...member('src/ok.txt'), ending]);
  // P: a benign tar with a zip appended whose one member is the forged run file.
  const tarPart = Buffer.concat([...member('src/ok.txt'), ending]);
  const name = Buffer.from(FORGED);
  const data = Buffer.from('forged\n');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(10, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const localPart = Buffer.concat([local, name, data]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(10, 4);
  central.writeUInt16LE(10, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(tarPart.length, 42);
  const directory = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(tarPart.length + localPart.length, 16);
  write('P.zip', [tarPart, localPart, directory, end]);

  expect(dir, 'unchecked', [
    'tar -xf A.tar', 'tar -xf B.tar', 'tar -xf C.tar', 'tar -xf D.tar', 'tar -xf E.tar', 'tar -xif E.tar', 'tar --ignore-zeros -xf E.tar', 'tar -xf G.tar',
    'unzip P.zip', 'tar -xf P.zip', 'bsdtar -xf P.zip',
  ]);
});

