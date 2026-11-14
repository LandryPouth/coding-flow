# Plan — 13-14 a deletion is a structural signal

## Decisions

- **Same call shapes as the existing signals.** `git rm` and `git clean` are
  read through the project's `git(…, [...])` helper shape the other
  structural signals use (with or without a leading `root` argument, which
  covers 17-01's `git(["rm", "-r", "-q", "--", rel])`). A raw
  `execFileSync("git", ["rm", …])` is not read, like the existing signals —
  widening every signal to every spawn shape is a separate change.
- **Recursive deletes need `recursive: true` in the call.** `rmSync`,
  `rmdirSync` and `rm` (`fs.promises.rm`) count only when the call's own
  balanced-paren span sets `recursive: true` (review P2-1: a regex running
  past the call could borrow it from the next call when no semicolon
  separates them); a single-file
  `fs.rmSync(f, { force: true })` or `unlinkSync` stays low. Words that end
  in `rm` (`confirm`, `transform`) never match (word boundary).
- **The `allowFail` guard applies to every signal**, deletions included: a
  guarded `git(…, ["rm", …], { allowFail: true })` keeps today's score. A
  file-system delete has no such guard, so it is always flagged.
- **The level stays `high`**, as for every structural signal (the criterion
  asks for at least `medium`).
- **Comment lines are skipped** (`//`, `/*`, ` *`): a call named in a
  comment is not a call (review P2-1).
- **Accepted misses (review):** options passed by variable
  (`fs.rmSync(dir, opts)`), `execFileSync("git", ["rm", …])`, `git -C dir rm`,
  the regex cost on very long lines, and `allowFail` exempting deletions as
  criterion 2 asks — for a follow-up.
