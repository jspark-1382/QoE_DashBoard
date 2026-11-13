# Selected Customer QoE Timeline Implementation Plan

> **For agentic workers:** Use test-first implementation and independently review the final change. Execute the approved UI without another approval round.

**Goal:** Replace the four-customer comparison with the approved selected-customer call-level QoE line chart.

**Architecture:** A compact, indexed single-customer query returns all scoped calls, including unscored and unlocated calls. A separate React panel renders one observation per call, a QoE 3 threshold, Drop symbols, unscored strip, day zoom, and a raw-call detail link. Point selection focuses the existing map when original location evidence exists.

**Tech Stack:** Existing React/TypeScript, SVG, CSS modules, Node SQLite query worker and node:test; no new dependencies.

**Spec:** User-approved chat and UI mockup `exec-7cf9373f-f390-4e75-9a3d-88e42be3e89c.png` (2026-11-13). This plan records implementation choices for that approved small change.

## Global Constraints

- Preserve existing dirty workspace edits and original source data, scoring, thresholds, TOP10 and lower customer preview.
- Work in the current feature checkout: it contains the live accepted UI and substantial existing uncommitted work. Do not move, reset, commit unrelated edits, create a separate checkout or request approval again.
- Timeline respects customer/date/time and selected region/cell; no TOP10-only or location-only sampling.
- Use stored QoE unchanged; support negative Drop-adjusted QoE. Null is not zero.
- Break lines at missing values and day boundaries; use unsmoothed observation connectors, not continuous measurement claims.
- Keep region selection reset available, loading/error/empty states, keyboard selection, narrow layouts, and the existing detail route.

## Interfaces

- `CustomerQoeCall`: `{id,rawCallId,date,start,startSecond,qoe:number|null,drop:boolean,cell,location:{lat,lon,evidence:'gnss'|'bye-cell'}|null}`.
- `CustomerQoeTimeline`: `{sourceRevision,customerId,calls:CustomerQoeCall[]}`.
- `loadCustomerQoeTimeline({customerId,sourceRevision,scope,areaId?,cellId?}, signal?)` calls `customer-qoe-timeline` through the existing query client.
- `CustomerQoeTimelinePanel`: `{customer:ScreeningRow|null,scope,sourceRevision,dates,areaId?,cellId?,selectedRegion?,onClearRegion?,onSelectCall?:(call:CustomerQoeCall|null)=>void,pending?:boolean}`.
- Existing map gains optional `focusedCall:CustomerQoeCall|null`; it only focuses actual supplied coordinates and labels their evidence.

## Review Focus

1. Full call conservation for more than 1,000 calls, null/negative QoE and no location.
2. Fast customer/scope changes must not display or select stale data.
3. Region/cell selection agrees with existing scoped preview and remains clearable.
4. Graph geometry, duplicate timestamps, keyboard selection, tooltip and unscored Drop marks remain usable.
5. Map selection preserves GPS versus BYE reference provenance and never invents locations.

## Tasks

### Task 1: Compact timeline query and client adapter

Files: `scripts/voice-query-screening.cjs`, `scripts/voice-query-engine.cjs`, `lib/analyst/customer-qoe-timeline.ts`, new focused query tests.

- [x] Write and run failing tests for full scoped population, >1,000 calls, stable chronological ordering, zero/null/negative QoE, region/cell filtering and original location provenance.
- [x] Implement the compact query and typed adapter without changing other query results.
- [x] Run relevant query/cache tests and review Task 1.

### Task 2: Timeline panel and chart

Files: `components/analyst/customer-qoe-timeline.tsx`, `components/analyst/customer-qoe-timeline.module.css`, optional focused graph helper, new behavioral tests.

- [x] Write and run failing tests for rendered observed points, threshold, negative range, null strip, gaps and detail links.
- [x] Implement the approved panel, date zoom, point and keyboard selection, tooltip and scoped fetch cancellation.
- [x] Verify rendered behavior and review Task 2.

### Task 3: Dashboard/map integration and verification

Files: `components/analyst/customer-screening-dashboard.tsx`, `components/analyst/customer-screening-map.tsx`, scoped integration and browser QA.

- [x] Record focused baseline tests; add failing integration checks for replacement and map focus.
- [x] Replace only comparison UI; keep region clear and existing preview. Connect chart-selected call to the existing map using its supplied original location.
- [x] Run targeted tests, TypeScript, scoped lint, production build and browser interaction checks at desktop/narrow widths.
- [x] Independent final review; fix important findings and record evidence here.

## Progress / rulings

- Approved execution: user said "좋아 진행 해줘" after reviewing the line-chart UI.
- Ruling: use a compact query instead of paginated call JSON because this prevents missing-date fallback and avoids loading unused call/location payloads. Original call values remain unchanged.
- Ruling: retain the dirty feature checkout and leave git history unchanged; this is an implementation task, not an integration/publish request.
- Independent review fixed: completed request keys accept filtered fallback customers; selecting a default customer's point avoids a redundant screening request; one roving tab stop reaches the selected detail link; tied points keep their true x coordinate; original fractional clocks resolve same-second ordering; map date changes clear incompatible point focus.
- Baseline: 27/27 targeted existing tests passed (localhost HTTP test needs normal network permissions).
- Final automated verification: 35/35 timeline/query/preview/map-location tests and 64/64 existing voice-query tests. TypeScript and scoped new/integration lint passed; existing map file retains pre-existing lint findings in its older effects and HTML formatter, unrelated to new focus logic.
- Production build: `outputs/runtime-node-24.22.2/node.exe node_modules/vinext/dist/cli.js build --mode local-preview` passed. The initial analysis phase was CPU-active; rebuilding did not require data regeneration.
- Browser QA at 1600x1000 and 768x1000: 818/818 calls conserved, exact QoE/Drop, day zoom, customer replacement/filter fallback, raw detail URL, keyboard detail navigation, original map focus/date clearing and retry passed, zero runtime exceptions. Evidence: `outputs/customer-qoe-timeline-qa/result.json`, `desktop-selected-call.png`, `narrow.png`.
- Delivery: validated immutable build `outputs/customer-qoe-timeline-release-1794554498736` now serves the existing port 3014 behind `http://127.0.0.1:3001/qoe/customer-screening`. Repeated full browser QA on the existing user URL passed all checks with zero runtime exceptions. Previous preview record retained in `outputs/customer-qoe-timeline-previous-preview.json`.
- User correction: the displayed QoE axis is fixed at minimum 1 and maximum 5, with integer ticks. Original out-of-range observations remain selectable at marked boundaries and retain actual values in details; null observations remain separate. Boundary-adjacent values such as 0.999 and 5.001 retain enough displayed precision to avoid rounding into the visible range. Regression tests observed RED, then 19/19 relevant tests passed after correction.
- Fixed-axis verification: TypeScript, scoped lint and production build passed; independent focused review found no important issues. Full browser checks at both verification and existing user URL confirmed `qoeAxis:[1,5]`, all 818 calls, day zoom and existing interactions, zero exceptions. Updated live release: `outputs/customer-qoe-axis-release-1794555834137`; previous preview metadata: `outputs/customer-qoe-axis-previous-preview.json`.
