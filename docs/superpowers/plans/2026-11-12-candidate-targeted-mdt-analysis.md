# Targeted MDT and termination candidate analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement the tasks. Steps use checkbox tracking.

**Goal:** Deliver evidence-specific candidate findings and linked SOPs using both MDT source files, real termination codes, and inspectable Qwen request/response snapshots.
**Architecture:** Enrich deterministic local data first; compute public target findings and non-identifying model input on server; render exact three-stage UI with target maps and diagnostics. Existing candidate membership and customer analysis stay compatible.
**Tech Stack:** Windows Python standard-library XLSX streaming, Node CJS SQLite API, React TypeScript Leaflet, existing Qwen .env.
**Spec:** docs/superpowers/specs/2026-11-12-candidate-targeted-mdt-design.md
**Contracts:** docs/superpowers/plans/candidate-targeted-analysis-contract-v3.md

## Global Constraints
- Preserve current branch codex/include-additional-mdt-sources and all preexisting dirty/untracked work. No reset/stash/bulk commit, raw Excel/.env edits, or actual network configuration changes.
- Implement approved direction without another approval gate. Exactly three main UI stages; hypothesis count0..3.
- Read each file before edit and compare current bytes with baseline before overwrite.
- Use exact captured System/User body and raw final response, including validation failures; secrets never sent to browser.
- Real-location claims require measured source evidence and date labeling. No nearest-site responsibility assumption. No FC dictionary invention, RTP-score tautology, or generic wide-scope cause.
- Existing customer analysis must continue to work.
- All artifacts belong to this existing git project. State lives in outputs/candidate-targeted-analysis-dev/progress.md.
- External Windows workspace has necessary dirty feature/data state and current preview: work in place with baselines, no new worktree that loses those inputs.

## Review Focus
1. Additional MDT source ignored, duplicate counted twice, same POT dates mixed, or sparse metric interpreted as zero.
2. Original nonempty FC/BYE dropped, wrong call join, numeric-looking vendor cause decoded as SIP/Q.850.
3. High below-threshold proportion hidden by acceptable mean; one-sample extreme treated as equally strong as substantial observations.
4. Reused/failed/canceled jobs show reconstructed or different prompts; secret fields exposed in diagnostics.
5. Legacy cached job suppresses new analysis, zero hypotheses breaks three-stage UI, full-map close loses selected map state.

## Task 1 — Data enrichment
Files and exact interfaces: Contracts Data ownership.
- [ ] Write failing tests for two-source merge, exact duplicate/conflict handling, date partitioning, RSRQ/PHR/threshold percentages and P/Y mean distinction.
- [ ] Update grid reader/builder/types and validate current two sources.
- [ ] Write failing termination test preserving9563,102^RTP timeout,0:Tx Bye and original field namespaces; implement parser+current-data sidecar.
- [ ] Extend detailed radio reader additively; verify current candidate23 and one newly covered region.
- [ ] Report exact source counts, dates, new-schema samples, and narrow test commands. Do not run full data rebuild.

## Task 2 — Server findings, Qwen contracts and captured diagnostics
Files and exact interfaces: Contracts Backend ownership.
- [ ] Test current failure patterns: generic RTP/scope cause rejected, actual target refs required, zero hypotheses allowed, existing FC fields used, candidate23 tail visible.
- [ ] Implement target findings from enriched MDT, termination sidecar and original radio details. Deterministic selection, spatial labels, metric lineage and sample support.
- [ ] Upgrade evidence/prompt/SOP versions, explicit target-bound actions, no unsupported arbitrary claims.
- [ ] Capture immutable request/response at send/receive boundary and provide diagnostics GET. Test failed JSON, reused jobs, canceled/late metadata, old/no snapshot, secret redaction.
- [ ] Update TS types/session cache validation and backend fixtures/tests. Confirm existing customer analysis tests.
- [ ] Report precise diff, commands and actual outcomes.

## Task 3 — Target UI and inspector
Files and exact interfaces: Contracts UI ownership.
- [ ] Test target/zero-hypothesis rendering, source dates, targeted actions, inspector lazy read and no extraPOST.
- [ ] Keep three stages, prioritize real findings, show per-target metrics and real POT locations in a compact Leaflet map using existing tiles.
- [ ] Link same target into stage3 checks/actions/verification.
- [ ] Add header AI 입력·응답 확인 with System/User/전송 데이터/응답·검증. Show actual snapshots, reuse, models/times/options; distinguish missing capture and masked output.
- [ ] Check keyboard/focus/normal/full map behavior and readability. Existing controls and selected state stay intact.
- [ ] Report scoped tests/typecheck and changed files.

## Integration — root
- [ ] Inspect task outputs and independent review packages; resolve substantive regressions.
- [ ] Rebuild only required MDT/termination artifacts with original source identity preserved; validate extra-source-only coverage and actual Drop2 values.
- [ ] Run candidate/customer/grid/reader tests, TypeScript and scoped lint; local build.
- [ ] Restart normal preview through existing launcher without rebuilding all raw data.
- [ ] Run real Qwen on candidate23 and one added-source-region candidate as needed; verify target-specific analysis, exact request snapshot, code values, and failure handling via fixtures.
- [ ] Verify real screenshots, map locations, inspectors, general/full map reuse, no duplicate model calls.
- [ ] Update docs and ledger with results and material limitations. No claim of analysis quality based on test counts alone.
