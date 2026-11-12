# Server voice query implementation plan

> Execute with the subagent-driven-development workflow; backend and the two UI adapters have explicit contracts below. Keep the existing shared data workspace and current codex branch; do not move or rewrite source assets.

**Goal:** Preserve all original source data and replace bulk browser JSON loading with SQLite-backed server summaries, paged customer/call queries and on-demand locations/detail.

**Architecture:** Build an immutable, revision-checked SQLite read model from the already-published JSON, without rereading XLSX or replacing source JSON. A worker-backed local query API serves small scoped results. The main quality page uses server statistics; customer screening and contract navigation use paged queries and a selected-customer catalog. Maps and raw call details load after an explicit user action.

**Stack:** Existing Node 24 built-in SQLite/worker threads, Python SQLite builder, existing TypeScript analytics/chart/map components, local Vinext preview.

**Spec:** User explicitly requested the recommended server aggregation, summary-first opening, and lazy customer/call/map data while retaining original data.

## Constraints and review focus

- Preserve source XLSX, public raw JSON, original customer/call IDs, MOS/Drop rules and published revision `da0b8405340fe0ea2459`.
- Never truncate populations or fabricate call/location records to accelerate statistics. Pagination applies only to rows delivered to the UI.
- Full-day final minute, missing MOS, distinct customer/day counts, ambiguous links, GNSS versus BYE and rough evidence, consecutive poor calls and filtered denominators must match existing logic.
- Before the first summary is displayed, do not request voice-1030.json, analyst-overview daily bulk files, full screening data, raw details or map geometry. After the summary, visible maps load automatically (follow-up request).
- Queries must validate dates/times and bind SQL values; the worker isolates query CPU from the HTTP event loop. Cache only bounded revision-scoped results.
- Source refresh publishes a matching query index; missing/stale query data must show a useful error and cannot silently fall back to multi-GB loading.

## HTTP and module contract

- `GET /qoe/api/voice/meta` -> `{schemaVersion:'voice-query-meta-v1', sourceRevision, dataset:AnalystDataset, totalCalls, totalCustomers}`. Dataset is lightweight (dates/score/source metadata; empty customers/days). No global master or geometry payload.
- `POST /qoe/api/voice/query` accepts `{op, sourceRevision?, scope?, ...arguments}` and returns a plain JSON result with `sourceRevision`.
- Scope: `{dateStart,dateEnd,from,to,customerIds?:string[],band?:'poor'|'fair'|'good'|null,distributionMode?:'mos'|'drop',hour?:number|null,district?:string|null,evidence?:'all'|'gnss'|'estimated'|'bye-cell',cohort?:'affected'|'repeat'|'consecutive'|null,sipFilter?:string,search?:string}`.
- `summary` -> `{sourceRevision,grades,dropGrades,hourly,analytics,customerCount,mapped:{G,T,U,hourly},regions}`. Existing ProposalGradeStats/HourMosPoint/OverviewAnalytics/DistrictHotspot structures; experience customerIds are not shipped (cohort is resolved on server). Grade/hourly/customer charts use the base date/time/customer population, while mapped/regions honor map filters.
- `calls` + `{page,pageSize}` -> `{sourceRevision,rows:OverviewCall[],locations:OverviewCallLocation[],total,page,pageSize}`. Exact original IDs and records, filtered server-side. Preserve explicit grade versus default located-poor table semantics.
- `map` -> `{sourceRevision,overview:AnalystOverview}` containing only renderable selected GNSS/estimated points/calls, necessary cells/boundaries; default quality map hides BYE pins as before. Regions/full counts come from summary, not this reduced rendering projection.
- `customers` + `{query,filter:'all'|'poor'|'repeat',page,pageSize?,selectedIds?}` -> `{sourceRevision,rows:QualityCustomerRow[],total,page,pages,selection?}`. Pager is 25; source service numbers, never opaque IDs as guessed numbers. Quality-picker poor count retains original MOS criterion.
- `customer` + `{customerId? ,contract?}` -> `{sourceRevision,dataset:AnalystDataset}` with only the selected/default one customer's true metadata/day entries. Existing loadDay reads the actual referenced original detail on demand.
- `screening`, `screening-map`, `routes`: backend and screening adapter owners coordinate exact response shapes directly, reusing existing screening business functions/types. Server performs global counts/ranking/filtering; only requested page/selected customers/routes are delivered. No initial full ScreeningSource response.
- Client helper owned by root: `voiceQuery<T>(op,arguments,signal):Promise<T>` and `loadVoiceMeta(signal)` in `lib/analyst/server-query.ts`.
- Backend exports `createVoiceQueryHandler({root,publicDir?})` from `scripts/voice-query-api.cjs`; installs before public-file handling in serve-local-preview.cjs. Python builder `scripts/build_voice_query_db.py` writes immutable DB under outputs and small `public/voice-query-index.json`; data stays local.

## Tasks

- [x] Backend: fixture-first read model, query API/worker, source/revision/query validation and parity tests. Build and audit the real 1,490,033-call database.
- [x] Quality: summary-first main page, remote customer picker, paged call list, lazy map/detail, current charts/labels/links retained.
- [x] Screening/contract: server ranking and scoped counts, paged search, lazy maps/routes, one-customer catalog instead of global manifest/daily overview.
- [x] Integrate source refresh and durable launcher; run parity/regression/type/build checks and cold-browser network/load verification. Review the completed branch with fresh eyes.

## Ledger

