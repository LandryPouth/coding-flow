# Tasks — story 10-04

- [x] `scripts/release.mjs` + `npm run release`
- [x] `doctor` warns on a version with no tag (this repository only)
- [x] `docs/contributing.md` Publishing section, CHANGELOG entry
- [x] Tests: `test/release-script.test.js`

## Backfill note

Tags stop at `v0.8.3`; `CHANGELOG.md` has sections for the versions below that were
published but never tagged or released. The script only handles the version in
`package.json`, so backfilling means checking out each commit that bumped the version
and tagging it by hand — **the maintainer decides whether it is worth doing**.

Missing: 0.8.4, 0.8.5, 0.8.6, 0.9.0, 0.10.0, 0.11.0, 0.11.1, 0.12.0, 0.12.1
(0.9.x → 0.12.1 as the story says, plus 0.8.4–0.8.6 which the CHANGELOG also lists).

```bash
git log --format='%h %s' -S'"version": "0.12.0"' -- package.json   # find the bump commit
git tag -a v0.12.0 <sha> -m "@landry_pouth/coding-flow 0.12.0" && git push origin v0.12.0
```
