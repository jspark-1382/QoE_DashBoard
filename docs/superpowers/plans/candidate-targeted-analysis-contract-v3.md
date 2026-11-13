# Shared contracts — targeted candidate analysis v3

All paths relative to Windows QoE_Metrics. These names bind the three work streams.

## Enriched MDT grid (Data -> Backend/UI)
Keep existing schemaVersion mdt-25m-rsrp-grid-v1 and legacy records/bands/rsrp/samples/basis fields.
Add analysisSchemaVersion:'mdt-grid-analysis-v1'; sourceDates:string[]; sources:{file:string,sourceRows:number,acceptedRows:number,duplicateRows:number}[].
Publishing is split: mdt-grid-25m-v1.json remains a thin map payload (legacy fields plus source metadata and analysisSource:'quality-improvement/mdt-grid-analysis-v1.json'); the full enriched same-shaped artifact is public/quality-improvement/mdt-grid-analysis-v1.json, consumed only by server analysis. Both artifacts participate in the candidate fingerprint. Legacy absence of analysis is explicit unavailable. Builder build() may return full shape, but default CLI publishes both. Each full artifact record adds analysis: Array<{
 date:string,band:string,earfcn:string,samples:number,
 rsrpMean:number,rsrqMean:number|null,phrMean:number|null,rsrpMeanSumCnt:number|null,
 belowPct:Record<string,number|null>,
 metricSamples:Record<string,number>,
 sourceFiles:string[]
}>.
belowPct keys: '-85','-90','-95','-100','-105','-110'; values0..100, missing null.
Partition by date/POT/EARFCN. Do not average P and Y columns. Duplicate identical rows across files count once; conflicting duplicates are explicit errors. Preserve metric-specific weighting and missingness. Unknown input needs explicit report rather than silent dropping.
Both data/25격자 XLSX files are source inputs. Grid display backwards compatibility retained.

## Termination sidecar (Data -> Backend)
Path public/quality-improvement/candidate-termination-v1.json.
{schemaVersion:'qoe-candidate-termination-v1',sourceRevision:string,sources:object[],records:Record<callId,{
 fcRaw:string|null,reasonRaw:string|null,releaseCauseRaw:string|null,
 secondaryReleaseCause1Raw:string|null,secondaryReleaseCause2Raw:string|null,
 sipFailResponseCodeRaw:string|null,byeReasonRaw:string|null,callDirectionRaw:string|null
}>}
IDs MUST match current published calls exactly, using existing parser/provenance. Ambiguous joins fail/are explicitly excluded, never first-match. Include all candidate-relevant calls at minimum; prefer all current source calls. Retain original strings; no invented FC dictionary. Version/hash sidecar in candidate artifact fingerprint.
Extend voice-query-export-details reader additively with rsrq:number|null and radioSeries: sanitized structural radio observations (timestamp,cellId,frequency,rsrp,rsrq,sinr,phr,neighbors); and termination if existing original fields are available. Keep existing rtp/rsrp/sinr consumers working.

## Backend public evidence -> UI
Evidence schema qwen-candidate-evidence-v2; versions evidence candidate-evidence-v2 / prompt candidate-prompt-v3 / sop candidate-sop-draft-v3.
Keep existing evidence properties for legacy view; add analysisTargets:CandidateEvidenceTarget[] and transmission:CandidateTransmissionEntry[].
CandidateEvidenceTarget={
 id:string,kind:'mdt-grid'|'termination-group'|'call-radio',
 title:string,observation:string,
 sourceDates:string[],band:string|null,earfcn:string|null,
 metrics:Array<{label:string,value:number|string|null,unit?:string}>,
 evidenceIds:string[],sopIds:string[],callIds:string[],
 mapPoints:Array<{pot:string,lat:number,lon:number,band:string,date:string}>,
 limitations:string[]
}.
Public mapPoints use real source positions. No customer IDs/coordinates/raw local links in LLM input. LLM gets stable target aliases + numeric summaries and source dates, code raw strings stripped of any sensitive free text. Target ids are server generated, stable for snapshot, and are the basis for report validation.
CandidateTransmissionEntry={label:string,available:number|null,sent:number|null,fields:string[],excluded:string[]}.
Report maintains old properties; each hypotheses item adds targetIds:string[] with 1..2 existing target IDs. hypotheses allows0..3, sop allows empty exact linked union. Every hypothesis must materially refer to its target's observed pattern; no independent RTP-score or generic scope hypothesis. Server observations/targets remain visible if no causal hypothesis.
UI stages: server prioritized target findings in1; target-linked details + actual POT map in2; same target-linked check/conditional action/verification in3. Case with no findings gives specific insufficient-data next step, no invented target.

## Request/response inspection (Backend -> UI)
GET /qoe/api/analysis/jobs/:id/diagnostics (read-only, same origin protections, same job lifetime; no new inference).
{
 schemaVersion:'candidate-analysis-diagnostics-v1',
 status:'not-sent'|'captured'|'unavailable',
 request?:{capturedAt:string,model:string,messages:Array<{role:string,content:string}>,parameters:Record<string,unknown>,redacted:boolean,hash:string},
 response?:{receivedAt:string,model:string|null,content:string|null,finishReason:string|null,usage:Record<string,unknown>|null},
 validation?:{status:'passed'|'failed'|'pending',code?:string,message?:string},
 transmission:CandidateTransmissionEntry[],
 reused:boolean
}
Capture final merged outbound body at send boundary, without headers/config secrets. messages are actual serialized request content; any redaction is visibly marked. Capture content before JSON parsing/validation so failed responses remain inspectable. Bound memory, don't load huge diagnostics in status polls, prevent late canceled metadata overwrite. Keep customer endpoint compatible.
Job type gains diagnosticsAvailable?:boolean, reused?:boolean, modelVerification?:{responseModel:string|null,responseModelVerified:boolean,durationMs:number}.
Prompt3/body snapshots are immutable per request. Old no-snapshot job = unavailable, never reconstruction mislabeled actual.
Backend owns lib/analyst/candidate-ai-analysis.ts type definitions. UI consumes without editing this file.

## Ownership
Data: build-mdt-25m-grid.py, lib/analyst/mdt-25m-grid.ts, build_voice_1030.py, voice-query-export-details.cjs, new termination builder, Python/grid tests.
Backend: qwen-candidate-{evidence,client,sop}.cjs, new findings/diagnostics helpers, qwen-analysis-api.cjs (worker only if needed), lib/analyst/candidate-ai-analysis.ts, candidate backend/session/API tests.
UI: candidate-ai-analysis.tsx/css, new targeted map/inspector UI modules, candidate UI tests. Existing map workspace wrappers only when necessary and notify root before editing.
Root: docs, snapshots, data-build orchestration, integration, preview/build/live verification.