- Baseline: global manifest 274.3 MB; one-day opening 639.4 MB; full-period opening 2,050.9 MB, plus client-wide calculations. Upstream preview process had exited; restored using the existing independent Windows service broker (not a direct terminal child).
- Ruling: introduce a local Node query API, preserving portable original artifacts and archival views; default pages use the new service and never auto-fallback to bulk data on API errors.
- Read model: immutable current DB `outputs/voice-query-data/da0b8405340fe0ea2459-2fddac61d98b5857.sqlite`, 5,204,426,752 bytes. Superseded generated DBs removed after stopping our preview; all XLSX and original public JSON retained. Full SQLite integrity and every-record source score audit passed.
- Conservation: calls 1,490,033; customers 268,182; evaluated 1,088,738; poor 9,315; affected customers 7,562; SIP Drop 2,609. Map GPS 673 + rough 426 = 1,099; related unique station positions 449.
- Browser evidence: `outputs/server-query-qa/result.json` and screenshots. Cold-cache first summary 3.8–5.8s; metadata+summary 18,979 transferred bytes; only `summary` operation before interaction, no original bulk/raw/map files or map/investigation JS. Explicit map, 20→40 call paging (including double click), 25 real customer rows, original detail, screening census and newly added customer contract all passed without runtime errors.
- Source refresh integration: query DB/index built before source publication; missing/stale stores rejected. Query/test-only changes excluded from source regeneration signature. Cached full refresh verified `already-current` and retained the validated source revision and DB.
- Independent review resolved candidate filter/state stability, repeated More clicks, ranking ties, selected-customer filter consistency and original CSV metrics/provenance. No outstanding review findings. CSV full default 7,296 rows/3,022,282 bytes in 40s; explicit original-detail reads confined to separate export worker, 214MiB peak RSS.
- Regression: complete JS suite 426/426 passed; publication/readiness Python tests 3/3; TypeScript and focused lint passed. Shared panel extraction keeps initial rendering independent of lazy map/detail modules. Build and durable preview restart verified across separate calls.
- Final service/presentation tests 28/28; existing `npm run test:analyst` passes end to end after correcting stale synthetic MOS/label fixtures (no production scoring changes). Customer-screening map code is also lazy; its opening has zero map JS/geometry requests. Final built-preview browser rerun passed initial summary, paging, customer picker, screening and contract detail with no console exceptions.

### Follow-up: automatic maps

The user asked to avoid pressing a map button. Quality and customer-screening maps now start automatically after their summary has appeared and the map area enters the viewport. Offscreen maps remain deferred. Shared visibility handling disconnects observers and cancels pending work on unmount; unsupported intersection observers fall back to loading after paint. Only a failed map shows a retry button. Original detail/call-list loading remains on demand.

Verified: 14 focused visibility/presentation/UI tests, TypeScript, focused lint and local build pass. Browser evidence `outputs/auto-map-qa/result.json`: offscreen quality page requests summary only; scrolling loads exactly one map query with no button; customer-screening requests summary followed by its map without a click; zero bulk-source requests and zero runtime errors. Durable preview restarted with the new build.

### Follow-up: preserve the reference UI

The user supplied the original screen and rejected presentation changes made during optimization. Restored its existing CSS and markup conventions: dark headline values, red poor/location values, QoE-evaluated and same-grade location coverage badges, original icons, GPS/rough breakdown styling, selected full-period appearance, analysis-basis label and applied filter chips. Map titles use the same panel-heading typography and help icon as other panels; all/GPS/rough/station/fullscreen controls are back inside the map's top-right heading in their original order. Ranking bars, sort label and legend also restored. Actual source counts, query endpoints, raw data and automatic map loading are unchanged. Station visibility now persists when map filters reload.

Verification: ratio/heading tests witnessed failure then passed; 22 targeted tests and 34 service/presentation tests pass, TypeScript/lint/build pass. Browser `outputs/reference-ui-qa/result.json` checks actual values/colors, matching 15px/790 map title typography, header control order/containment, both badges, ranking bars, GPS/rough filtering, persistent station choice and fullscreen. Zero bulk source requests or runtime errors. Screenshot `outputs/reference-ui-qa/restored-quality-overview.png` visually checked against the user reference; durable local preview updated.

### Follow-up: station layers default OFF, loaded on activation

Quality and candidate maps still load automatically. Quality-map clients request `includeStations:false`: handset positions/evidence remain identical while optional GPS/rough/BYE station coordinates are omitted. A small station count keeps the existing button showing 449 positions. The new scope/revision-bound `map-stations` query returns all station RU/Cell rows plus per-call references only on activation. A bounded client cache reuses results, and disabled/different-scope requests cannot leak late stations. Candidate maps select the existing hidden option by default and fetch no LTE/NR catalog until enabled. No control order, CSS layout, model definition, original source or aggregate count changed. Detailed raw analysis evidence remains available in its original explicit detail views.

Single-point BYE/rough overlays now respect `showStations`; delayed data arrival performs the correct station refit. Verification: full 464/464 tests, TypeScript, scoped lint/build, peer review with no material findings. Browser `outputs/stations-on-demand-qa/result.json`: quality initial 1,099 locations / count449, no station coordinates, no station query and zero station icons; ON makes one query and renders449 positions; OFF/re-ON reuses loaded data. Candidate initial rangeoff, zero catalog requests/icons; ON fetches onlyLTE once and renders211 selected-region positions; OFF/re-ON reuses it. No runtime/API errors. Six-model roundtrip retains original counts with zero station catalog downloads while OFF (`outputs/candidate-profile/stations-off.json`). Validated source refresh remains already-current; no original regeneration required.
