import type { BaseStation } from '../location-estimation/types';

export type AnalystSource = 'MDT' | '실측';
export type LocationSource = 'gnss' | 'interpolated' | 'radio' | 'station' | 'measured' | 'unavailable';
export interface AnalystEstimationSite {
  siteId:string; latitude:number; longitude:number; baseStationIds:string[];
  rsrp:number; deltaTimeSec:number; weight:number; estimatedDistanceM:number;
  cellIds:string[]; residualM:number;
}
export interface AnalystEstimationEvidence {
  method:'MEASURED'|'MULTILATERATION'|'WEIGHTED_2_SITE'|'CELL_SITE'|'INVALID';
  siteCount:number; windowSec:number; usedSites:AnalystEstimationSite[];
  residualErrorM:number|null; geometry:number; jump:boolean; warnings:string[];
}
export interface SourceCustomer { id:string; displayName:string; maskedPhone:string; dates:string[]; sampleCount:number; sourceContractId?:string; gnssSampleCount?:number; callCount?:number; }
export interface SourceCall {
  id:string; ci?:string; start:string; end:string; startTimestamp?:string; endTimestamp?:string;
  startCellId?:string; endCellId?:string;
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
  raw:readonly unknown[];
}
export interface AnalystCall {
  id:string; ci:string; customerId:string; contractId:string|null;
  start:string; end:string; startTimestamp?:string; startSecond:number; endSecond:number; qoe:number|null;
  startCellId:string; endCellId:string;
  durationSeconds?:number;
  rsrp:number|null; rsrq:number|null; sinr:number|null; mos:number|null; pci:number|null; site:string;
  sampleIndices:number[]; mdtCount:number; radioCount:number; hasMdt:boolean;
  gnssCount:number; validEventCount:number; locationSource:LocationSource;
  endType:string; sipCause:string; q850Cause:string; fc:string; direction:string;
}
export interface AnalystDay {
  source:AnalystSource; customerId:string; contractId:string|null; date:string;
  calls:AnalystCall[]; samples:AnalystSample[]; baseStations:BaseStation[];
}
export interface OverviewCall {
  id:string; rawCallId?:string; customerId:string; contractId:string|null; start:string; end:string; startSecond:number;
  startTimestamp?:string; mos?:number|null;
  endType?:string; sipCause?:string; q850Cause?:string; fc?:string;
  qoe:number|null; locationSource:LocationSource; gridIds:string[]; site:string;
}
export interface OverviewCell { id:string; lat:number; lon:number; label:string; callIds:string[]; }
export interface AnalystOverview {
  schemaVersion:'analyst-overview-v1'; source:AnalystSource; date:string; sourceRevision?:string;
  analyticsVersion?:'overview-analytics-v1';
  gridSizeM:60; calls:OverviewCall[]; cells:OverviewCell[];
}
export interface OverviewCellRow extends OverviewCell {
  total:number; evaluated:number; poor:number; affectedCustomers:number; poorRate:number|null;
}
export interface AnalystSummary {
  customers:number; total:number; evaluated:number; unscored:number; poor:number; poorRate:number|null;
  affectedCustomers:number; locatedPoor:number; unlocatedPoor:number;
}
export interface ObservationEvidence { label:string; count:number; total:number; unit:string; }
