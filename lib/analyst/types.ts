import type { BaseStation } from '../location-estimation/types';
import type { GnssReference } from '../location-estimation/gnss-reference';

export type AnalystSource = 'MDT' | '실측';
export type LocationSource = 'gnss' | 'interpolated' | 'radio' | 'station' | 'measured' | 'unavailable';
export interface AnalystEstimationSite {
  siteId:string; latitude:number; longitude:number; baseStationIds:string[];
  rsrp:number; deltaTimeSec:number; weight:number; estimatedDistanceM:number;
  cellIds:string[]; residualM:number;
}
export interface AnalystEstimationEvidence {
  review?:import('../location-estimation/review').PositionReview;
  /** Withheld solver coordinates are diagnostic only, NEVER customer-map coordinates. */
  candidateLat?:number|null; candidateLon?:number|null;
  method:'MEASURED'|'MULTILATERATION'|'WEIGHTED_2_SITE'|'CELL_SITE'|'INVALID';
  siteCount:number; windowSec:number; usedSites:AnalystEstimationSite[];
  residualErrorM:number|null; geometry:number; jump:boolean; warnings:string[];
}
export interface SourceCustomer { id:string; displayName:string; maskedPhone:string; dates:string[]; sampleCount:number; sourceContractId?:string; gnssSampleCount?:number; callCount?:number; }
export interface SourceCall {
  id:string; ci?:string; start:string; end:string; startTimestamp?:string; endTimestamp?:string;
  startCellId?:string; endCellId?:string;
  /** Explicit BYE/paired 200OK PANI radio technology; unrelated to MDT RAT. */
  endRat?:'LTE'|'NR'|null;
  mosV5Original?:number|null; mosStatus?:'VALID'|'MISSING'|'INVALID';
  mosAlgorithmVersion?:string;
  matchStatus?:'MATCHED'|'AMBIGUOUS'|'UNMATCHED'; matchDeltaSec?:number;
  rtp?:{txJitter:number|null;rxJitter:number|null;txPacketLoss:number|null;rxPacketLoss:number|null;txLossCount:number|null;rxLossCount:number|null};
  qoe:number|null; rsrp?:number|null; rsrq?:number|null; sinr?:number|null; mos?:number|null; pci?:number|null;
  site?:string; mdtCount?:number; radioCount?:number; qoeSampleCount?:number; hasMdt?:boolean;
  endType?:string; sipCause?:string; q850Cause?:string; fc?:string; direction?:string;
}
export interface SourceDay {
  key:string; customerId:string; date:string; samples:readonly (readonly unknown[])[];
  sourceContractId?:string; dataPath?:string; calls?:SourceCall[]; baseStations?:BaseStation[];
  sites?:string[]; rats?:string[]; sampleCount:number;
  callMeta?:Record<string,{start:string;end:string;startTimestamp?:string;endTimestamp?:string}>;
  callCount?:number; gnssSampleCount?:number;
}
export interface AnalystDataset {
  meta:{ dates:string[]; poorQoeThreshold:number; revision?:string; schemaVersion?:string; partitioned?:boolean;
    byeStationInventories?:Array<{technology:'LTE'|'NR';file:string;sha256:string}>;
    source?:string; sourceFiles?:string[]; baseStations?:BaseStation[]; gnssCrs?:string;
    callMeta?:Record<string,{start:string;end:string;startTimestamp?:string;endTimestamp?:string}>; qoeBasis?:string; frequencyEncoding?:string;
  };
  customers:SourceCustomer[]; days:SourceDay[];
}
export interface AnalystSample {
  id:string; index:number; second:number; time:string; timestamp:number; callId:string; ci:string;
  lat:number|null; lon:number|null; site:string; rat:string;
  rsrp:number|null; rsrq:number|null; sinr:number|null; mos:number|null; qoe:number|null; pci:number|null;
  locationSource:LocationSource; inCallWindow:boolean; baseStationId:string; cellId:string; frequency:number|null;
  gnssCrs:string|null; gnssX:number|null; gnssY:number|null;
  stationLat:number|null; stationLon:number|null; confidence:number|null; accuracyM:number|null;
  estimation?:AnalystEstimationEvidence;
  /** Latest PREVIOUS same-call observed GNSS, independent of any modeled UE point. */
  gnssReference?:GnssReference;
  raw:readonly unknown[];
}
export interface AnalystCall {
  /** Source-tagged MDT observation times, separate from identity validation. */
  mdtObservation?:import('./mdt-observation').MdtObservationSummary;
  id:string; ci:string; customerId:string; contractId:string|null;
  start:string; end:string; startTimestamp?:string; startSecond:number; endSecond:number; qoe:number|null;
  startCellId:string; endCellId:string;
  endRat?:'LTE'|'NR'|null;
  durationSeconds?:number;
  /** Last actual GNSS FIX at call end, with age and movement envelope, not a BYE fix. */
  endGnssReference?:GnssReference;
  rsrp:number|null; rsrq:number|null; sinr:number|null; mos:number|null; pci:number|null; site:string;
  sampleIndices:number[]; mdtCount:number; radioCount:number; hasMdt:boolean;
  gnssCount:number; validEventCount:number; locationSource:LocationSource;
  endType:string; sipCause:string; q850Cause:string; fc:string; direction:string;
  mosV5Original?:number|null; mosStatus?:'VALID'|'MISSING'|'INVALID';
  matchStatus?:'MATCHED'|'AMBIGUOUS'|'UNMATCHED'; matchDeltaSec?:number;
  rtp?:{txJitter:number|null;rxJitter:number|null;txPacketLoss:number|null;rxPacketLoss:number|null;txLossCount:number|null;rxLossCount:number|null};
}
export interface AnalystDay {
  source:AnalystSource; customerId:string; contractId:string|null; date:string;
  calls:AnalystCall[]; samples:AnalystSample[]; baseStations:BaseStation[];
}
export interface OverviewCall {
  id:string; rawCallId?:string; customerId:string; contractId:string|null; start:string; end:string; startSecond:number;
  startTimestamp?:string; mos?:number|null; endCellId?:string;
  endRat?:'LTE'|'NR'|null;
  endType?:string; sipCause?:string; q850Cause?:string; fc?:string;
  qoe:number|null; locationSource:LocationSource; gridIds:string[]; site:string;
  /** Evidence of a geographic join; radio estimates are not verified GNSS. */
  spatialEvidence?:'gnss'|'estimated'|'bye-cell'|'unavailable';
}
export interface OverviewCell { id:string; lat:number; lon:number; label:string; callIds:string[]; gnssCalls?:number; estimatedCalls?:number; byeCellCalls?:number; }
export interface OverviewCallLocation {
  callId:string; areaId:string; lat:number; lon:number;
  /** GNSS observed vs radio-derived approximate location. */
  evidence:'gnss'|'estimated'|'bye-cell'; start:string; mos:number|null;
  /** One BYE-proxy nearest point per located CDR call; original track lives in day.samples. */
  representativeBasis?:'cdr-end-nearest'|'bye-cell-site';
  /** BYE Cell fallback is a tower reference coordinate, not a device location. */
  byeCellId?:string; byeRuId?:string; byeInventory?:string;
  byeTechnology?:'LTE'|'NR'; byeInventorySha256?:string;
  /** MDT RU evidence wins; otherwise inventory order supplies a reference only. */
  byeSelectionMethod?:'unique'|'mdt'|'first'; byeCandidateCount?:number;
  /** Positive before CDR end; negative within the permitted after-end tolerance. */
  byeSelectionDeltaSeconds?:number; byeSelectionMdtRu?:string;
  /** Registered BYE station PCI; never an observed MDT value. */
  byePci?:number|null;
  byeInventoryPciStatus?:'valid'|'missing'|'invalid'|'conflict';
  byeInventoryPciCandidates?:number[];
  /** Supporting BYE tower coordinate separate from actual GNSS observation point. */
  byeStationLat?:number; byeStationLon?:number;
  /** Registered station matched to this exact same-call GPS observation. */
  gpsStation?:BaseStation;
  /** Distance/time envelope from the last observed GNSS; not an accuracy radius. */
  gnssReferenceAgeSec?:number; possibleRadiusM?:number;
  referenceBasis?:'last-known-gnss'|'direct-gnss'|'reviewed-radio'|'bye-station'|'coarse-site-barycenter';
  observedAt?:string; cdrEndAt?:string; secondsBeforeEnd?:number;
  /** Radio estimate metadata. Model uncertainty is NOT validated location error. */
  positionQuality?:'gnss-observed'|'gnss-last-known'|'trilateration-reviewable'|'trilateration-weak'|'three-site-rough'|'two-site-approximation'|'other-approximation'|'bye-cell-site';
  estimationMethod?:string|null; usedSiteCount?:number|null;
  geometry?:number|null; residualErrorM?:number|null;
  modelUncertaintyM?:number|null; modelConfidenceScore?:number|null;
  estimationWindowSec?:number|null;
  /** Engineering search area, NOT a calibrated positioning accuracy bound. */
  roughSearchRadiusM?:number|null;
  siteSpanM?:number|null;
  usedStations?:Array<{lat:number;lon:number;ruId:string;cellId:string;rsrpDbm:number}>;
}
export interface AdministrativeDongBoundary {
  id:string; label:string; lat:number; lon:number;
  /** MultiPolygon GeoJSON coordinates in WGS84 [longitude, latitude] order. */
  coordinates:number[][][][];
}
export interface AnalystOverview {
  schemaVersion:'analyst-overview-v1'; source:AnalystSource; date:string; sourceRevision?:string;
  analyticsVersion?:'overview-analytics-v1';
  byeInventorySources?:Array<{technology:'LTE'|'NR';file:string;sha256:string}>;
  gridSizeM:60; calls:OverviewCall[]; cells:OverviewCell[];
  spatialUnit?:'administrative-dong'|'grid60';
  administrativeDongs?:AdministrativeDongBoundary[];
  /** At most one CDR-end-nearest original GNSS/radio coordinate per call. */
  callLocations?:OverviewCallLocation[];
  representativeLocationBasis?:'cdr-end-nearest-or-bye-cell-site';
  representativeMaxAgeSeconds?:number;
  representativeAfterEndToleranceSeconds?:number;
  boundarySource?:string; boundaryBaseDate?:string;
  administrativeMappingAudit?:Record<string,number>;
}
export interface OverviewCellRow extends OverviewCell {
  total:number; evaluated:number; poor:number; affectedCustomers:number; poorRate:number|null;
}
export interface AnalystSummary {
  customers:number; total:number; evaluated:number; unscored:number; poor:number; poorRate:number|null;
  affectedCustomers:number; locatedPoor:number; unlocatedPoor:number;
}
export interface ObservationEvidence { label:string; count:number; total:number; unit:string; }
