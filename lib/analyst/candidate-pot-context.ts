import {analysisRequest} from './customer-ai-analysis';
import type {CandidateAnalysisTarget} from './candidate-ai-analysis';
import type {Mdt25mCell,Mdt25mGrid} from './mdt-25m-grid';

export type CandidatePotStation={
 id:string;lat:number;lon:number;ruId:string;cellId:string;pci:number|null;
 relation:'candidate-bye'|'ambiguous-bye'|'nearby-inventory';callCount:number;
};

/** Read-only map context. A candidate BYE match is not a POT serving-cell or cause assertion. */
export type CandidatePotContext={
 schemaVersion:'candidate-pot-context-v1';target:CandidateAnalysisTarget;generatedAt:string;fingerprint:string;
 candidate:{id:string;title:string;center:{lat:number;lon:number};radiusM:number};
 grid:{
  status:'available'|'unavailable';cellSizeM:25;basisPerMeter:Mdt25mGrid['basisPerMeter']|null;
  measurementDates:string[];metricWeightBasis:string;inputSignature:string;
 };
 pots:Mdt25mCell[];stations:CandidatePotStation[];
 stationSummary:{sourceDate:string|null;uniqueCells:number;ambiguousCells:string[];missingCells:string[]};
 limitations:string[];
};

export function fetchCandidatePotContext(target:CandidateAnalysisTarget,signal?:AbortSignal):Promise<CandidatePotContext>{
 return analysisRequest<CandidatePotContext>('/candidate-context',{method:'POST',body:JSON.stringify(target),signal});
}
