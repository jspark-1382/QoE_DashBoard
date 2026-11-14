# Local code optimization and artifact cleanup

**Goal:** Reduce unnecessary rendering work and remove verified disposable local artifacts without changing the UI, calculations, stored analyses or running service.

**Protected:** All private source data and generated query databases, `public`, root `dist` required by the launcher, active immutable UI build, one rollback UI build, Node runtime, saved three-result analysis history, published regression fixtures, Git history and junction targets. Preserve the existing local `tsconfig.tsbuildinfo` file while excluding this generated cache from version control.

- [x] Inventory physical files without following Windows reparse points; validate current process and active-build references.
- [x] Measure repeated timeline geometry work during real browser hovers before optimization.
- [x] Memoize timeline geometry by its actual inputs; remove unused POT JSX builders and their exclusive styles.
- [x] Ignore and untrack the generated TypeScript cache without deleting its local contents.
- [x] Validate every cleanup target as an absolute in-workspace path, reject reparse points and active references, then remove only listed old builds and disposable test-browser profiles.
- [x] Run semantic tests/typecheck, compare browser values/colors/selection and the hover calculation count, then promote the optimized build while preserving the existing server.
- [x] Record reclaimed file bytes and verify unchanged saved-analysis/database fingerprints and server health.

**Evidence:** `outputs/cleanup-audit/` contains the reviewed manifests, protected paths, process snapshots, before/after performance evidence and cleanup receipt. Cleanup does not classify historical tests, backups, documentation or user datasets as garbage merely because they are old.

**Result:** The user explicitly approved permanent deletion of the reviewed 102 folders after automatic review requested this concrete scope. Removed 37 old builds and 65 disposable test-browser profiles, totaling 6,094,577,078 file bytes, with zero cleanup errors. The 59 saved analysis JSON files retain their exact SHA-256 hashes; the source query index and 5,262,876,672-byte database are unchanged. No junctions or their targets were deleted.

**Optimization verification:** 51 existing semantic tests, targeted lint and the nonincremental typecheck passed. For 818 calls and ten hover cycles, date parsing fell from 17,220 calls to zero while the full chart series/coordinates/colors SHA-256 and all ten tooltips remained identical. The optimized immutable build `outputs/cleanup-opt-build-1794632017205` was verified at the existing 3001 address. Live UI verification matched 29 asset hashes and showed the full preview at 1050/1080px. Staging was stopped; the original server returned HTTP 200 and remains running. The user subsequently requested committing, pushing and merging these changes into main, followed by another live check of the merged version.
