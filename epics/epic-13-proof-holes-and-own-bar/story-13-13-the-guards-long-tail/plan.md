# Plan — 13-13 The guard's long tail

## Decisions

- **Same rule as 13-09.** A form that may land a blocked path is refused when
  the guard knows it does, logged `unchecked` when it cannot tell — never a
  silent allow. The simplest robust reading wins over modelling.
- **Git plumbing.** `checkout-index` names its files (judged as writes); `-a`,
  `--all`, `--prefix`, `--stdin` write what the index holds → unchecked.
  `read-tree -u` → unchecked; without `-u` it writes only the index → allowed.
  `update-index` writes only the index → allowed (the forge needs a following
  `checkout-index`, which is judged). `clone [DIR]` and `worktree add DIR`
  make a whole directory: judged as a tree (the directory itself and what it
  holds), its source unread; a clone with no DIR lands on the repository's
  base name.
- **scp / sftp.** A local destination is read as `cp` (`-r` as `cp -r`), so
  the 13-09 tree rules apply; a remote destination writes nothing here. A bare
  `sftp HOST` or `sftp -b batch` is a session whose commands are not on the
  line → unchecked.
- **busybox.** `busybox APPLET …` is read as `APPLET …`.
- **unrar / jar / pax.** Extraction targets: `unrar x|e` into a trailing-`/`
  operand or here; `jar x` here (or `--dir`); `pax -r` here, `pax -rw … DIR`
  into DIR; `pax -s` renames → unchecked. They reuse the extraction judge
  (refused into a blocked path, else unchecked inside the project).
- **Archive members.** For `tar` (plain or gzip, detected by content) and
  `unzip`, when the archive file is named on the line and readable, the guard
  lists its members in-process (`bin/lib/archive-members.js`, no subprocess,
  `node:zlib` only) and judges where each lands. It stays unchecked when: the
  archive is stdin, another compression, zip64, damaged, over 32 MB (256 MB
  expanded) or over 10 000 members; a member is a link, device, absolute or
  `..` path; an option renames members (`--strip-components`, `--transform`,
  bsdtar `-s`, `unzip -j`); or an earlier command on the line (not a `cd`) or
  a substitution may have made the archive.
- **A strict subset, not the formats (review of 13-13).** The review forged
  five archives a lenient lister reads as benign (two pax `path=` records, a
  pax comment carrying a fake record, old GNU magic read as a ustar prefix, a
  lone zero block read past by `tar -i`, a tar with a zip appended). The
  lister now trusts only: tar with exact POSIX ustar headers (`ustar\0`+`00`),
  types regular file or directory, nothing but zeros after the first zero
  block; zip with a local header at offset 0, the central directory right
  before the end record, local names equal to central names, no duplicate
  names (case-insensitive), only timestamp/owner/NTFS extra fields, regular
  files and directories, no zip64. tar/gtar parse only tar (gzip by content),
  unzip only zip, bsdtar either subset exactly. `-i`/`--ignore-zeros` →
  unchecked. Expanded size capped at 64 MB. A directory header with a non-zero
  size (GNU tar ignores it, so a lister that skipped it missed the next header)
  and a zip name holding a NUL are outside the subset too (re-review).
- **Cost of the subset.** GNU tar's default format (`gnu`) and pax archives
  are outside it, so an archive made by a plain `tar -czf` on Linux stays
  unchecked; one made with `--format=ustar`, by `git archive`, or as a plain
  zip is judged. Trusting more is a format to model, not a check to loosen.
- **Lazy require.** The member lister is required only when an extraction is
  judged, so the guard's module graph stays at its pinned size.
- **Substitution before the copy source** was already closed by 13-09; a test
  pins it.

## Accepted limits

- Aliases, shell functions, `eval` of built strings, `IFS` games: a stateless
  hook reading text cannot model them.
- A tar extraction that names member filters is judged on every member (a
  superset): it can refuse more than it writes, never less.
