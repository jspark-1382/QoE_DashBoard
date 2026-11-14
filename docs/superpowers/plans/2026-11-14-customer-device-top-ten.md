# Customer TOP10 device column

> **For agentic workers:** Execute inline; delegate the independent raw catalog extraction.

**Goal:** Add a compact device column beside the customer number without moving existing panels or changing chart colors.

**Spec:** The approved image in this chat. Use actual source models, never its sample device names. Unknown values display `미확인`.

**Architecture:** Read a separate immutable device catalog built from the original SIP customer-side messages. Match the active source revision and customer/date/minute scope. Enrich the existing screening rows without changing call counts, sorting or the main voice database.

**Tech stack:** React/TypeScript/CSS modules, Node SQLite, Python source extraction.

## Tasks

- [x] Extract all source SIP device observations, choosing Invite for originating calls and 200OK for terminating calls; never fall back to the peer's device. Test missing/ambiguous values and keep raw identifiers out of the catalog.
- [x] Add the scope-bound read-only catalog adapter and device column. Test customer/date/minute isolation, multiple devices, missing catalogs and source-revision mismatch. Preserve the ten rows, selection, sorts and existing bars.
- [x] Build separately, check desktop and narrow layouts and selection/sort/filter behavior, publish to the existing local server, capture the applied screen and leave the server running.

## Review focus

- The same contract may use multiple devices; show the most recently observed model with a distinct additional-model count and full list on hover.
- A missing catalog or unknown device must preserve the working dashboard.
- Adding a column must not break position-based bar CSS, clip the last column, or move the right preview below the viewport.
- Keep the existing uncommitted map clustering and count-footer changes.
- Source extraction writes only a new catalog; do not rebuild or replace the original 5 GB voice database.

## Verification

- Original SIP/LTE/NR file fingerprint matches the active voice revision before and after extraction. Device evidence covers 267,604 customers; all current TOP10 rows have an observed model. iPhone generations are not inferred.
- Twelve Python extraction checks and sixteen focused reader/screening checks pass. Existing map clustering/count checks remain green. TypeScript and scoped lint checks pass.
- Browser checks pass at 1920×1200, 1707×1100 and 1366×900, including sort, selection, date filtering, unknown device fallback and long names with a visible additional-model count.
- Existing port 3001 serves the final UI; the original forwarder remains running. Live report and ranking match the pre-change baseline. Screenshots: `outputs/device-top10-release/live-1920.png` and `live-top10.png`.
