# Four-cause summary UI implementation plan

**Goal:** Apply the user-approved image: four compact cause cards, small three-result history tabs, map and short investigation priorities, with detail collapsed by default.

**Approved design:** `C:/Users/jae-sang/.codex/generated_images/01a1d0a6-328d-74f2-aec5-f7ff8d4553c3/exec-3734d531-41c6-46cd-8ae4-4a461c89a410.png`. The user explicitly approved implementation. Example counts and map in the image must be replaced by actual linked evidence.

## Constraints
- Exactly four current causes: DL 커버리지 불량 (RSRP <= -100); UL 커버리지 불량 (source PHR <= 3); Pollution 추정 (at least three actual serving PCI OR Cell-ID changes in a same-call 30-second window); 기타 (장비 및 Core 확인).
- Missing evidence remains unknown. Neither threshold selection nor RTP/BYE observations establish root cause or an equipment/Core failure.
- Preserve editable exact-send prompts, cancellation/failure states, actual POT/call navigation, and the latest three successful stored reports. Keep legacy reports readable and clearly identified as earlier conditions.
- Keep existing 3001 UI available while staging a verified replacement. Preserve unrelated working-tree changes. No full inference sweep or repeating every test three times.

## Tasks
- [x] 1. Backend: issue current four-category source assessments and prompt/validation/SOP contracts, bump versions, retain legacy history readability. Test inclusive boundaries, DL/UL separation, Pollution event counting and missing evidence.
- [x] 2. UI: apply the approved compact header/history/four cards/action strip/map/priorities. All long prose and source inspection collapse by default. Selection must update map and detail from actual targets. Cover loading, failure, missing evidence and old stored reports.
- [x] 3. Integration: type check, scoped regression/lint, local build; representative browser checks at 1920x1080 and 1366x768 for overflow, accordion interaction, history switching, prompt send and source navigation.
- [x] 4. Delivery: stage immutable build, switch existing preview only after checks, retain previous assets for open tabs, confirm original URL returns UI and four-category prompt, leave servers running.

## Ownership / execution ledger
- Root: integration, checks, staged delivery and final review.
- Backend agent: scripts and `lib/analyst/candidate-ai-analysis.ts`; current IDs `coverage` (DL only), `uplink` (UL), `interference` (Pollution only), `equipment` (기타). Keep old capacity/mobility IDs readable only for legacy saved reports.
- UI agent: components and presentation helpers; same four IDs, legacy display derived from actual per-target criteria, no fabricated counts or targets.
- Ruling: current source/procedure semantics migrate with the compact UI, because approval referred to the four-cause design and the preceding explicit criteria; old history is retained rather than relabeled into unsupported causes.
- Completed: real candidate 3 Qwen generation `8324dd35-2168-45a6-bd77-8ec75b70cc99` completed on its first attempt, retained three results with oldest eviction, and exact report/diagnostics restored through the restarted original 3001 endpoint. This was one new real analysis, not a new whole-candidate inference sweep.
- Verified: focused backend/legacy regressions and presentation tests, TypeScript, scoped lint, release build, nine actual-history browser checks and ten intercepted prompt/failure/cancel checks. Layout captures include real maps at 1920x1080 and 1366x768. Category/target synchronization, balanced actual POT/call selection and category-specific missing evidence were corrected after observed failures; test expectations were updated for the balanced selection policy.
- Published: `outputs/four-causes-release-1794552498707`; 3014 process 41796 and 3016 process 23536; original 3001 forwarder process 39304 unchanged. Original and alias return HTTP 200 after staging is stopped. Prior client assets and hidden local-preview marker retained. `outputs/candidate-four-causes/publication.json` and `published-verification.json` contain delivery evidence.
