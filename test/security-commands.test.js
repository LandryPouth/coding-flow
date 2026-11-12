'use strict';

// `validation.security`: a scanner the project declared runs like a quality
// command and is captured as proof — and a scanner that could not run (missing
// binary, no network) is reported as not examined, never as clean.

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

function project(t, { security, mode = null }) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-security-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = {
    commands: ['node -e "process.exit(0)"'],
    quality: [],
    ...(security ? { security } : {}),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  if (mode) {
    const harnessPath = path.join(dir, '.coding-flow', 'harness.json');
    const harness = fs.existsSync(harnessPath) ? JSON.parse(fs.readFileSync(harnessPath, 'utf8')) : {};
    fs.writeFileSync(harnessPath, JSON.stringify({ ...harness, mode }, null, 2));
  }

  return dir;
}

function verify(dir, { json = true } = {}) {
  const res = run(dir, ['verify', '--no-cache', ...(json ? ['--json'] : [])]);
  return json ? { ...res, json: JSON.parse(res.output.slice(res.output.indexOf('{'))) } : res;
}

const FAILING = 'node -e "process.exit(1)"';
const MISSING = 'definitely-not-a-scanner-on-path --scan';
const OFFLINE = 'node -e "console.error(\'request failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\'); process.exit(1)"';

test('a red security command fails verify, and the evidence names it', (t) => {
  const dir = project(t, { security: [FAILING] });

  const res = verify(dir);
  assert.notEqual(res.code, 0, res.output);
  assert.equal(res.json.ok, false);

  const item = res.json.results.find((entry) => entry.command === FAILING);
  assert.ok(item, 'the security command is in the evidence');
  assert.equal(item.kind, 'security');
  assert.equal(item.outcome, 'fail');

  const text = verify(dir, { json: false });
  assert.match(text.output, /security: node -e "process\.exit\(1\)"/);
});

test('a scanner that is not on PATH is not examined: a warning, not a pass', (t) => {
  const dir = project(t, { security: [MISSING] });

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.equal(res.json.ok, true);

  const item = res.json.results.find((entry) => entry.command === MISSING);
  assert.equal(item.outcome, 'not-examined');
  assert.match(item.notExamined, /not found|127/);

  const text = verify(dir, { json: false });
  assert.match(text.output, /passed, with warnings \(1 security command not examined\)/);
  assert.match(text.output, /\[not examined\] security: definitely-not-a-scanner-on-path/);
  assert.match(text.output, /a scanner that did not run found nothing because it looked at nothing/);
});

test('under strict, a scanner that did not run fails verify', (t) => {
  const dir = project(t, { security: [MISSING], mode: 'strict' });

  const res = verify(dir);
  assert.notEqual(res.code, 0, res.output);
  assert.equal(res.json.ok, false);
  assert.equal(res.json.results.find((entry) => entry.command === MISSING).outcome, 'not-examined');
});

test('a network failure is not examined, not a failed scan', (t) => {
  const dir = project(t, { security: [OFFLINE] });

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  const item = res.json.results.find((entry) => entry.command === OFFLINE);
  assert.equal(item.outcome, 'not-examined');
  assert.match(item.notExamined, /network/);
});

test('a finding that only mentions the network is still a failed scan', (t) => {
  const advisory = 'node -e "console.log(\'high: network-utils allows SSRF\'); process.exit(1)"';
  const dir = project(t, { security: [advisory] });

  const res = verify(dir);
  assert.notEqual(res.code, 0, res.output);
  assert.equal(res.json.results.find((entry) => entry.command === advisory).outcome, 'fail');
});

test('a passing scanner is recorded as pass', (t) => {
  const clean = 'node -e "process.exit(0 /* audit */)"';
  const dir = project(t, { security: [clean] });

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.equal(res.json.results.find((entry) => entry.command === clean).outcome, 'pass');
});

test('without validation.security, results carry no security fields and verdicts are unchanged', (t) => {
  const dir = project(t, {});

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  for (const item of res.json.results) {
    assert.equal(item.kind, undefined);
    assert.equal(item.outcome, undefined);
  }

  // A missing binary outside `security` is still a red command, as before.
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation.quality = [MISSING];
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const red = verify(dir);
  assert.notEqual(red.code, 0, red.output);
  assert.equal(red.json.ok, false);
});

test('the PR body never shows a scanner that did not run as a pass', (t) => {
  const { buildEvidenceBlock } = require('../bin/lib/ship');
  const dir = project(t, { security: [MISSING] });
  const evidence = verify(dir).json;
  assert.equal(evidence.ok, true);

  const block = buildEvidenceBlock(evidence);
  const row = block.split('\n').find((line) => line.includes('definitely-not-a-scanner-on-path'));
  assert.match(row, /⚠️ not examined \(command not found \(exit 127\)\)/);
  assert.doesNotMatch(row, /✅/);
});

// --- the scanned code cannot turn a finding into "not examined" -------------

function outcomeOf(t, command) {
  const dir = project(t, { security: [command] });
  const res = verify(dir);
  return { res, item: res.json.results.find((entry) => entry.command === command) };
}

test('a finding that quotes a resolver error on stdout is still a failed scan', (t) => {
  // semgrep prints the flagged source line; the code under scan chose its text.
  const finding = 'node -e "console.log(\'src/net.js:12 if (err.code === \\"ENOTFOUND\\") return;\'); process.exit(1)"';
  const { res, item } = outcomeOf(t, finding);
  assert.equal(item.outcome, 'fail');
  assert.notEqual(res.code, 0, res.output);
});

