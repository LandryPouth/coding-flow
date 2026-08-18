'use strict';

// Tests of the `guard` PreToolUse hook: deterministic refusal (exit 2) on a
// blocked path or a secret in the content, allow (exit 0) otherwise, fail-open on
// empty input / non-write tool, and idempotent wiring into .claude/settings.json.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const PKG = require('../package.json');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
}

function project(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Pass the hook payload on stdin; returns { code, stdout, stderr }.
function guard(cwd, payload, args = []) {
  const input = payload === null ? '' : JSON.stringify(payload);
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'guard', ...args], {
      cwd,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function runCli(cwd, args) {
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

// Runs a hook command the way Claude Code would: `sh -c "<command>"` with the
// hook payload piped on stdin. Returns { code, stdout, stderr }.
function runHook(cwd, command, payload) {
  const input = payload === null ? '' : JSON.stringify(payload);
  try {
    const stdout = execFileSync('sh', ['-c', command], {
      cwd,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('guard denies writing a .env file (exit 2, deny decision)', (t) => {
  const dir = project(t, 'guard-env');
  const res = guard(dir, { tool_name: 'Write', tool_input: { file_path: '.env', content: 'X=1' } });
  assert.equal(res.code, 2, 'a blocked path must be refused with exit 2');
  const decision = JSON.parse(res.stdout);
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(res.stderr, /guard/);
});

test('guard denies writing a .pem key anywhere', (t) => {
  const dir = project(t, 'guard-pem');
  const res = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: 'config/tls/server.pem', content: 'x' },
  });
  assert.equal(res.code, 2);
});

test('guard denies content that contains a secret', (t) => {
  const dir = project(t, 'guard-secret');
  const res = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: 'src/config.ts', content: 'const k = "sk_live_0123456789abcdefghijkl";' },
  });
  assert.equal(res.code, 2, 'a secret in the content must be refused');
  assert.match(JSON.parse(res.stdout).systemMessage, /secret/i);
});

test('guard allows a normal source write', (t) => {
  const dir = project(t, 'guard-ok');
  const res = guard(
    dir,
    { tool_name: 'Write', tool_input: { file_path: 'src/index.ts', content: 'export const x = 1;' } },
    ['--json'],
  );
  assert.equal(res.code, 0);
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, 'allow');
});

test('guard allows .env.example (safe example)', (t) => {
  const dir = project(t, 'guard-example');
  const res = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: '.env.example', content: 'API_KEY=' },
  });
  assert.equal(res.code, 0);
});

test('guard is fail-open on empty stdin', (t) => {
  const dir = project(t, 'guard-empty');
  const res = guard(dir, null);
  assert.equal(res.code, 0, 'empty stdin must never block');
});

test('guard ignores non-write tools', (t) => {
  const dir = project(t, 'guard-read');
  const res = guard(dir, { tool_name: 'Read', tool_input: { file_path: '.env' } });
  assert.equal(res.code, 0, 'reading .env is not our business — allow');
});

test('guard denies a secret inside a MultiEdit new_string', (t) => {
  const dir = project(t, 'guard-multiedit');
  const res = guard(dir, {
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: 'src/a.ts',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'AKIAABCDEFGHIJKLMNOP' },
      ],
    },
  });
  assert.equal(res.code, 2);
});

// Well-formed fake credentials, assembled at runtime. Written as single literals
// they would be refused by the very guard these tests exercise — which is the
// intended behavior for an "exact" detector, and the reason security suites build
// their fixtures instead of pasting them.
const FAKE_STRIPE_KEY = `sk_${'live'}_0123456789abcdefghijkl`;
const FAKE_AWS_KEY = `AK${'IA'}ABCDEFGHIJKLMNOP`;
const FAKE_PLACEHOLDER = `token: "${'a'.repeat(28)}"`;

// --- the other door: shell writes ------------------------------------------
//
// The editing tools were never the only way to put a secret on disk. A hook that
// watches Write but not `cat > .env` does not enforce a policy, it announces one.

test('guard denies a shell redirection into a blocked path', (t) => {
  const dir = project(t, 'guard-bash-redirect');
  const res = guard(dir, {
    tool_name: 'Bash',
    tool_input: { command: 'echo "API_KEY=live" > .env' },
  });
  assert.equal(res.code, 2, 'redirection must not be a way around the policy');
  assert.match(JSON.parse(res.stdout).systemMessage, /\.env/);
});

