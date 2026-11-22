# Story 21-02 — A vault keeps what every project learned

> **Ready (2026-11-12).** The maintainer's vault is `~/dev/.ai-memory-vault`
> — a fixed path, its own private git repository, already scaffolded with the
> layout below plus human zones (`Home.md`, `inbox/`, `preferences/`,
> `_templates/`) and an agent contract (`AGENTS.md`). The end-to-end check is
> `ai-flow vault init ~/dev/.ai-memory-vault --adopt`.

## User Value

Every project Coding Flow runs on writes what it learned — insights, epic
reports, a sanitized slice of its events — into one Markdown vault the
maintainer owns, readable in Obsidian, so the tool can later learn across
bethl, ai-learn, coding-flow and the projects to come, until it is mature
enough for a real backend.

## Requirements

- `ai-flow vault init <absolute path>`: records the path in the user's global
  config (`~/.config/coding-flow/config.json` or the existing global config
  location), creates the layout if absent, writes `coding-flow/README.md`
  (index and what each folder holds) only when missing. Refuses a relative
  path, a path inside another repository's working tree (a vault that is the
  root of its own repository is accepted — the maintainer's is), and a
  non-empty folder without `coding-flow/` unless `--adopt`. `--adopt` keeps
  every existing file and only adds what is missing.
- The CLI writes only under `coding-flow/` and never touches the human zones
  (`Home.md`, `inbox/`, `preferences/`, `_templates/`, `AGENTS.md`). It never
  runs git in the vault: committing and pushing are the maintainer's (the
  vault's own hook pushes each commit).
- `ai-flow vault status`: path, project alias, last export, counts.
- Layout (Obsidian-compatible: YAML frontmatter, `[[wikilinks]]`, one note per
  subject):
  - `coding-flow/projects/<alias>/insights/<date>.md`
  - `coding-flow/projects/<alias>/epics/<epic>.md` (the 20-07 report)
  - `coding-flow/projects/<alias>/events/<yyyy-mm>.jsonl` (sanitized)
  - `coding-flow/patterns/`, `proposals/`, `experiments/` (epic 23),
    `playbooks/` (epic 22).
  - `preferences/<topic>.md` — human-owned, read by 22-06, never written.
- `bin/lib/vault.js` is the only writer (storage seam): `vault.write(kind,
  subject, content)`; callers never touch paths.
- Export points: `insights --export`, the end of a driven run (20-07), and
  `ai-flow vault export` (manual).
- Sanitization (allowlist, not blocklist): only repo-relative paths, metric
  values, categories, ids, story/epic slugs and titles, short finding titles.
  No source, command output, transcript text, env values, absolute paths,
  hostnames or usernames. Every payload passes the existing secret detector;
  a hit refuses that export and names the field.
- Project alias: default directory name; `config.json` `vault.alias`.
- Absent vault: every export prints one line ("no vault configured — `ai-flow
  vault init <path>`") and succeeds.
- One way: nothing in a run reads the vault (epic 22-02 reads it only through
  a sanitized, quoted, explicitly requested search).

## Acceptance Criteria

- [ ] Given `vault init` with a relative path or a path inside another
      repository's working tree, then it refuses; given a folder that is the
      root of its own repository, then it is accepted.
- [ ] Given an already scaffolded vault, when `vault init --adopt` runs, then
      no existing file changes and only missing folders are added.
- [ ] Given a fresh empty folder, when `vault init` runs, then the layout and
      `README.md` exist and the global config records the path.
- [ ] Given an events export containing a command's output or an absolute
      path, then those fields are absent from the vault file.
- [ ] Given a payload where the secret detector fires, then that export is
      refused, the field is named, and nothing is written.
- [ ] Given no vault configured, when a driven run ends, then the run succeeds
      and prints the one-line hint.
- [ ] Given the maintainer's real vault path (manual, recorded in `## Result`),
      when `vault init` and `insights --export` run on coding-flow and bethl,
      then both projects' notes open in Obsidian with working links.

## Edge Cases

- Two projects with the same directory name: the second `init`/export refuses
  until `vault.alias` differs.
- The vault on a synced drive (OneDrive, iCloud): writes are temp + rename;
  partial files are never left.
- WSL: a Windows path (`C:\…`) is refused with the `/mnt/c/…` equivalent
  suggested.

## Out of Scope

- Any backend, upload, or sync; reading across projects (21-03).

## Security

- **Leaving the repo**: the only data that leaves the project; allowlist plus
  secret detector; refused on doubt (fail closed).
- **Path**: absolute, outside any repo, never derived from repo content; the
  config holding it is the user's, not committed.
- **Poisoning**: the vault is never an input to a run (one way); 22-02's
  search quotes results as data.
- **Privacy**: project alias instead of path; no usernames or hostnames.
