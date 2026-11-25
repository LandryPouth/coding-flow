"use strict";

// What a verify leaves behind: the preflight a story is checked against, the
// story-evidence check, fingerprints that decide whether a past run still
// proves today's tree, and the evidence file itself.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const { cwd } = require("./context");
const { policyFingerprint } = require("./policy-fingerprint");
const {
  currentTreeToken, captureIdentity, workingTreeSnapshot, changedPaths, projectPathsFromTop, snapshotBlob, snapshotRootsDigest,
} = require("./identity");
const { isDeepStrictEqual } = require("util");
const { resolveCoverageFloor } = require("./coverage");
const {
  storyPartPath,
  resolveProjectPath,
  readStoryBundle,
  extractSection,
} = require("./story");
const {
  normalizePortable,
  readJson,
  writeTimestampedEvidence,
  addIssue,
  log,
} = require("./util");
const {
  harnessConfigPath,
  harnessRunsDir,
  readHarnessConfig,
  harnessMode,
} = require("./harness-config");
const {
  currentDiffBase,
  runGitList,
  riskPathsInDiff,
  setDiffBaseRequest,
  diffBaseFlag,
  publicDiffBase,
} = require("./diff-scope");
const { scoreStoryRisk, scoreDiffRisk, combineRisk } = require("./risk");
const {
  contraryPolicy,
  freshTestsRequired,
  evaluateCoverage,
  scanTestWeakening,
  readAcceptanceCriteria,
  evaluateContrarySignals,
  NO_CONTRARY,
} = require("./coverage-gate");
const {
  isUnattended,
  isProjectScriptInvocation,
  resolveStoryDir,
  resolveValidationCommands,
  cleanEnvironment,
  runValidationCommand,
  securityOutcome,
  commandTimeout,
  captureEnvironment,
} = require("./validation-run");
const { evaluateClaim } = require("./claim");
const { runRedAtBase } = require("./red-at-base");
const { evaluateComplexity } = require("./complexity");
const { evaluateMutation } = require("./mutation");

function buildHarnessPreflight({ story = null } = {}) {
  const { config, exists } = readHarnessConfig();
  const resolvedStory = resolveProjectPath(story);
  let storyText = "";
  let storyFiles = [];

  if (resolvedStory && resolvedStory.insideRoot && resolvedStory.exists) {
    const stat = fs.statSync(resolvedStory.fullPath);
    const storyDir = stat.isDirectory() ? resolvedStory.fullPath : path.dirname(resolvedStory.fullPath);
    const bundle = readStoryBundle(storyDir);
    storyText = Object.values(bundle).join("\n");
    storyFiles = Object.entries(bundle)
      .filter(([, content]) => content.trim().length > 0)
      .map(([name]) => normalizePortable(path.relative(cwd, path.join(storyDir, name))));
  }

  // Both sources, highest wins — but they do not have the same ceiling. The
  // diff is the only one that can say `high`, because it is the only one that
  // shows what the change actually reaches; the story can raise a quiet change
  // to `medium`. So wording a story mildly still cannot talk the score down,
  // and wording it dramatically can no longer buy STRICT ceremony for a
  // heading change.
  const risk = combineRisk(
    scoreStoryRisk(storyText, config),
    scoreDiffRisk(currentTreeToken(cwd) ? riskPathsInDiff() : [], config),
  );
  const mode = risk.level === "high" ? "strict" : risk.level === "medium" ? "standard" : "fast";
  const requiredChecks = [...config.requiredChecks];

  if (risk.level === "high") {
    requiredChecks.push("security-check", "server-side-validation", "rollback-evidence");
  }

  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
    policyFingerprint: policyFingerprint(cwd),
    configPath: normalizePortable(path.relative(cwd, harnessConfigPath())),
    configExists: exists,
    story: resolvedStory ? resolvedStory.relativePath : null,
    storyExists: resolvedStory ? resolvedStory.exists : null,
    risk,
    recommendedMode: mode,
    storyFiles,
    requiredChecks: [...new Set(requiredChecks)],
    stopConditions: [
      "Secrets or local env files are present in the diff.",
      "Security-sensitive behavior lacks server-side enforcement.",
      "Rollback notes are missing for risky changes.",
      "Validation commands cannot run or fail outside story scope.",
      "The implementation touches files outside the declared story scope without explanation.",
    ],
  };
}