test('a resolver error followed by findings on stderr is still a failed scan', (t) => {
  const lines = ['getaddrinfo ENOTFOUND example.test', ...Array.from({ length: 6 }, (_, i) => `finding ${i}: vulnerable call`)];
  const command = `node -e "console.error(${JSON.stringify(lines.join('\n')).replace(/"/g, '\\"')}); process.exit(1)"`;
  const { item } = outcomeOf(t, command);
  assert.equal(item.outcome, 'fail');
});

test('an advisory titled "Network error ..." is a failed scan', (t) => {
  const command = 'node -e "console.error(\'high: Network error handling bypass in foo\'); process.exit(1)"';
  assert.equal(outcomeOf(t, command).item.outcome, 'fail');
});

test('a scanner that times out, or is not executable, is not examined', (t) => {
  const slow = { command: 'node -e "setTimeout(() => {}, 5000)"', timeoutMs: 300 };
  const dir = project(t, { security: [slow, './scanner.sh'] });
  fs.writeFileSync(path.join(dir, 'scanner.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  const timedOut = res.json.results.find((entry) => entry.command === slow.command);
  assert.equal(timedOut.outcome, 'not-examined');
  assert.match(timedOut.notExamined, /timed out/);
  const notExecutable = res.json.results.find((entry) => entry.command === './scanner.sh');
  assert.equal(notExecutable.outcome, 'not-examined');
  assert.match(notExecutable.notExamined, /exit 126/);
});

// --- a proof with an unrun scanner is tried again, not replayed -------------

function commitProject(dir) {
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['add', '-A']);
  git(['commit', '-m', 'init']);
}

test('a green proof is replayed, but not one that carries a scanner that did not run', (t) => {
  const clean = project(t, { security: ['node -e "process.exit(0 /* audit */)"'] });
  commitProject(clean);
  assert.equal(run(clean, ['verify']).code, 0);
  assert.match(run(clean, ['verify']).output, /already proved/);

  const offline = project(t, { security: [MISSING] });
  commitProject(offline);
  assert.equal(run(offline, ['verify']).code, 0);
  const again = run(offline, ['verify']);
  assert.doesNotMatch(again.output, /already proved/);
  assert.match(again.output, /\[not examined\] security:/);
});

test('without validation.security, the validation block every proof is fingerprinted on is unchanged', (t) => {
  const { readConfig } = require('../bin/lib/config');
  const dir = project(t, {});
  assert.deepEqual(Object.keys(readConfig(dir).validation).sort(), ['commands', 'freshCommands', 'quality']);
});

// --- each scanner's own offline shape, and nothing that merely looks like it -

function scannerOutcome(t, { stdout = '', stderr = '', code = 1 }) {
  const dir = project(t, { security: ['node scanner.js'] });
  fs.writeFileSync(
    path.join(dir, 'scanner.js'),
    `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${code});\n`,
  );
  const res = verify(dir);
  return res.json.results.find((entry) => entry.command === 'node scanner.js');
}

test('pnpm offline (its error is on stdout, under a stack) is not examined', (t) => {
  const stdout = [
    ' ENOTFOUND  request to https://registry.npmjs.org/-/npm/v1/security/audits failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org',
    '',
    'FetchError: request to https://registry.npmjs.org/-/npm/v1/security/audits failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org',
    '    at ClientRequest.<anonymous> (/pnpm/dist/pnpm.cjs:1:1)',
    '    at ClientRequest.emit (node:events:518:28)',
    '    at TLSSocket.socketErrorListener (node:_http_client:500:9)',
    '    at TLSSocket.emit (node:events:518:28)',
    '    at emitErrorNT (node:internal/streams/destroy:170:8)',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)',
    '',
  ].join('\n');
  assert.equal(scannerOutcome(t, { stdout }).outcome, 'not-examined');
});

test('npm offline (a warning on stderr) is not examined', (t) => {
  const stderr = 'npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\n';
  assert.equal(scannerOutcome(t, { stderr }).outcome, 'not-examined');
});

test('pip-audit offline (Python requests) is not examined', (t) => {
  const stderr = [
    'Traceback (most recent call last):',
    '  File "/usr/lib/python3/site-packages/requests/adapters.py", line 519, in send',
    "requests.exceptions.ConnectionError: HTTPSConnectionPool(host='pypi.org', port=443): Max retries exceeded with url: /pypi/requests/json (Caused by NameResolutionError(\"<urllib3.connection.HTTPSConnection object>: Failed to resolve 'pypi.org' ([Errno -3] Temporary failure in name resolution)\"))",
    '',
  ].join('\n');
  assert.equal(scannerOutcome(t, { stderr }).outcome, 'not-examined');
});

test('govulncheck offline (Go resolver) is not examined', (t) => {
  const stderr = 'govulncheck: fetching vulnerabilities: Get "https://vuln.go.dev/index/modules.json.gz": dial tcp: lookup vuln.go.dev: no such host\n';
  assert.equal(scannerOutcome(t, { stderr }).outcome, 'not-examined');
});

test('a warning that names a repository path like src/getaddrinfo.js is a failed scan', (t) => {
  const stderr = 'warning: could not parse src/getaddrinfo.js (ENOTFOUND)\n';
  assert.equal(scannerOutcome(t, { stdout: 'finding: src/a.js:3 eval of user input\n', stderr }).outcome, 'fail');
});

test('a semgrep finding that echoes the npm error text after its line number is a failed scan', (t) => {
  const stdout = '    12┆ request to https://x failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\n';
  assert.equal(scannerOutcome(t, { stdout }).outcome, 'fail');
});