test('guard denies a heredoc written into a blocked path', (t) => {
  const dir = project(t, 'guard-bash-heredoc');
  const res = guard(dir, {
    tool_name: 'Bash',
    tool_input: { command: "cat > .env <<'EOF'\nAPI_KEY=live\nEOF" },
  });
  assert.equal(res.code, 2);
});

test('guard denies tee, sed -i, cp, and dd onto a blocked path', (t) => {
  const dir = project(t, 'guard-bash-family');

  for (const command of [
    'echo x | tee .env',
    "sed -i 's/a/b/' config/tls/server.pem",
    'cp /tmp/leak.txt .env.production',
    'dd if=/dev/zero of=id_rsa',
  ]) {
    const res = guard(dir, { tool_name: 'Bash', tool_input: { command } });
    assert.equal(res.code, 2, `must deny: ${command}`);
  }
});

test('guard denies a real credential format inside the command itself', (t) => {
  const dir = project(t, 'guard-bash-secret');
  const res = guard(dir, {
    tool_name: 'Bash',
    tool_input: { command: `echo "key=${FAKE_STRIPE_KEY}" > src/config.js` },
  });
  assert.equal(res.code, 2);
  assert.match(JSON.parse(res.stdout).systemMessage, /command itself/);
});

test('guard allows ordinary shell work', (t) => {
  const dir = project(t, 'guard-bash-ok');

  for (const command of [
    'npm test',
    'npm test > /tmp/out.log 2>&1',
    'grep -r foo src/ > results.txt',
    'git commit -m "wip"',
    'echo "done" >&2',
    'psql "password=localdevonly" -c "select 1"',
    'cp src/a.ts src/b.ts',
  ]) {
    const res = guard(dir, { tool_name: 'Bash', tool_input: { command } });
    assert.equal(res.code, 0, `must allow: ${command} (got ${res.stderr})`);
  }
});

// --- precision: what an allowlist may and may not relax ---------------------

test('a placeholder credential in docs is allowed, a real key format is not', (t) => {
  const dir = project(t, 'guard-allowlist');

  const placeholder = guard(dir, {
    tool_name: 'Write',
    tool_input: {
      file_path: 'docs/auth.md',
      content: 'Example:\n\npassword: "change-me-in-production-please"\n',
    },
  });
  assert.equal(placeholder.code, 0, 'documentation must be allowed to show an example');

  const real = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: 'docs/auth.md', content: `oops: ${FAKE_AWS_KEY}\n` },
  });
  assert.equal(real.code, 2, 'an allowlist relaxes heuristics, never a real key format');
});

test('a placeholder in a test fixture is allowed; the same line in source is not', (t) => {
  const dir = project(t, 'guard-fixture');
  const content = `export const USER = { ${FAKE_PLACEHOLDER} };\n`;

  assert.equal(
    guard(dir, { tool_name: 'Write', tool_input: { file_path: 'src/user.test.ts', content } }).code,
    0,
  );
  assert.equal(
    guard(dir, { tool_name: 'Write', tool_input: { file_path: 'src/user.ts', content } }).code,
    2,
  );
});

test('a project can tune the detectors in harness.json', (t) => {
  const dir = project(t, 'guard-config');
  fs.mkdirSync(path.join(dir, '.coding-flow'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.coding-flow', 'harness.json'),
    JSON.stringify({
      secretPatterns: [{ name: 'Internal ticket key', pattern: 'ACME-[0-9]{6}', precision: 'exact' }],
      secretScanAllowlist: [],
    }),
  );

  // The project's own detector applies…
  assert.equal(
    guard(dir, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/a.ts', content: 'const t = "ACME-123456";' },
    }).code,
    2,
  );

  // …and the built-in it chose to drop no longer fires.
  assert.equal(
    guard(dir, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/a.ts', content: `const k = "${FAKE_STRIPE_KEY}";` },
    }).code,
    0,
  );
});

test('an unparseable detector disables itself, never the hook', (t) => {
  const dir = project(t, 'guard-badregex');
  fs.mkdirSync(path.join(dir, '.coding-flow'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.coding-flow', 'harness.json'),
    JSON.stringify({
      secretPatterns: [
        { name: 'Broken', pattern: '([unclosed', precision: 'exact' },
        { name: 'AWS access key', pattern: '\\bAKIA[0-9A-Z]{16}\\b', precision: 'exact' },
      ],
    }),
  );

  const res = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: 'src/a.ts', content: `const k = "${FAKE_AWS_KEY}";` },
  });
  assert.equal(res.code, 2, 'the valid detectors keep working');

  const ok = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: 'src/a.ts', content: 'export const x = 1;' },
  });
  assert.equal(ok.code, 0, 'a broken config must never crash the write path');
});