function checkStoryEvidence(report, { story = null, strict = false } = {}) {
  if (!story) {
    return;
  }

  const resolvedStory = resolveProjectPath(story);

  if (!resolvedStory || !resolvedStory.insideRoot) {
    addIssue(report.errors, "story_outside_root", "Story path must stay inside the project root", story);
    return;
  }

  if (!resolvedStory.exists) {
    addIssue(report.errors, "story_missing", `${resolvedStory.relativePath} does not exist`, resolvedStory.relativePath);
    return;
  }

  const storyDir = fs.statSync(resolvedStory.fullPath).isDirectory()
    ? resolvedStory.fullPath
    : path.dirname(resolvedStory.fullPath);
  const bundle = readStoryBundle(storyDir);
  const risk = scoreStoryRisk(Object.values(bundle).join("\n"), report.config);
  const relativeStoryDir = normalizePortable(path.relative(cwd, storyDir));

  // Paths come from the resolver, so a single-file story is told about story.md
  // and never sent looking for a spec.md it was never meant to have.
  const partPath = (part) => normalizePortable(path.relative(cwd, storyPartPath(storyDir, part)));

  if (!bundle["spec.md"].trim()) {
    addIssue(
      report.errors,
      "missing_spec_file",
      "a story-scoped harness check needs story content (spec.md or story.md)",
      partPath("spec"),
    );
  }

  // The executed outcome lives under `## Result` in tasks.md (Status, files
  // changed, tests run, rollback). The checklist above it must not satisfy the
  // high-assurance requirement, so we look at the Result section specifically.
  const notes = extractSection(bundle["tasks.md"], "Result");
  const notesPath = partPath("tasks");
  const highAssurance = strict || harnessMode(report.config) === "strict" || risk.level === "high";

  if (highAssurance && !notes.trim()) {
    addIssue(report.errors, "missing_result", "High-assurance story checks require a filled ## Result in tasks.md", notesPath);
    return;
  }

  if (notes.trim() && !/rollback/i.test(notes)) {
    addIssue(
      highAssurance ? report.errors : report.warnings,
      "missing_rollback_notes",
      "the tasks.md ## Result should include rollback notes",
      notesPath,
    );
  }

  if (risk.level === "high" && notes.trim() && !/(security|auth|permission|trust boundary|server-side)/i.test(notes)) {
    addIssue(
      report.warnings,
      "missing_security_evidence",
      "High-risk story results should mention the security validation performed",
      notesPath,
    );
  }

  if (risk.level === "high" && !bundle["plan.md"].trim()) {
    addIssue(
      report.warnings,
      "missing_tests_plan",
      "High-risk stories should keep the test plan in plan.md up to date",
      partPath("plan"),
    );
  }
}

// Identifies WHAT was proved, so a recorded proof is only reusable for the same
// set of commands. Changing config.validation must invalidate every prior green.
// A different limit is a different command contract: a run that passed under a
// 20 min limit proves nothing about the same command under 1 s. Commands with no
// declared limit hash exactly as before, so existing proofs stay valid.
// What a proof's command set is: the checks, preceded by the fixers when there
// are any (marked, so a fixer and a check of the same text differ). With no
// fixer this is exactly the old list, and every earlier proof keeps its value.
const FIXER_LINE = "\u0001fix\u0000";
const isFixerLine = (line) => line.startsWith(FIXER_LINE);

function provedCommands(resolution) {
  const fix = resolution.fix || [];
  const limit = (command) => (resolution.fixTimeouts && resolution.fixTimeouts[command]) || "";
  return fix.length > 0
    ? [...fix.map((command) => `${FIXER_LINE}${command}\u0000${limit(command)}`), ...resolution.commands]
    : resolution.commands;
}

function commandsFingerprint(commands, timeouts = {}) {
  const lines = commands.map((command) => (timeouts && timeouts[command] ? `${command}\u0000${timeouts[command]}` : command));

  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 40);
}

