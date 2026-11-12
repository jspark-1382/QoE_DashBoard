# Additional MDT sources implementation plan

**Goal:** Use all six additional workbooks together with the two existing workbooks throughout the voice dashboard.

**Architecture:** Discover compatible source workbooks deterministically, stream CDR columns, retain original customer/call identities, and audit cross-file duplicates. Rebuild every revision-bound UI dataset from the combined sources using the existing location and QoE rules.

**Tech stack:** Python XLSX ingestion, existing TypeScript analytics and Node exporters, Next.js static preview.

**Spec:** User request in this conversation: include the six added files in the UI.

## Constraints and review focus

- Preserve every source workbook and all existing CDR legs; remove only exact duplicates across different source files.
- Ignore Excel lock files; fail on incompatible source schemas.
- Keep CDR RTCP MOS(v5) as the score authority; missing MDT rtcp_mos is allowed.
- Keep unmatched/ambiguous MDT explicit and avoid fabricated locations or radio measurements.
- Publish matching revisions for customer screening, overview, route detail, stations and candidate/model assets.

## Tasks

- [x] Add fixture tests for multiple sources, projected XLSX date/identifier handling, duplicate CDR legs, optional MDT MOS and merged MDT evidence.
- [x] Implement streaming multi-file ingestion, source provenance and audited counts; verify fixtures and the existing builder tests.
- [x] Regenerate combined source partitions and all UI-derived assets; remove hardcoded old revision/count assumptions from builders where necessary.
- [x] Verify source census, source/revision consistency, TypeScript/build and affected tests; check the visible UI and record measured results.

## Decisions

- Execute inline; the request authorizes local data/UI updates and does not request a new commit or remote publication.
- New MDT workbook now contains a single primary sheet with populated service-contract IDs and no rtcp_mos column.
- Large inputs require streaming and bounded lookups; original workbooks remain read-only.
- Existing-data regression run: 394 Node tests passed; TypeScript and local app build passed.
- New/matching Python fixtures: 25 passed, including malformed timestamps, duplicate multiplicity, non-displayed columns, workbook epoch, MDT event overlap, exact coverage merging, cache recovery, strict reviewed-radio positions and reversible local publication.
- Fresh code review found and fixed report-cache recovery and reviewed-radio conservation gaps; selected inventory environment values now participate in the refresh cache signature.
- Ruling: work stays in the shared source-data workspace on `codex/include-additional-mdt-sources`; moving large private input/output trees into another checkout would interrupt the existing local preview.
- Ruling: full single-day CDR reports prove evidence census; multi-day candidate reports retain linked evidence with exact aggregate coverage, avoiding fifteen copies of every unmatched CDR.
- Real source ingest: 1,490,299 CDR input rows; 246 outside selected dates and 20 cross-file duplicates; 1,490,033 retained calls. MDT input 711,196 rows, with 2,201 overlapping eligible events removed across source files; 10,115 uniquely matched CDR calls.
- Published revision `da0b8405340fe0ea2459`: 268,182 customers, 522,378 customer/day detail files, 1,088,738 scored calls, 9,315 derived-poor calls, 2,609 SIP Drops. Customer-screening poor cohort: 7,562 customers.
- Final verification: 396 historical Node regressions, two mandatory active-source/fixture-routing checks and 25 Python fixtures passed; TypeScript and local UI build passed. Source revision was independently recomputed from all eight unchanged workbooks and both inventory files.
- Browser verification: complete five-day quality totals, screening TOP10 table/map, all ten route ranks with 944 observations, six algorithms and new-area candidates, and a customer absent from the old cohort with nine real GNSS observations and a working call-detail map. No page exceptions in the successful run.
- Large-source loading now parses dates sequentially, preserves already-derived call objects and reuses scored calls. Final refresh signature was rechecked; unchanged `npm run data:all` returns `already-current`.
- Historical private numerical fixtures are explicit optional prerequisites on fresh machines; the active expanded-source census is mandatory independently of those fixtures.
