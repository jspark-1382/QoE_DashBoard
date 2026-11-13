# Candidate actionable analysis and saved comparisons

**Goal:** Help an investigator decide where to inspect, which observation justifies it, and which next check distinguishes competing explanations; retain three completed analyses per exact candidate scope.

**Scope:** Existing React/Vinext application and local Qwen API. Preserve the current dirty workspace, source data, candidate selection, and customer analysis behavior. No dependency changes, deployment, or commits of unrelated changes.

## Design decisions

- The server reviews all eligible POT evidence by explicit rules before Qwen interpretation. This is an evidence rule review, not a second language model. Show agreement and differences, including additional investigation points.
- Coverage findings identify several ranked, distinct POTs where supported, retaining dates, bands, measurement support, nearby comparisons, and the distinction between background MDT and call-time evidence.
- A raw RTP timeout is an interruption observation. It cannot establish a failed transmission link, device, terminal, or responsible base station. Present concrete missing logs and distinguishing checks.
- Retry only a bounded set of recoverable Qwen output errors, preserve captured exchange diagnostics, and never convert a failed AI analysis into a successful invented report.
- Save up to three completed snapshots and redacted diagnostics per exact candidate/revision/date/time/policy/model scope under ignored outputs. Failed/cancelled runs do not evict successful results. An explicit rerun bypasses completed-result reuse; active jobs remain deduplicated.
- Load saved results without invoking Qwen. Show saved/failed persistence status; compare timestamps, findings, POTs, and next checks. Browser refresh and local server restart must retain completed results.

## Tasks and verification

- [x] Quality: add failing regressions for multiple coverage points, generic termination claims, deterministic review, and bounded repair; implement findings/evidence/client changes and run their suites.
- [x] Persistence: add failing restart/retention/diagnostic/session regressions; implement history storage and API/session contracts and run candidate/customer regression suites.
- [x] UI: expose three saved analyses, new-run action, comparison, ranked inspection points, and rule-review/Qwen differences; verify useful empty/failure states and context-independent historical report display.
- [x] Integration: run candidate regression tests, TypeScript/lint, local build, and actual Qwen on the supplied candidate plus a previously failing/larger candidate. Read stored results after restart and compare the actual observations independently. Review changes with a fresh agent.

## Integration contracts

`CandidateAnalysisEntry`: optional `history`, `historyError`, `historyLoading`; `CandidateAnalysisJob.persistence`: saved/failed state with timestamp/message. Manager: `loadHistory(target)`, `start(target,{rerun})`, `selectSaved(target,id)`. History endpoint: `POST /qoe/api/analysis/candidate-history`, bare target body, `{target,jobs,limit:3}` response. Evidence exposes optional `independentReview` defined by the quality module.

## Review focus

- A late history response must not replace an active run or a newly selected saved result.
- Selecting another candidate or different date scope must never mix reports or diagnostics.
- Completing a run after the dialog unmounts must still save it.
- Failed or malformed Qwen output must preserve previous saved results.
- Background MDT and raw vendor codes must not become causal conclusions.

## Progress

Investigation confirmed memory-only server/client results, completed-result reuse preventing comparisons, a two-target hypothesis cap, and weak termination specificity checks. Three independent workers own quality, persistence, and presentation; root owns real-data evaluation and integration.

Final source tests: 240/240 passing; TypeScript and scoped lint passing; final local build complete. Fresh Qwen analysis of candidate 23 selected five concrete MDT POTs plus the RTP interruption investigation, and candidate 12 selected five MDT POTs. Three distinct actual saved candidate-23 reports passed the final validator, retained reports/diagnostics after a handler restart, and remained separate from candidate 12. Actual failure captures also verified successful history was unchanged.

Independent review fixed cancellation/restart races, current-condition eligibility, live URL redaction, and map-source dependence of historical report text. Real output regression fixes distinguish future Korean investigation wording from confirmed faults and permit Korean RTP event descriptions only when their source raw codes exist. Event-safe lazy manager initialization also prevents losing a first click before passive effects.

Final browser QA passed 11 checks on the user's `http://127.0.0.1:3001` address: latest-three restore, all three exact saved raw responses, refresh without inference, 1920/1366 layouts, explicit rule-source map inspection and return to Qwen, and a new-run request intercepted before inference while the prior report remained visible. No browser runtime errors. Final compact layout and rule screenshot were visually inspected. App preview is running the final build.