// The tree token deliberately ignores untracked files (see identity.js), which is
// fine for flagging staleness but not for skipping a run: a brand-new, untracked
// source file is exactly the case where re-running matters. Folding the untracked
// listing and contents into the cache key closes that hole without touching what `stale` means.
// Only ever called once currentTreeToken() has confirmed a git repository, so an
// empty listing here means "no untracked files", not "git unavailable".
//
// `.coding-flow/` is excluded for the same reason the tree token excludes it: it
// is where proofs are written, so counting it would mean every verify invalidates
// the proof it just recorded.
const UNTRACKED_CONTENT_MAX_BYTES = 5 * 1024 * 1024;

function untrackedDigest() {
  const listing = runGitList(["ls-files", "--others", "--exclude-standard"]).filter(
    (file) => file !== ".coding-flow" && !file.startsWith(".coding-flow/"),
  );

  // Names alone miss the common case: a file this story created, edited again
  // after its first verify. Fold each file's content in; a file too big to read
  // cheaply (or unreadable) falls back to size + mtime, which can only over-invalidate.
  const hash = crypto.createHash("sha256");

  for (const file of listing) {
    hash.update(`${file}\0`);

    try {
      const absolute = path.resolve(cwd, file);
      const stat = fs.statSync(absolute);

      if (stat.isFile() && stat.size <= UNTRACKED_CONTENT_MAX_BYTES) {
        hash.update(fs.readFileSync(absolute));
      } else {
        hash.update(`${stat.size}:${stat.mtimeMs}`);
      }
    } catch {
      hash.update("unreadable");
    }

    hash.update("\0");
  }

  return hash.digest("hex").slice(0, 40);
}

// The story's own text. It is outside the tree token (prose is not code), yet the
// verdict reads it — ticked criteria, a `## Test Exemption`, the risk words — so a
// proof is only replayed for the story text it was judged on.
function storyDigest(storyDir) {
  if (!storyDir) {
    return null;
  }

  const bundle = readStoryBundle(storyDir);
  return crypto.createHash("sha256").update(JSON.stringify(bundle)).digest("hex").slice(0, 40);
}

function currentHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// A green proof of this story that still cannot be replayed for the question
// being asked now, whatever its tree token says.
function canStandIn(evidence, { redAtBase }) {
  // A proof made without the red-at-base check cannot stand in for one that
  // asked for it: the two claims are different, and the stronger one is the
  // question being asked now.
  if (redAtBase && !(evidence.redAtBase && evidence.redAtBase.ok === true)) {
    return false;
  }

  // A scanner that could not run (offline, missing) may run next time: a
  // proof that carries one is never replayed in place of trying again.
  if ((evidence.results || []).some((item) => item.outcome === "not-examined")) {
    return false;
  }

  // Likewise a mutation probe that did not answer (uncommitted edits, no site,
  // a budget run out): the same tree, committed, may get an answer.
  if (evidence.mutation && evidence.mutation.ran === false && !evidence.mutation.skipped) {
    return false;
  }

  // The tree token ignores HEAD, but the probe mutated a commit: a proof made
  // at another one (a reset, an amend) answered about other code.
  if (evidence.mutation && evidence.mutation.ran === true && evidence.mutation.head !== currentHead()) {
    return false;
  }

  // Story-less runs share `story: null` with land's re-verify, which skipped
  // the coverage gate: replaying it would be a green with no gate behind it.
  // Evidence from before `skipped` existed is recognised by its reason.
  return !(
    evidence.coverage &&
    (evidence.coverage.skipped === true || evidence.coverage.reason === COVERAGE_SKIPPED_REASON)
  );
}

