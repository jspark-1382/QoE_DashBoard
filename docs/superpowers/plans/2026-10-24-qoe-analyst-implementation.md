# QoE Analyst Workspace Implementation Plan

> Use subagent-driven development with independent file ownership and integration review. The user approved development of the design on 2026-10-24.

**Goal:** Ship the approved quality overview and contract/call analyst workspace against actual local data.
**Architecture:** A separate analyst domain adapts both inline and partitioned source data. Prebuilt day summaries supply overview calls/grids; a single selected day supplies detail. A scoped CSS module isolates the new workspace from Engineering/Inbuilding. Selection uses explicit view/customer/call/sample state and restores overview investigation filters.
**Tech stack:** Existing React, TypeScript, Leaflet, Vite/vinext; standard Node/Python only for local generated data.
**Spec:** `docs/superpowers/specs/2026-10-24-qoe-analyst-ui-design.md`

## Constraints and rulings
- Continue in the current checkout so ignored source datasets, 10,250 detail partitions, and the local app remain usable; use a feature branch, preserve the existing stash and untracked design.
- No publishing, push, destructive reset or original workbook mutation. Keep opaque URL/customer/call IDs and the exact source contract string.
- New UI uses `lib/analyst/types.ts`; legacy Engineering/executive types need not become nullable solely for the new workspace.
- One poor rule: finite call QoE `< meta.poorQoeThreshold` (default 2.5), evaluated-call denominator; no synthesized MOS or remediation state.
- GNSS coordinates remain untouched. Never copy a station anchor into a UE point. Reuse the existing radio estimator only within each call, with source labels and a single-site no-point guard.
- Overview is generated one day at a time without loading all partitions into the browser. Spatial denominator uses unique evaluated calls per common 60m grid; global totals de-duplicate calls.

## Review focus
- No-event/unscored calls and zero-valued radio measurements survive adaptation.
- Inline legacy and partitioned MDT select the same records and preserve leading-zero contracts.
- Aborted or late fetches cannot replace the active customer or source.
- No call/customer/day bridging in locations, paths or plots; unknown location stays selectable outside the map.
- URL/deep-link/back-to-overview restores selection and investigation filters; map pan does not silently filter the global population.

## Tasks and ownership
- [x] Domain/data: `lib/analyst/data.ts`, `overview.ts`, `data-loader.ts`, `scripts/build-analyst-overview.cjs`, domain/builder regression tests. Interfaces in shared `types.ts`; preserve atomic publication and summary revision checks.
- [x] Contract UI: `components/analyst/contract-workspace.tsx`, `radio-timeline.tsx`, `observation-details.tsx`, associated CSS module. Source/day/call/sample props, one call list, original-unit charts and evidence.
- [x] Overview UI: `components/analyst/quality-overview.tsx`, associated CSS module. Pure overview model, global scope vs selected region/hour, pagination, missing-location list, map props and call drill-down.
- [x] Integration/map: new scoped shell in `analyst-dashboard.tsx`, `components/analyst/analyst-map.tsx`, shared styles, selection/URL helpers, source/contract search and abort-safe loads.
- [x] Validation/review: regression suite, actual data totals, type/lint/build, 1920/1366 browser screenshots and end-to-end investigation/detail/back flows; independent whole-change review and repairs.

Each domain task first adds an observable failing regression, then implements and runs its checks. Browser checks cover visual-only and cross-component behaviors. Record actual results below; do not mark completion from agent reports alone.

## Progress ledger
- 2026-10-24: Design and two image mockups accepted for development. Existing code is main 114831d; only design/spec and ignored dataset files are untracked. Source contract/EPSG:5179 partitions already exist locally but current main does not load them.
- Ruling: Preserve the previous Executive components and route `app/page.tsx` to a new `AnalystDashboard`; this keeps the new scoped workflow separate and reduces unintended changes to legacy components.
- Ruling: Restore only the tested v2 ingestion modules from the existing backup as the canonical `data:mdt` path. Keep the newer merged/affine pipeline intact as an explicit legacy comparison command. This avoids losing independent/no-MDT calls or original contract strings on the next refresh.
- Domain/data complete: current MDT reconciles 10,250 contracts, 25,548 calls, 23,085 evaluated, 2,463 unscored, 1,971 no-MDT calls, 2,583 poor, 1,829 located poor and 754 unlocated poor. Overview has 7,864 common 60m cells; global totals are not sums of grid membership.
- Independent review repaired: map renderer lifetime; map unmount event guard; unknown GNSS provenance; unversioned inline summary freshness; explicit empty contract-view URL restoration.
- Browser acceptance: actual Edge, 1920×1080 and 1366×768; overview makes zero customer-partition requests; grid→call→back restores filters; hour investigation keeps global denominator; original contract search; GNSS evidence; original sample indices; renderer count stable; delayed old customer response rejected; no-event call; measured source. Browser errors: 0. Captures in ignored `outputs/analyst-ui/browser`.

- Final verification passed: analyst regression suite; actual dataset reconciliation; location estimation 15 groups; Python 47 tests; TypeScript without incremental output; scoped type-aware lint; product build. Final browser acceptance returned zero errors. Data refresh orchestration includes overview regeneration.