test('harness check reports a detector that scans nothing', (t) => {
  const dir = project(t, 'guard-badregex-report');
  runCli(dir, ['init']);
  const harnessPath = path.join(dir, '.coding-flow', 'harness.json');
  const harness = JSON.parse(fs.readFileSync(harnessPath, 'utf8'));
  harness.secretPatterns = [{ name: 'Broken', pattern: '([unclosed' }];
  fs.writeFileSync(harnessPath, JSON.stringify(harness, null, 2));

  const res = runCli(dir, ['harness', 'check', '--quick']);
  assert.equal(res.code, 1);
  assert.match(res.output, /scans nothing/);
});

test('init wires the guard hook into .claude/settings.json, idempotently', (t) => {
  const dir = project(t, 'guard-init');
  runCli(dir, ['init']);
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  assert.ok(fs.existsSync(settingsPath), 'settings.json must be created');

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const pre = settings.hooks.PreToolUse;
  assert.ok(Array.isArray(pre) && pre.length === 1, 'one PreToolUse hook is wired');
  assert.match(pre[0].hooks[0].command, /guard/);

  // Second init: no duplication.
  const second = runCli(dir, ['init']);
  assert.match(second.output, /already wired/);
  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(after.hooks.PreToolUse.length, 1, 'the hook must not be duplicated');
});

test('init --no-guard skips wiring the hook', (t) => {
  const dir = project(t, 'guard-noguard');
  runCli(dir, ['init', '--no-guard']);
  assert.ok(
    !fs.existsSync(path.join(dir, '.claude', 'settings.json')),
    '--no-guard must not create settings.json',
  );
});

test('init merges the guard hook into an existing settings.json without clobbering', (t) => {
  const dir = project(t, 'guard-merge');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const existing = {
    permissions: { allow: ['Bash(ls:*)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
  };
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(existing, null, 2));

  runCli(dir, ['init']);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions.allow, ['Bash(ls:*)'], 'the existing settings are preserved');
  assert.equal(settings.hooks.PreToolUse.length, 2, 'our hook is added alongside the existing one');
  assert.ok(settings.hooks.PreToolUse.some((e) => /guard/.test(e.hooks[0].command)));
});

test('the wired hook runs the resolved binary directly (fast path, no npx)', (t) => {
  const dir = project(t, 'guard-fastpath');
  runCli(dir, ['init']);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const command = settings.hooks.PreToolUse[0].hooks[0].command;

  // The emitted command spawns a locally-resolved binary, not npx, in the
  // happy path: R='<real path>'; if [ -f "$R" ]; then node "$R" guard; else …
  assert.match(command, /^R='/);
  assert.match(command, /if \[ -f "\$R" \]; then node "\$R" guard/);

  // allow: normal source write
  const allow = runHook(dir, command, {
    tool_name: 'Write',
    tool_input: { file_path: 'src/index.ts', content: 'export const x = 1;' },
  });
  assert.equal(allow.code, 0, 'the fast path must allow a normal write');

  // deny: blocked path
  const deny = runHook(dir, command, {
    tool_name: 'Write',
    tool_input: { file_path: '.env', content: 'X=1' },
  });
  assert.equal(deny.code, 2, 'the fast path must deny a blocked path');
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('upgrading widens a matcher we shipped, and only one we shipped', (t) => {
  const dir = project(t, 'guard-matcher');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            // The default we shipped before the guard covered shell writes.
            matcher: 'Write|Edit|MultiEdit|NotebookEdit',
            hooks: [{ type: 'command', command: 'npx --yes @landry_pouth/coding-flow guard' }],
          },
        ],
      },
    }),
  );

  runCli(dir, ['init']);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.match(
    settings.hooks.PreToolUse[0].matcher,
    /Bash/,
    'a project installed before this release must not keep the narrower coverage forever',
  );

  // A matcher the user wrote is a decision, and survives.
  const custom = project(t, 'guard-matcher-custom');
  fs.mkdirSync(path.join(custom, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(custom, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Write',
            hooks: [{ type: 'command', command: 'npx --yes @landry_pouth/coding-flow guard' }],
          },
        ],
      },
    }),
  );

  runCli(custom, ['init']);
  const kept = JSON.parse(fs.readFileSync(path.join(custom, '.claude', 'settings.json'), 'utf8'));
  assert.equal(kept.hooks.PreToolUse[0].matcher, 'Write', 'a customized matcher is never rewritten');
});