// Looks for a green verify that already proves this exact story, at this exact
// working-tree content, for this exact command set. Re-running `tsc && test &&
// lint` to reconfirm a result nothing has invalidated is pure latency.
//
// Conservative by construction: outside git, or when anything cannot be
// determined, this returns null and the commands run for real.
function findReusableVerify({
  storyRelativePath, storyDir = null, commands, timeouts = {}, claimKind = null, redAtBase = false,
}) {
  const token = currentTreeToken(cwd);
  const mergeBase = currentDiffBase(cwd).mergeBase;

  if (!token || commands.length === 0) {
    return null;
  }

  // Story 19-05: with fixers declared a proof also stands for the roots they may
  // not rewrite, which the tree token leaves out: another story's file put back
  // unformatted, or a `.coding-flow/` file edited, is a change.
  const storyRoots = commands.some(isFixerLine) ? fixerRootsDigest(workingTreeSnapshot(cwd)) : null;

  if (commands.some(isFixerLine) && !storyRoots) {
    return null;
  }

  const untracked = untrackedDigest();
  const storyText = storyDigest(storyDir);
  const fingerprint = commandsFingerprint(commands, timeouts);
  const harnessConfig = readHarnessConfig().config;
  const floor = JSON.stringify(resolveCoverageFloor(harnessConfig));
  const contrary = JSON.stringify(contraryPolicy(harnessConfig));
  const policy = policyFingerprint(cwd);
  const runsDir = harnessRunsDir();

  if (!fs.existsSync(runsDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(runsDir)
    .filter((name) => name.endsWith("-verify.json"))
    .sort()
    .reverse();

  for (const name of candidates) {
    const fullPath = path.join(runsDir, name);
    const evidence = readJson(fullPath, null);

    if (!evidence || evidence.ok !== true || evidence.story !== storyRelativePath || !canStandIn(evidence, { redAtBase })) {
      continue;
    }

    const provenanceToken = evidence.provenance && evidence.provenance.git
      ? evidence.provenance.git.treeToken
      : null;

    if (
      provenanceToken === token &&
      evidence.commandsFingerprint === fingerprint &&
      // A proof judged under another floor is a different proof; evidence from
      // before the floor existed has none and is re-run once.
      JSON.stringify(evidence.coverageFloor || null) === floor &&
      JSON.stringify(evidence.contraryPolicy || null) === contrary &&
      // Evidence without the field predates the policy fingerprint: never reused.
      evidence.policyFingerprint === policy &&
      // A proof made against another base is a different proof.
      (evidence.diffBase ? evidence.diffBase.mergeBase : null) === mergeBase &&
      (evidence.claim ? evidence.claim.kind : null) === claimKind &&
      evidence.untrackedDigest === untracked &&
      evidence.storyDigest === storyText &&
      (evidence.fixerRootsDigest || null) === storyRoots
    ) {
      return { evidence, path: fullPath };
    }
  }

  return null;
}

// Why `skipCoverage` callers (land's re-verify) record no coverage verdict. Such
// a proof ran the commands only, so it is never replayed as a full verify.
const COVERAGE_SKIPPED_REASON = "not evaluated (no single story to attribute this run to)";

// Persists a verify evidence under .coding-flow/runs and returns its path. The
// name always ends in -verify.json (so the ledger/audit ingest it) and stays
// unique even inside a tight batch loop: same-millisecond writes get a counter.
function writeVerifyEvidence(evidence) {
  return writeTimestampedEvidence(harnessRunsDir(), "verify", evidence);
}

// A command an agent wrote into plan.md runs with the developer's (or the CI
// runner's) secrets, so it needs a human watching — or an explicit say-so.
const PLAN_COMMANDS_REFUSAL =
  "commands from plan.md are not run unattended; declare them in .coding-flow/config.json " +
  "(with the user's agreement), use the project's own scripts (`npm test`), or pass --allow-plan-commands";

// Runs the resolved commands and applies the post-run rules. A fully replayed
// suite where this risk level asked for tests that actually ran is a non-proof;
// quality and security commands are exempt from that rule. A security scanner
// that could not run is "not examined": a warning, and a failure under strict.
function executeValidationCommands({ resolution, freshRequired, cleaned, refused, strict = false }) {
  return (refused ? [] : resolution.commands).map((command) => {
    const item = runValidationCommand(command, {
      ...commandTimeout(resolution, command),
      ...(cleaned ? { env: cleaned.env } : {}),
    });

    if ((resolution.security || []).includes(command)) {
      const judged = securityOutcome(item);

      return {
        ...item,
        kind: "security",
        ...judged,
        ...(judged.outcome === "not-examined" ? { ok: !strict } : {}),
      };
    }

    if (freshRequired && item.ok && item.cache === "full" && !(resolution.quality || []).includes(command)) {
      return {
        ...item,
        ok: false,
        freshRequired:
          "fully replayed from a build-tool cache, and this story's risk asks for tests that ran: " +
          "re-run with the tool's force flag (e.g. --force), or declare validation.freshCommands " +
          "(`verify --no-cache` only skips the reuse of an earlier proof, not the build tool's cache).",
      };
    }

    return item;
  });
}

// Fixers (story 19-05) run before the checks, each like any declared command: a
// red one is a red verify. The files whose content they changed are listed,
// from two snapshots of the working tree taken around them; null when git cannot
// say (outside git, before the first commit), never a guessed empty list. Their
// changes stay in the tree: the checks, and the tree token, see the fixed files.
//
// A file a fixer touched is the story's diff, like a hand edit, in every signal:
// nothing depends on whether the fix is committed yet. A fixer that rewrites
// `.coding-flow/` or the story's own files is a red run: the config, the story
// text and its criteria are judged as written, never as a formatter left them.
// Paths are relative to the project root, like every other path verify prints.
function runFixers({ resolution, cleaned, storyDir }) {
  const before = workingTreeSnapshot(cwd);
  const results = resolution.fix.map((command) => ({
    ...runValidationCommand(command, {
      ...commandTimeout({ timeouts: resolution.fixTimeouts }, command),
      ...(cleaned ? { env: cleaned.env } : {}),
    }),
    kind: "fix",
  }));
  const after = workingTreeSnapshot(cwd);
  const changed = changedPaths(cwd, before, after);
  const harmless = (changed || []).map((file) => ({ file, kind: harmlessRewrite(file, before, after) })).filter(({ kind }) => kind);
  const fixedFiles = changed && changed.filter((file) => !harmless.some((entry) => entry.file === file));
  const forbidden = forbiddenFixes(fixedFiles || [], storyDir);

  if (forbidden.length > 0) {
    results.push({
      command: "(fixers)",
      kind: "fix",
      ok: false,
      exitCode: null,
      toolError: `a fixer changed ${forbidden.join(", ")}: .coding-flow/ and story files are judged as written, never rewritten by a fixer. ${FORMATTER_REMEDY}`,
      durationMs: 0,
      stdoutTail: "",
      stderrTail: "",
    });
  }

  // What the roots held once the fixers ran: a reuse must find them unmoved.
  return {
    results,
    fixedFiles,
    reformatted: harmless.filter(({ kind }) => kind === "reformatted").map(({ file }) => file),
    guardLogs: harmless.filter(({ kind }) => kind === "guard-log").map(({ file }) => file),
    fixerRootsDigest: fixerRootsDigest(after),
  };
}

// The story roots and `.coding-flow/`, minus what changes on its own between two
// verifies (the run files, the guard's logs).
function fixerRootsDigest(tree) {
  return snapshotRootsDigest(cwd, tree, [...STORY_ROOT_DIRS, ".coding-flow"], (file) => file.startsWith(".coding-flow/runs/") || GUARD_LOGS.has(file));
}

// Under `.coding-flow/` a fixer may reformat, never rewrite: a JSON or JSONL file
// read back to the same value is "reformatted" (prettier re-indents the run files
// verify itself wrote), and a guard log may only be the guard's own work during
// the run ("guard-log"). Anything else is null — a write; a new or removed file
// included: a forged run file stays red.
function harmlessRewrite(file, before, after) {
  if (!file.startsWith(".coding-flow/")) {
    return null;
  }

  const old = snapshotBlob(cwd, before, file);
  const now = snapshotBlob(cwd, after, file);

  if (GUARD_LOGS.has(file)) {
    return now !== null && (old === null || guardLogGrew(old, now)) ? "guard-log" : null;
  }

  return old !== null && now !== null && sameJsonValue(file, old, now) ? "reformatted" : null;
}

// What the guard does to its log (guard.js): appends a line, and past 256 KB keeps
// its last 200 lines before appending. Old bytes a prefix of the new, or that
// exact trim followed by appends; a fixer's truncation or edit is neither.
const GUARD_LOG_TRIM = { maxBytes: 256 * 1024, keptLines: 200 };

function guardLogGrew(old, now) {
  if (now.subarray(0, old.length).equals(old)) {
    return true;
  }

  const kept = old.toString("utf8").split("\n").filter(Boolean).slice(-GUARD_LOG_TRIM.keptLines);
  const tail = Buffer.from(`${kept.join("\n")}\n`);
  return old.length > GUARD_LOG_TRIM.maxBytes && kept.length > 0 && now.subarray(0, tail.length).equals(tail);
}

function sameJsonValue(file, old, now) {
  const lines = (bytes) => bytes.toString("utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const parse = file.endsWith(".jsonl") ? lines : file.endsWith(".json") ? (bytes) => JSON.parse(bytes.toString("utf8")) : null;

  try {
    return parse !== null && isDeepStrictEqual(parse(old), parse(now));
  } catch {
    return false;
  }
}

// Test files the gate counted as strengthened that a fixer also rewrote in this
// run: said, never excused nor refused — the verdict is the gate's (its neutral
// rule is story 19-08's), so a reuse or a status reading it later stays sound.
function fixerStrengthened(coverage, fixing, config) {
  if (!fixing || !fixing.fixedFiles || fixing.fixedFiles.length === 0 || !coverage || coverage.mode !== "test-file") {
    return [];
  }

  // The gate names files from the repository top: brought to the project root's
  // form, the one fixedFiles is in.
  return matchFixerStrengthened(scanTestWeakening(config).strengthened, fixing.fixedFiles, projectPathsFromTop(cwd));
}

function matchFixerStrengthened(strengthened, fixedFiles, toProject) {
  const fixed = new Set(fixedFiles);
  return strengthened.map(toProject).filter((file) => fixed.has(file));
}

const fixingFields = ({ fixedFiles, reformatted, guardLogs, fixerRootsDigest: digest }) => ({
  fixedFiles,
  ...(reformatted.length > 0 ? { reformatted } : {}),
  ...(guardLogs.length > 0 ? { guardLogs } : {}),
  fixerRootsDigest: digest,
});

const withFixerStrengthened = (files) => (files.length > 0 ? { fixerStrengthened: files } : {});

// Story 19-05: the fixers run before anything reads the tree or the diff — the
// fresh-test requirement, the commands (package.json may be reformatted), the
// risk, the coverage, the story text, the policy — so one tree gets one verdict.
// Resolved here only to know which fixers to run and whether they may run (no
// check, or refused unattended: none run). `land` passes runFix: false: on the
// target checkout a fixer would leave it dirty.
function fixFirst({ storyDir, unattended, allowPlanCommands, cleaned, announce, runFix }) {
  const plan = resolveValidationCommands({ storyDir });

  if (!runFix || plan.fix.length === 0 || plan.commands.length === 0) {
    return null;
  }

  const refused = planCommandsRefusal({ resolution: plan, unattended, allowPlanCommands });
  announcePlanCommands({ announce, refused, resolution: plan });
  return refused ? null : runFixers({ resolution: plan, cleaned, storyDir });
}

// The guard's own logs: written by the guard during a run (a parallel tool call,
// the OpenCode plugin), never by a fixer worth naming.
const GUARD_LOGS = new Set([".coding-flow/denials.jsonl", ".coding-flow/guard-unchecked.jsonl"]);
// Where stories live: a fixer may rewrite none of them (another story's criteria,
// an epic index), nor the story in scope wherever it lives, nor `.coding-flow/`.
const STORY_ROOT_DIRS = ["epics", "specs", ".specify"];
const STORY_ROOTS = STORY_ROOT_DIRS.map((root) => `${root}/`);
const FORMATTER_REMEDY =
  "If it only reformatted them, add `.coding-flow/`, `epics/`, `specs/` and `.specify/` to your formatter's ignore file (e.g. `.prettierignore`).";

function forbiddenFixes(fixedFiles, storyDir) {
  const storyPrefix = storyDir ? `${normalizePortable(path.relative(cwd, storyDir))}/` : null;
  return fixedFiles.filter(
    (file) => file.startsWith(".coding-flow/") || STORY_ROOTS.some((root) => file.startsWith(root)) || (storyPrefix && file.startsWith(storyPrefix)),
  );
}

// A fixer from plan.md is a plan command: refused unattended on the same terms.
function planCommandsRefusal({ resolution, unattended, allowPlanCommands }) {
  const planCommands = [...planFixers(resolution), ...(resolution.source === "plan.md" ? resolution.commands : [])];

  return planCommands.length > 0 && unattended && !allowPlanCommands && !planCommands.every(isProjectScriptInvocation)
    ? PLAN_COMMANDS_REFUSAL
    : null;
}

const planFixers = (resolution) => (resolution.fixSource === "plan.md" ? resolution.fix : []);

function announcePlanCommands({ announce, refused, resolution }) {
  if (announce && resolution.planFixersIgnored) {
    log(`Warning: the ## Fixers block of plan.md is not run (${resolution.planFixersIgnored} command(s)): the checks come from ${resolution.source}, so declare fixers in validation.fix.`);
  }

  if (!announce || refused || resolution.source !== "plan.md") {
    return;
  }

  log("Running commands from plan.md (not from .coding-flow/config.json):");

  for (const command of [...planFixers(resolution), ...resolution.commands]) {
    log(`  ${command}`);
  }
}

function evaluateClaimFor({ refused, storyDir, config, claim, resolution, commandsOk, startedAt }) {
  return refused
    ? null
    : evaluateClaim({
      storyDir,
      config,
      flagClaim: claim,
      commandSource: resolution.source,
      commands: resolution.commands,
      commandsOk,
      startedAt,
    });
}

// The proofs a run is asked for beyond the suite: red-at-base on request, the
// mutation probe when the project opted in (it decides itself whether the diff
// triggers it). The probe needs a green suite to mutate against.
function extraProofs({ redAtBase, refused, cleaned, commandsOk, skipCoverage, storyDir, config, claim }) {
  return {
    red: redAtBase && !refused ? runRedAtBase({ config, ...(cleaned ? { env: cleaned.env } : {}) }) : null,
    mutation: commandsOk && !skipCoverage && !refused ? evaluateMutation({ storyDir, config, claim }) : null,
  };
}

// story-26-07: `## Result` lines that say something only a human can do, in a
// story with no open `## Human to-do` item. A warning, never part of `ok`.
function uncapturedFields(storyDir) {
  if (!storyDir) {
    return {};
  }

  try {
    const { uncapturedTodoLines } = require("./todo");
    const lines = uncapturedTodoLines(cwd, storyDir, require("./config").readConfig(cwd));
    return lines.length > 0 ? { todoUncaptured: lines } : {};
  } catch {
    return {};
  }
}

function verifyStoryOnce({
  story = null,
  exemption = null,
  policyChange = null,
  claim = null,
  skipCoverage = false,
  unattended = isUnattended(),
  allowPlanCommands = false,
  cleanEnv = false, redAtBase = false, announce = false, runFix = true,
} = {}) {
  const resolvedStory = story ? resolveProjectPath(story) : null;
  const storyDir = resolveStoryDir(story);
  setDiffBaseRequest({ flagBase: diffBaseFlag(), story });
  const cleaned = cleanEnv ? cleanEnvironment() : null;
  // The fixers run first: everything below reads the tree they leave.
  const fixing = fixFirst({ storyDir, unattended, allowPlanCommands, cleaned, announce, runFix });
  const { config } = readHarnessConfig();
  const freshRequired = freshTestsRequired({ storyDir, config });
  const resolution = resolveValidationCommands({ storyDir, fresh: freshRequired });
  const refused = planCommandsRefusal({ resolution, unattended, allowPlanCommands });
  announcePlanCommands({ announce: announce && !fixing, refused, resolution });

  // Captured before the commands run: a coverage report older than this was not
  // produced by this run, and must not be read as if it were.
  const startedAt = Date.now();
  const checks = executeValidationCommands({ resolution, freshRequired, cleaned, refused, strict: harnessMode(config) === "strict" });
  const results = fixing ? [...fixing.results, ...checks] : checks;
  // A fixer proves nothing: with no check there is no green, whatever the fixers did.
  const commandsOk = checks.length > 0 && results.every((item) => item.ok);
  // Only evaluated on a green suite: a red one is already not a proof, and
  // telling someone their failing story also lacks tests is noise.
  const coverage = !commandsOk
    ? { required: false, ok: true, reason: "not evaluated (commands did not pass)", changedFiles: [], testFiles: [] }
    : skipCoverage
      ? { required: false, ok: true, skipped: true, reason: COVERAGE_SKIPPED_REASON, changedFiles: [], testFiles: [] }
      : evaluateCoverage({ storyDir, config, exemption, startedAt });

  const acceptanceCriteria = readAcceptanceCriteria(storyDir);
  // Like coverage, these two are only judged on a green suite for a single story.
  const complexity = commandsOk && !skipCoverage ? evaluateComplexity({ root: cwd, config, since: startedAt }) : null;
  const contrary = commandsOk && !skipCoverage
    ? evaluateContrarySignals({ storyDir, config, exemption, criteria: acceptanceCriteria, policyChange })
    : NO_CONTRARY;
  const { red, mutation } = extraProofs({ redAtBase, refused, cleaned, commandsOk, skipCoverage, storyDir, config, claim });
  // A claim narrows the green: the commands passing is not yet "behavior held".
  // Evaluated even on a red suite so the evidence says which promise failed;
  // a refused run executed nothing and makes no claim.
  const claimResult = evaluateClaimFor({ refused, storyDir, config, claim, resolution, commandsOk, startedAt });

  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
    provenance: captureIdentity(cwd),
    story: resolvedStory ? resolvedStory.relativePath : null,
    commandSource: resolution.source,
    commandsFound: resolution.commands.length,
    // Recorded so a later verify can recognise this proof as still applicable.
    commandsFingerprint: commandsFingerprint(runFix ? provedCommands(resolution) : resolution.commands, resolution.timeouts),
    // The floor this verdict was judged against. `.coding-flow/` is outside the
    // tree token, so without it an edit to the floor would leave a stale "ok".
    coverageFloor: resolveCoverageFloor(config),
    // The rules this verdict was computed under; a different value is a different proof.
    policyFingerprint: policyFingerprint(cwd),
    untrackedDigest: currentTreeToken(cwd) ? untrackedDigest() : null,
    storyDigest: storyDigest(storyDir),
    environment: { ...captureEnvironment(), ...(cleaned ? { cleaned: true, dropped: cleaned.dropped } : {}) },
    unattended,
    ...(refused ? { refused } : {}),
    ...(fixing ? fixingFields(fixing) : {}),
    ...withFixerStrengthened(fixerStrengthened(coverage, fixing, config)),
    ...(resolution.planFixersIgnored ? { planFixersIgnored: resolution.planFixersIgnored } : {}),
    commandsOk,
    // Which base every diff-derived signal below was measured from: a surprising
    // coverage or risk verdict is explained by this line before anything else.
    diffBase: publicDiffBase(currentDiffBase(cwd)),
    coverage,
    acceptanceCriteria,
    ...uncapturedFields(storyDir),
    // The policy the contrary-signals verdict was judged under, for the same
    // reason as `coverageFloor`: an edit to it must not leave a stale "ok".
    contraryPolicy: contraryPolicy(config),
    contrary,
    ...(claimResult ? { claim: claimResult } : {}), ...(red ? { redAtBase: red } : {}), ...(complexity ? { complexity } : {}), ...(mutation ? { mutation } : {}),
    ok: commandsOk && coverage.ok && contrary.ok && [claimResult, red, complexity, mutation].every((proof) => !proof || proof.ok),
    results,
  };
}

module.exports = {
  buildHarnessPreflight,
  checkStoryEvidence,
  commandsFingerprint,
  provedCommands,
  matchFixerStrengthened,
  findReusableVerify,
  writeVerifyEvidence,
  verifyStoryOnce,
};
