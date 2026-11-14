# Customer/call analysis UI implementation plan

**Goal:** Apply the approved customer/call analysis mockup while preserving the existing three-column layout, source values, chart colors and interactions.

**Design:** Approved image `C:/Users/jae-sang/.codex/generated_images/01a1d0a6-328d-74f2-aec5-f7ff8d4553c3/exec-7568f4a4-92de-4ee6-9b26-6d822990375b.png`.

**Architecture:** Scope the page chrome to the contract view in AnalystDashboard. ContractWorkspace, ObservationDetails and RadioTimeline keep their existing data and selection behavior. The shared MosCallInvestigation receives an optional compact presentation so other screens retain their current appearance. Build and verify a separate immutable preview before updating the running local server.

**Constraints:** Preserve left call list, center map / QoE evidence / radio timeline, and right selected observation. Keep slate radio traces #697c92, blue selection #2459A6, and existing map source and warning colors. Keep missing data explicit, raw loss units unchanged, and long evidence available through disclosures. No analysis requests, server shutdown, changes to source data or unrelated pages.

- [x] Inspect the approved mockup, current styles, source data and deployment helpers.
- [x] Apply contract-only page chrome and compact, legible panel spacing.
- [x] Compact the shared evidence panel only when invoked in the contract workspace; keep explanations accessible.
- [x] Run existing targeted tests, typecheck, lint and a preview build.
- [x] Check call sorting/filtering, selected call and observation navigation, map layers, disclosures, exact palette and responsive overflow in the browser.
- [x] Publish the verified build to the existing 3001 server, capture the actual screen, and keep the server running.

**Review focus:** Long IDs, empty/CDR-only calls, missing observation values versus whole-call minima, expanded technical content, and desktop-to-mobile wrapping must stay readable and reachable. Existing server and saved AI history must remain available throughout.

**Verification ledger:** 9 targeted map/call tests, customer-picker SSR and timeline navigation checks passed, as did nonincremental typecheck and targeted lint. Final staged browser checks passed 35/35 across 1920, 1366, 760 and 390px. The original server was updated successfully and displayed actual data. A stricter final asset check caught an existing CSS-only preload 404 also present in the previous release: plugin-rsc captures asset dependencies before Vite removes empty CSS JavaScript chunks. A narrow build-hook order fix will make the preload manifest use final emitted assets; actual map code, data and colors are unaffected.

**Final verification:** The build hook fix passed two regression tests, lint and full typecheck. Rebuilt manifests contained 388 valid JavaScript/CSS references with no missing files. Both staging and the original 3001 server rendered the selected customer/call with no page errors or failed static assets. Published `outputs/contract-style-build-1794635357348`; the 3001 forwarder stayed running throughout. Staging was stopped; the original URL returned HTTP 200 and both original backends remain running. Actual screenshot: `outputs/contract-style-release/live-customer-call-1920.png`.

**CDR-only follow-up:** The user identified unnecessary space for a call without MDT. Baseline CDR summary was 430px tall at 1920px, pushing its reference map below y=794px. Replace its map-sized minimum height and oversized start/end cards with a short, wrapping summary preserving the same start/end times, Cell IDs and tower disclaimer. Omit empty position badges, empty timeline and zero-denominator radio condition rows only for the applicable missing-data states. Verify the screenshot's two CDR calls and a normal MDT call, then publish to the original server and keep it running.

**CDR verification:** 7 existing focused checks, full typecheck and lint passed. Browser verification passed 20/20, including two CDR calls, an MDT call, and 1366/390px layouts. CDR summary height is now 95px; its map starts at y=391px, 403px higher. All source times, Cell ID, QoE and the tower reference are unchanged. Published `outputs/cdr-compact-build-1794635965308`; final original-server smoke had no page errors or failed assets, HTTP 200. Staging stopped; 3001 and both backends remain running. Actual screen: `outputs/cdr-compact-release/live-cdr-1920.png`.

**Integration:** User requested commit, push and main merge for both the customer/call UI and CDR follow-up. Fresh `test:analyst` passed after its SSR harness was updated to stub both CSS modules rather than one hard-coded stylesheet. Fifteen focused checks passed, including the local asset junction check rerun with normal Windows permissions. Full nonincremental typecheck, targeted lint and independent whole-diff review passed. Merge verification will rebuild main, verify both call types through the original server and retain the running service; release evidence stays in ignored `outputs/contract-merge-release`.