test('init upgrades an existing npx-based guard hook to the resolved binary', (t) => {
  const dir = project(t, 'guard-upgrade');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const existing = {
    permissions: { allow: ['Bash(ls:*)'] },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [
            { type: 'command', command: 'npx --yes @landry_pouth/coding-flow@0.4.0 guard', timeout: 30 },
          ],
        },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] },
      ],
    },
  };
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(existing, null, 2));

  const res = runCli(dir, ['init']);
  assert.match(res.output, /upgraded/);

  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.PreToolUse.length, 2, 'the hook is upgraded in place, never duplicated');
  assert.ok(settings.permissions.allow.includes('Bash(ls:*)'), 'existing permissions are preserved');
  assert.ok(
    settings.hooks.PreToolUse.some((e) => e.matcher === 'Bash' && e.hooks[0].command === 'echo hi'),
    'unrelated hooks are untouched',
  );

  const guardEntry = settings.hooks.PreToolUse.find((e) => /guard/.test(e.hooks[0].command));
  assert.equal(guardEntry.matcher, 'Write|Edit', 'the user matcher is preserved');
  assert.equal(guardEntry.hooks[0].timeout, 60, 'the timeout is updated to the current value');
  assert.match(guardEntry.hooks[0].command, /^R='/, 'the command is replaced with the fast path');
  assert.ok(
    guardEntry.hooks[0].command.includes(`coding-flow@${PKG.version} guard`),
    'the npx fallback stays pinned to the installed version',
  );
});

// The guard runs before every Write, Edit and Bash, so its module graph is a
// budget, not an implementation detail. The entry point used to require all 21
// lib modules before looking at argv — ~40 ms of ship.js, worktree.js and
// doctor.js per tool call — and util.js pulled in crypto (OpenSSL bindings) and
// child_process for helpers the guard never calls. This pins both fixes: the
// only way to regress them is to reintroduce an eager require, and the only way
// to satisfy the test dishonestly is to actually keep the graph small.
test('guard loads only the modules it needs', () => {
  const probe = `
    process.argv[2] = 'guard';
    require(${JSON.stringify(path.join(__dirname, '..', 'bin', 'lib', 'guard.js'))});
    const libs = Object.keys(require.cache)
      .filter((key) => key.includes(${JSON.stringify(`${path.sep}bin${path.sep}lib${path.sep}`)}))
      .map((key) => path.basename(key));
    process.stdout.write(JSON.stringify({
      libs,
      crypto: Boolean(require.cache[require.resolve('crypto')]),
      childProcess: Boolean(require.cache[require.resolve('child_process')]),
    }));
  `;
  const raw = execFileSync(process.execPath, ['-e', `const path = require('path');${probe}`], {
    encoding: 'utf8',
  });
  const loaded = JSON.parse(raw);

  for (const heavy of ['ship.js', 'worktree.js', 'doctor.js', 'templates.js', 'bootstrap.js', 'audit.js']) {
    assert.ok(!loaded.libs.includes(heavy), `guard must not load ${heavy}`);
  }

  assert.ok(!loaded.crypto, 'util.js must not pull in crypto on the guard path');
  assert.ok(!loaded.childProcess, 'util.js must not pull in child_process on the guard path');
  assert.ok(loaded.libs.length <= 12, `guard's module graph grew to ${loaded.libs.length}: ${loaded.libs.join(', ')}`);
});

// `guard` returns before the dispatch chain, so it never reaches the block that
// prints the resolved project root. That branch must not come back for a hook
// that runs tens of times per session: stderr noise on every allowed tool call.
test('guard stays silent on stderr when it allows', (t) => {
  const dir = project(t, 'guard-quiet');
  const res = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'src', 'hello.js'), content: 'export const a = 1;\n' },
    cwd: dir,
  });

  assert.equal(res.code, 0, 'an ordinary write is allowed');
  assert.equal(res.stderr, '', 'an allowed write must print nothing to stderr');
});
