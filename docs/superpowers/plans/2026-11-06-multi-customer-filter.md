# Multi-customer Filter Implementation Plan

> **For agentic workers:** Execute the approved user request in the current session with independent ownership of picker and host files. Preserve existing WIP; no commit/push requested.

**Goal:** Select multiple original customer numbers, apply them, and investigate only those customers across the quality overview.

**Architecture:** The parent owns applied customer IDs. The drawer edits a draft independently of search, paging, and list filters, then explicitly applies it. A pure overview scoping helper filters calls, locations, and cell membership before the existing KPI/chart/map pipeline. The drawer always reads the unfiltered overview so users can add customers.

**Tech Stack:** Existing React/TypeScript, native dialog, Leaflet; no dependencies or data rebuild.

**Spec:** User request in this chat: multi-select customer picker and filter the map and related view by the applied customers.

## Global Constraints

- Preserve original customer identifiers and leading zeros; use opaque IDs internally.
- Empty applied ID list means all customers. Nonempty IDs with no matching calls must show zero results, never all customers.
- Keep applied IDs through date/time changes; do not silently broaden the scope. Reopen restores the current applied selection, while closing without applying cancels draft edits.
- Apply resets map/detail drilldowns to avoid invisible intersections and switches to current quality mode.
- Improvement candidates are a precomputed full-population report with truncated representative membership; disable candidate-mode entry while customer scope is active and show why.
- Preserve all unrelated PCI/launcher changes, source data, MOS and fullscreen map behavior. No commit, push, merge, or dependency installation.

## Review Focus

- Selecting across searches and pages must retain every draft ID until explicitly removed.
- Cancel/Escape must leave applied scope unchanged.
- A selected customer with no locations remains in totals and has an empty map.
- Date/time changes with no selected calls must remain empty and allow clear recovery.
- Cohort, hour, evidence, MOS grade, Drop, district and CSV must not introduce another customer's calls.

### Task 1: Multi-select drawer

- [x] Add controlled `selectedCustomerIds: readonly string[]` and `onApplyCustomerIds(ids: string[]): void`.
- [x] Add checkbox toggles, persistent draft count/summary, page selection and clear actions. Keep draft across query, filter and page changes.
- [x] Explicitly apply the draft or return to all customers; retain single-customer source analysis link.
- [x] Verify helper and actual component behavior with `node --test scripts/tests/quality-customer-picker.test.cjs`.

### Task 2: Applied overview scope

- [x] Add `scopeOverviewToCustomers(overview, ids)` in `lib/analyst/customer-overview-scope.ts`; filter calls/locations/cell membership immutably. Test multi-ID unions, unknown/empty IDs, unlocated calls and unchanged source.
- [x] Integrate into quality host metrics/hourly/analytics, rough overlay, Drop map/table and cohort pipeline. Keep picker input unfiltered.
- [x] Add active customer scope banner, clear action, unavailable-in-period counts, map focus refresh and candidate-mode explanation.
- [x] Run focused tests, existing proposal/customer-map/analyst checks, types/lint, independent review.

### Task 3: Live verification

- [x] Build in existing isolated stage and activate UI only with rollback.
- [x] Browser-check multi-select/apply, scope counts/map, reopening/cancel, clearing and fullscreen retention. Save screenshot.
- [x] Update feature usage notes and report verified result.

## Verification record

Customer/map33, proposal15, improved5, full analyst suite, final TypeScript, scoped oxlint and diff whitespace checks passed. Independent read-only feature review passed. Local build succeeded; UI-only deployment succeeded at 2026-11-06T14:26:42. The Windows PowerShell5 deployment helper's old UTF-8 text sentinel was replaced with an ASCII HTML marker after a pre-execution parser error; no live change occurred on that failed attempt.

Live browser: two anonymous validation customers gave total10/evaluated9/poor5/mean3.02/map2 (개포1동1, 개포2동1), matching original-source calculations. Search/page/filter retention, Escape cancellation, reopening, selected-only list, all-customer recovery37731/poor288, candidate entry gating/re-enable, selected MOS grade including5 low-MOS CDRs (3 without mapped locations), date change preserving2 selected IDs (10/29 total3 with1 absent customer), empty time window0, and fullscreen2-location map verified. Dialog cleanup restored scrolling; console errors were empty. IAB time-input fill changes the DOM without React change notification, so the empty/restored time-window checks used native arrow keys to commit values. No product change was required for this automation behavior.

Screenshots: `outputs/analyst-ui/customer-multi-select-20261106.jpg`, `outputs/analyst-ui/customer-filtered-map-20261106.jpg`. Source revision remains5dff1360d6614cc8d361. No data rebuild, commit, push or merge.
