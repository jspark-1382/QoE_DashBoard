# Customer status UI implementation plan

**Goal:** Apply the approved customer status mockup while keeping existing layout, semantic colors, source values and interactions. Show the right timeline and full customer preview together on desktop.

**Design:** Approved preview `C:/Users/jae-sang/.codex/generated_images/01a1d0a6-328d-74f2-aec5-f7ff8d4553c3/exec-edc5e73b-dfd3-4d22-bea4-03054e52071b.png`.

**Architecture:** Customer-specific CSS modules scope the visual changes. Existing APIs, customer selection, AI requests, metrics, chart values and routing remain unchanged. Use the existing workspace and immutable preview deployment so the current server stays available during implementation.

**Constraints:** Keep four KPIs, then distribution / TOP 10 / criteria in three columns, then map left and timeline plus full preview right. Preserve blue/pink/orange/purple/green semantic colors. At smaller widths or short viewports allow natural scrolling rather than clipping. Long explanations use disclosures. No inference calls during verification.

- [x] Record baseline viewport failure and source/chart evidence. Preview bottom is about 1320px on the 1100px desktop viewport.
- [x] Add customer-only white navigation, compact toolbar/cards and responsive desktop grid.
- [x] Compact preview identity, tabs, daily chart and four existing metrics; keep actions and AI tab functional.
- [x] Compact timeline presentation and disclose its long caption without changing point values, colors, period controls or keyboard selection.
- [x] Run targeted component tests, typecheck and lint; build a separate immutable preview.
- [x] Check desktop viewport fit, original data, semantic colors, row selection, period/day controls, filtering/search, map fullscreen and mobile flow in browser.
- [x] Publish verified build to the existing local server, perform a final smoke check, stop only staging and keep the original server running.

**Review focus:** Narrow preview headers and long customer IDs, daily chart totals or missing data, timeline point selection and tooltips, expanded explanations/AI content, fullscreen map overlays, and responsive layouts must remain reachable without clipped text or controls. Existing unrelated working changes must be preserved. The user subsequently requested a dedicated customer UI commit, push, main merge and a further live server check.

**Verification ledger:** 27 existing component/data tests passed, targeted lint and nonincremental typecheck passed. Initial staged browser pass: 62 checks, unchanged source totals/customer values and canonical timeline coordinates/colors, no page errors or inference requests. Preview bottom was 1070/1100, 1050/1080 and 870/900 respectively. Follow-up layout checks corrected the daily-chart selector and confirmed the tenth ranking row. An 850px-high screen exposed an 11px footnote clip; the fixed viewport layout now starts at 900px and shorter desktops use natural page flow. Narrow 900px-high layouts retain legible chart labels. Final focused checks passed 57/57 including normal-scroll reachability at 850px. Published `outputs/customer-style-build-1794629721812` to the original 3001 URL. Live smoke verified the full preview at 1050/1080px, 818 timeline observations and 29 served static asset hashes against the final build. Screenshot: `outputs/customer-style-release/live-customer-status-1920.png`. Staging stopped; original customer URL returned HTTP 200 and remains running.
