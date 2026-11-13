/** Shared implementation contract, 2026-11-12. Design reference, not bundled. */
export type AnalysisScope={dateStart:string;dateEnd:string;from:string;to:string};
export type AnalysisTarget={kind:'customer'|'call';customerId:string;callId?:string;scope:AnalysisScope;sourceRevision:string};
export type AnalysisFact={id:string;title:string;detail:string;severity:'info'|'attention'|'caution'};
export type AnalysisCall={id:string;date:string;start:string;end:string;qoe:number|null;mos:number|null;isDrop:boolean;cell:string;area:string;locationEvidence:string;href:string;rsrp:number|null;sinr:number|null};
export type AnalysisEvidence={
 schemaVersion:'qwen-evidence-v1';sourceRevision:string;target:AnalysisTarget;generatedAt:string;
 summary:{totalCalls:number;evaluatedCalls:number;poorCalls:number;poorRate:number|null;rawMosEvaluatedCalls:number;rawMosPoorCalls:number;meanMos:number|null;meanQoe:number|null;dropCalls:number;observedDays:number;poorDays:number};
 byDay:{date:string;totalCalls:number;evaluatedCalls:number;poorCalls:number;dropCalls:number}[];
 byCell:{cell:string;totalCalls:number;evaluatedCalls:number;poorCalls:number;poorRate:number|null;dropCalls:number}[];
 facts:AnalysisFact[];calls:AnalysisCall[];
 coverage:{locationCalls:number;radioCalls:number;rtpCalls:number;sampledCalls:number;fullPopulation:boolean;detailsPolicy:string};
 limitations:string[];
};
export type AnalysisReport={summary:string;hypotheses:{title:string;assessment:'supported'|'possible'|'insufficient';reason:string;evidenceIds:string[]}[];checks:{action:string;reason:string;evidenceIds:string[]}[];limitations:string[]};
export type AnalysisStatus='queued'|'collecting'|'analyzing'|'completed'|'failed'|'cancelled';
export type AnalysisJob={id:string;target:AnalysisTarget;status:AnalysisStatus;createdAt:string;updatedAt:string;model:string;error?:{code:string;message:string};evidence?:AnalysisEvidence;report?:AnalysisReport};
export type AnalysisConfigStatus={configured:boolean;model:string;missing:string[];error?:{code:string;message:string}};
// GET /qoe/api/analysis/config => AnalysisConfigStatus. No URL/key exposed.
// POST /qoe/api/analysis/connection => {ok:boolean,model:string,message:string}; failure {error:string,code:string}.
// POST /qoe/api/analysis/jobs JSON AnalysisTarget => 202 AnalysisJob.
// GET /qoe/api/analysis/jobs/:id => AnalysisJob. DELETE same => cancelled/current AnalysisJob.
// All API errors use {error:string,code:string}; HTTP 409 stale revision, 400 validation, 503 unconfigured.
// Evidence module exports collectEvidence({dbPath,publicDir,target,sourceRevision}) -> AnalysisEvidence & {modelInput:object} (synchronous, run in worker).
// Evidence module exports validateTarget(input) -> validated AnalysisTarget (throw with .status/.code).
// modelInput must contain no raw customer ID/contract/customer number/call IDs/coordinates.
// API keeps modelInput server-side only. facts IDs are only allowed report evidenceIds.
// API module exports createQwenAnalysisHandler({root,...testDependencies}) with .close() async.
// Node worker receives dbPath/publicDir/target/sourceRevision and returns evidence or sanitized error.
// Configuration uses QWEN_BASE_URL (explicit /v1), QWEN_MODEL, QWEN_API_KEY (optional),
// QWEN_TIMEOUT_MS=180000, QWEN_MAX_TOKENS=4096, QWEN_TEMPERATURE=0.2,
// QWEN_JSON_MODE=false, QWEN_EXTRA_BODY_JSON={} (optional serving-specific request extras).
// Precedence process.env > .env.local > .env. Server loads fresh on new requests.
// .env and runtime integrations are owned by root; evidence scripts/tests by data implementer;
// config/client/job API/worker scripts/tests by backend implementer.
