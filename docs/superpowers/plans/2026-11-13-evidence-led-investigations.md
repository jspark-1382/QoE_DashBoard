# Evidence-led candidate investigations

User-approved direction: retain the five cause categories, lead with actual POTs and calls, observed evidence, why to investigate, and the next discriminating check. Keep the existing UI available throughout verification.

## Contract

- Add optional `report.investigations`: 1–6 `{title, reason, nextCheck, targetIds, evidenceIds}` entries. Every target must have been sent to Qwen, every reference must support the selected targets. Legacy saved reports stay readable.
- Keep causal hypotheses separate. Add observation-only `call-quality` and `call-pattern` source targets with no allowed cause categories or causal SOPs. Send bounded, anonymized source metrics and exact public call links.
- Preserve all five cause labels. Capacity, mobility, or component failure still require evidence that this dataset does not contain. Do not turn co-occurrence into a cause or supply unverified RTP units.
- New evidence/prompt versions: `candidate-evidence-v4` / `candidate-prompt-v7`; existing SOP version and latest-three history retention remain. Default automatic output contains investigations with empty hypotheses/SOP arrays; advanced edited requests retain the five-category validation contract.

## Work and validation

1. Extend source evidence with up to six actual detailed calls and three repeat patterns; give source-derived investigation hints. Test source identity, numerical fidelity, anonymization, bounds and category restrictions.
2. Extend prompt/report validation for investigations. Keep number, source, category, SOP and causal-claim guards; test unrelated references, invented metrics, unsafe conclusions, and legacy readability. Triage captured failures before changing retry instructions.
3. Lead the dialog with investigation cards resolving actual POTs/calls, metrics, original call links, AI reason and next check. Preserve prompt editing, latest-three selection and honest failure fallback. Verify 1366 and 1920 layouts.
4. Run a fresh analysis of all 63 candidates under the new versions in an independent handler. Preserve diagnostics for every rejected response. Recheck genuine failures and GET-only transport recovery; never synthesize Qwen success.
5. Check every candidate's durable history after restarting the audit handler: newest result present, max three, distinct IDs, exact candidate/scope, report and diagnostics restored. Use representative real reruns to exercise three-result comparison and fourth-result eviction; ensure failed analyses do not evict successes.
6. Keep user UI on a fixed preview copy while building and testing a separate port. Publish the tested copy only after validation, with the previous copy retained for rollback.

## Review focus

- A call chosen by AI must link to the exact source call, never a nearest POT or unrelated member.
- Observation-only RTP/repetition targets must never acquire a cause or intervention SOP.
- All-six raw RTP fields preserve their unknown units; no inferred UL/DL leg or faulty component.
- Saved older versions remain readable without suppressing a new current-version analysis.
- Large candidates and transient poll failures must not break the UI or lose durable results.

## Status

- Initial existing UI health: HTTP 200, fixed-preview process retained. Previous audit stopped independently so the next full run uses the new versions.
- Source evidence, report validation, investigation UI and exact POT/call inspection implemented. Source-only targets do not gain causal categories or SOPs; legacy readability is separate from current-version reuse.
- All 63 evidence preflights passed. Initial related regression run: 359/359; typecheck and local build passed. Full-repository lint reports pre-existing errors outside this change; scoped changed files are checked independently.
- Actual new-format candidate 23 passed on its first model attempt, retained exactly three durable reports and evicted the previous fourth. Full new-format inference audit and browser QA remain in progress.
- Independent review found and addressed retained-result failure visibility, a future-measurement validation false positive, and audit error-count correctness. Additional real-response validation regressions cover exact POT counts, time alignment verbs, and normal-control terminology without permitting false diagnoses.
- First complete real-inference pass finished all 63 candidates: 52 saved successes and 11 rejected/time-out responses. Handler restart verification passed for all 63 history groups, restored all 52 latest successful reports and diagnostics, retained a maximum of three per group, and confirmed failed attempts did not evict prior successes. Two fourth-result evictions were exercised in this pass. Failed responses remain captured for triage and genuine new inference; shadow revalidation never promotes a failure.
- Delivery validation before the final failure rerun: 386 related regression tests passed; the fixed UI build passed. Browser checks passed for investigations (8), prompt editing (9), and the actual candidate-9 target-alias inspector (5), with no forwarded model requests or runtime errors during browser QA. Actual original-call and POT navigation, three real saved reports, legacy display, failure visibility and responsive layouts were checked.
- The existing 3001 forwarder and 3014 server remain running. New UI runs on 3016 from an immutable build copy. A separately downloaded and SHA-256-verified Node 24.22.2 executable avoids the native exits observed under installed Node 24.15.0 during long audit runs without changing the system runtime.
- User requested ending repeated tests after the complete core-filter pass. Stopped only the repeat audit process; no additional inference or broad tests will run. Final checkpoint combines the complete pass and actual completed reruns: 63 reviewed, 58 completed/saved, 5 latest attempts unresolved (8, 22, 40, 53, 60). Candidate 40's repeat was cancelled; prior failures were not promoted by shadow validation. `outputs/candidate-full-audit/user-checkpoint.json` preserves the first complete pass and partial repeat separately.
- Final source fixes passed 70 scoped tests and lint: clause-local cross-call identity guards including canonical/T aliases, source-complete pair presentation, and an investigation-only v7 correction prompt without legacy hypothesis/SOP directives. The modified 3016 service was reloaded; both 3001 and 3016 returned 200 and candidate 23's actual three saved results restored on the reloaded service. No additional full inference or regression rounds were started after the user's stop instruction.
