# 5G Inventory Integration Plan

**Goal:** Add the supplied 5G workbook to the existing station search and map while preserving LTE customer analysis.

**Source:** `data/BaseStation/수도권_5G_261106.xlsx`; single sheet with `ru_id, cell_id, pci, latitude, longitude`. Audit found76161 rows,75629 valid unique RU+Cell identities,532 missingCell/PCI rows, and1008 distinct valid NR PCIs. LTE/NR share45 Cell IDs, so radio technology is part of inventory identity.

**Architecture:** Keep original LTE `station-catalog.json` and its observed PCI audit. Add independent `nr-station-catalog.json` with schema`nr-station-catalog-v1`, technology`NR`, original-source hash/date and six-column rows. The existing page switches between LTE/5G, uses the correct PCI range and source file, and displays the selected registered site. Current source MDT is LTE; no 5G customer or observed-PCI joins are inferred from inventory alone.

## Tasks

- [x] Read and audit new workbook, duplicates, missingness and LTE identity overlap.
- [x] Add standalone NR reader/builder with exact identities, coordinate validation, PCI0..1007, conflict handling, atomic output and fixture tests.
- [x] Extend TS catalog validation/filtering/map record technology with backwards-compatible LTE support and tests.
- [x] Add LTE/5G selector, RAT-aware labels/search/PCI bounds, registered map popup and clear observed-data scope.
- [x] Generate NR sidecar in staging, validate against source and real TS reader, publish only NR file atomically. Leave original LTE data revision and files unchanged.
- [x] Run appropriate station/customer/proposal tests, type/lint and independent review; local UI build, atomic activation and browser-check NR search, PCI>503 and selected map.

## Constraints and review focus

No source workbook modifications, guessed Cell IDs, PCI-only joins, RAT-crossed BYE fallbacks, or LTE data regeneration. Keep valid PCI0 and string identifiers intact. A missing NR file should give retry feedback without blocking LTE. Switching technologies must clear stale selection/query/page and prevent an aborted fetch updating the wrong technology. Preserve all existing WIP and multi-customer/fullscreen features; no commit/push requested.

NR PCI range reference: [ETSI TS138211, section7.4.2.1](https://www.etsi.org/deliver/etsi_TS/138200_138299/138211/18.08.00_60/ts_138211v180800p.pdf).

## Verification record

- Station tests passed:23 TS/UI/PCI +22 Python (8 LTE,4 LTEexport,10 NR). Customer/map33 and proposal15 passed; TypeScript, scoped oxlint and diff checks passed. Independent read-only review passed.
- Real source SHA2564477d53c572707d88df28e96c8c8dae75843d8230cd9b81823cbe73c3c9d1204 verified before/after parsing and against staged JSON. Published only NR sidecar atomically. Original LTE catalog and voice manifest hashes matched the pre-change baseline; no LTE customer data regeneration.
- Local build passed; prepared UI activation succeeded2026-11-06T19:52:32. Original customer/map features remain included.
- Live UI: NR registration totals, excluded rows and distinct PCI counts matched source-derived summaries. PCI 0/1007 and out-of-range 1008 searches were verified. Selecting a validation row showed the registered site and matching source filename. Switching LTE cleared search/PCI, restored LTE summaries and the 0~503 placeholder. Browser console errors were empty.
- Screenshots saved under outputs/analyst-ui/nr-station-pci-20261106.jpg and nr-station-page-20261106.jpg. Existing quality tab state preserved; new station tab kept as deliverable. No viewport override, commit, push or merge.
- Minor documented convention:invalidRows describes invalid input identity/coordinate rows; coordinate-conflict pairs are rejected by the loader but not separately shown in the inherited summary. This actual workbook has zero coordinate conflicts.
