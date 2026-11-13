import type {ScreeningQueryScope} from './screening-query';
import {voiceQuery} from './server-query';

export interface CustomerQoeCall {
  id:string;
  rawCallId:string;
  date:string;
  start:string;
  startSecond:number;
  qoe:number|null;
  drop:boolean;
  cell:string;
  location:{lat:number;lon:number;evidence:'gnss'|'bye-cell'}|null;
}

export interface CustomerQoeTimeline {
  sourceRevision:string;
  customerId:string;
  calls:CustomerQoeCall[];
}

export interface CustomerQoeTimelineRequest {
  customerId:string;
  sourceRevision:string;
  scope:ScreeningQueryScope;
  areaId?:string;
  cellId?:string;
}

/** Complete selected-customer observations, including unscored/unlocated calls. */
export function loadCustomerQoeTimeline(args:CustomerQoeTimelineRequest,signal?:AbortSignal):Promise<CustomerQoeTimeline> {
  return voiceQuery<CustomerQoeTimeline>('customer-qoe-timeline',{...args},signal);
}
