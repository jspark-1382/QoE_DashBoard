/** Presentation filter only: never modify generated clustering outputs or original member calls. */
export type CandidateDisplayMode='core'|'top10'|'all';
export const CORE_MIN_CALLS=6;
export const CORE_MIN_CUSTOMERS=3;
export function coreMinDays(dateStart:string,dateEnd:string):number{
 const first=Date.parse(dateStart+'T00:00:00Z'),last=Date.parse(dateEnd+'T00:00:00Z');
 if(!Number.isFinite(first)||!Number.isFinite(last)||last<first)return 3;
 return Math.min(3,Math.floor((last-first)/86400000)+1);
}
export function isCoreCandidate(calls:number,customers:number,days:number,minimumDays:number):boolean{
 return calls>=CORE_MIN_CALLS&&customers>=CORE_MIN_CUSTOMERS&&days>=minimumDays;
}
export function isCandidateShown(calls:number,customers:number,days:number,minimumDays:number,mode:CandidateDisplayMode):boolean{
 // TOP10 membership is applied separately using the candidate's constituent calls.
 return mode!=='core'||isCoreCandidate(calls,customers,days,minimumDays);
}
