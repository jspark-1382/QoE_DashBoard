import type { PositionReview } from '../../location-estimation/review';

export interface ImprovementScope {
  source:'MDT'; sourceRevision:string; dateStart:string; dateEnd:string;
  from:string; to:string; hour:number|null; metric:'mos'; customerId:string|null;
  mode:'holdout'|'screening';
}
export type AnalysisScope=Omit<ImprovementScope,'hour'|'customerId'>;
export interface CandidatePolicy {
  version:string; epsM:number; minSamples:number; minPoorCustomers:number;
  minPoorDates:number; minNewCustomers:number; maxDiameterMultiplier:number; locationPolicy:string;
}
export interface EvidenceCall {
  date:string; callId:string; rawCallId:string; customerId:string;
  startedAt:string|null; endedAt?:string|null; mos:number|null; sipReason?:string|null;
  mdtLinkStatus:'unique'|'ambiguous'|'none'|'unknown'; sourceRevision:string; sourceFile:string;
  start?:string; end?:string; endCellId?:string; contractId?:string|null;
}
export interface EvidenceLineage {sourceRevision:string; sourceFile:string; rawCallId:string; date:string}
export interface EvidenceDecision {
  callId:string; status:'accepted'|'excluded'; kind?:'gnss'|'reviewed-radio';
  lat?:number; lon?:number; observedAt?:string|null; ageSec?:number|null;
  referenceBasis?:string; reasons:string[]; lineage:EvidenceLineage; review?:PositionReview;
}
export interface CoverageCounts {N:number; M:number; D:number; G:number; T:number; U:number}
export interface CoverageRatio {numerator:number; denominator:number; value:number|null}
export interface CoverageSummary extends CoverageCounts {
  poor:CoverageCounts; ratios:Record<string,CoverageRatio>; poorRatios:Record<string,CoverageRatio>;
  mdtAmbiguous:number; mdtUnknown:number; mosMissing:number; mosInvalid:number; excludedReasons:Record<string,number>;
}
export interface NearbyPoint {
  callId:string; customerId:string; date:string; lat:number; lon:number;
  kind:'gnss'|'reviewed-radio'; role:'discovery-member'|'validation-new'|'validation-existing'|'discovery-nearby';
  mos?:number; observedAt?:string|null;
}
export interface SpatialCandidate {
  id:string; kind?:'spatial'; memberCallIds:string[]; customerIds?:string[];
  poorCustomerCount:number; poorCallCount:number; poorDateCount:number; gnssCount:number;
  medoid:{lat:number;lon:number;callId?:string}; maxCenterDistanceM:number; maxPairDistanceM:number;
  displayRadiusM:number; rangeReviewRequired:boolean; rank:number|null;
  validationNewCustomerIds:string[]; validationExistingCustomerIds:string[];
  validationStatus:string; nearbyPoints:NearbyPoint[];
}
export interface InputFileHash {file:string; sha256:string}
export interface ImprovementReport {
  schemaVersion:'voice-improvement-1-v1'; sourceRevision:string; scope:AnalysisScope;
  policy:CandidatePolicy; scopeKey:string; inputHash:string; inputFiles:InputFileHash[]; inventoryHash:string;
  availableDates:string[]; discoveryDates:string[]; validationDates:string[];
  calls:EvidenceCall[]; decisions:EvidenceDecision[]; coverage:CoverageSummary;
  baselineSpatialCandidates:SpatialCandidate[]; improvedSpatialCandidates:SpatialCandidate[];
  diagnostics:Record<string,unknown>; publicationReference:Record<string,unknown>|null;
}
export interface ImprovementIndexEntry {
  scopeKey:string; scope:AnalysisScope; policy:CandidatePolicy; path:string;
  inputHash:string; inventoryHash:string; canonicalScope?:string;
}
export interface ImprovementIndex {
  schemaVersion:'voice-improvement-1-index-v1'; sourceRevision:string;
  availableDates:string[]; entries:ImprovementIndexEntry[];
}
export interface CustomerExperience {
  customerId:string; affected:boolean; callCount:number; evaluatedCallCount:number;
  poorCallCount:number; poorDateCount:number; repeatCalls:boolean; consecutiveCalls:boolean|null;
  maxConsecutivePoorDates:number|null; indeterminateReasons:string[];
}
export type CustomerPeriodCall=EvidenceCall & {isMember:boolean; nearbyRole:NearbyPoint['role']|null; drop:boolean; detailHref:string};
export interface CandidateCustomerPeriod {customerId:string; alias:string; calls:CustomerPeriodCall[]; experience:CustomerExperience}
export interface FieldEvidence {
  candidateId:string; observedAt:string; audioRef:string|null; measuredMos:number|null; rfRef:string|null;
  result:'uncollected'|'pending'|'observed'; measurementId?:string; audioMeasurementId?:string; mosMeasurementId?:string;
}
export interface ScanReference {
  supplied:boolean; dateStart:string; dateEnd:string; from:string; to:string;
  regionDefinition:string; populationDefinition:string; metricDefinition:string;
  sourceRevision?:string;
}
