# Candidate prompt editing and manual transmission

**Goal:** Let the investigator edit the exact System/User messages, explicitly send them to Qwen, and inspect the actual response while comparing saved analyses.

**Architecture:** Extend the existing candidate job API and manager with an optional prompt override. A no-inference draft endpoint prepares default prompts from server-owned evidence. The dialog adds an editor and explicit Send action around the existing status. Default automatic analysis remains unchanged.

## Contract and decisions

- Header order: prompt editing, analysis status, Send, existing analysis/inspection/close actions.
- `CandidatePromptDraft={system:string,user:string}`; draft API returns `{target,system,user,fingerprint}`.
- `POST /candidate-prompt` prepares default messages without calling Qwen. Captured original messages can also be loaded for a saved run.
- `POST /jobs` accepts candidate-only `promptOverride`, includes its digest in active deduplication, and always starts a new test rather than reusing completed results.
- The edited strings are transmitted exactly once, with no hidden correction request. Captured messages and raw response allow checking exactly what happened.
- Existing server evidence/response validation remains authoritative for applying a structured report. Freeform or invalid reports still expose the actual response in the prompt test view.
- Successful structured tests use the same latest-three history. Source/config eligibility is tracked separately from prompt identity so valid custom results remain reviewable.
- Drafts stay scoped to the exact candidate; loading results, restoring defaults, editing, and opening the editor do not invoke Qwen.

## Tasks

- [ ] Backend/client: failing tests for override dispatch, no auto-repair, validation limits, prompt identity and history; implement endpoint and manager API.
- [ ] UI: editable System/User messages, defaults/captured prompt loading, candidate-scoped drafts, header Send, raw response and validation result; test early clicks and edited payload.
- [ ] Integration: related regression tests, type/lint/build, one actual edited Qwen request, persisted prompt/result verification, browser edit/send/default/scope checks, visual review.

## Review focus

Edits must not be overwritten by late draft/diagnostic loads or history selection. Sending while busy must not dispatch duplicate work. Custom responses must not become verified analysis unless they pass the existing validator. Default analysis must not inherit edited text. Saved custom history must remain tied to the actual sent prompt and source conditions.
