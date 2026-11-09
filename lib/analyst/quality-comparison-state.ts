import type { ImprovedLocationFilter } from './improved-overview';
import type { ExperienceGroup } from './overview-analytics';
import type { MosBand } from './quality-proposal-metrics';
import { datesInRange } from './date-range';
import type { SipReasonGroup } from './sip-reason';

export type QualityOverviewVariant='current'|'improvement1'|'improvement2';
export interface QualityComparisonState {
  dateStart:string;dateEnd:string;from:string;to:string;customerIds:string[];
  selectedBand:MosBand|null;distributionMode:'mos'|'drop';selectedHour:number|null;
  district:string|null;evidence:ImprovedLocationFilter;cohort:ExperienceGroup|null;
  mapMode:'current'|'improvement';chosenCall:string|null;sourceRevision:string|null;
  sipFilter?:SipReasonGroup|'all';search?:string;
}
export type QualityComparisonStateResult={ok:true;state:QualityComparisonState}|{ok:false;error:'date-range'|'time-range'|'variant';message:string};
export function parseQualityComparisonState(search:string,availableDates:readonly string[]):QualityComparisonStateResult {
  const q=new URLSearchParams(search.startsWith('?')?search.slice(1):search);
  if(q.has('variant')&&!['current','improvement1','improvement2'].includes(q.get('variant')!))return {ok:false,error:'variant',message:'비교 화면 버전을 확인하세요.'};
  const fallback=availableDates.includes('2026-10-30')?'2026-10-30':[...availableDates].sort().at(-1)??'2026-10-30';
  const dateStart=q.get('dateStart')??q.get('date')??fallback,dateEnd=q.get('dateEnd')??q.get('date')??dateStart;
  if(!datesInRange(availableDates,dateStart,dateEnd).length)return {ok:false,error:'date-range',message:'선택한 분석 기간의 자료를 확인하세요.'};
  const from=q.get('from')??'00:00',to=q.get('to')??'23:59';
  const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if(!clock.test(from)||!clock.test(to)||from>to)return {ok:false,error:'time-range',message:'분석 시작·종료 시간을 확인하세요.'};
  const choice=<T extends string>(key:string,allowed:readonly T[],fallback:T):T=>allowed.includes(q.get(key) as T)?q.get(key) as T:fallback;
  const hourValue=q.get('selectedHour')??q.get('hour'),hour=hourValue===null?null:Number(hourValue);
  const distributionMode=choice('distributionMode',['mos','drop'] as const,'mos');
  return {ok:true,state:{dateStart,dateEnd,from,to,
    customerIds:[...new Set([...q.getAll('customer'),...q.getAll('customerIds')].map(v=>v.trim()).filter(Boolean))],
    selectedBand:choice('selectedBand',['poor','fair','good'] as const,distributionMode==='drop'?'poor':null as unknown as MosBand),
    distributionMode,selectedHour:hour!==null&&Number.isInteger(hour)&&hour>=0&&hour<=23?hour:null,
    district:q.get('district')||null,evidence:choice('evidence',['all','gnss','estimated','bye-cell'] as const,'all'),
    cohort:choice('cohort',['affected','repeat','consecutive'] as const,null as unknown as ExperienceGroup),
    mapMode:choice('mapMode',['current','improvement'] as const,'current'),chosenCall:q.get('chosenCall')||null,sourceRevision:q.get('sourceRevision')||null,
    sipFilter:choice('sipFilter',['all','normal','drop','other'] as const,'all'),search:q.get('search')??''}};
}
export function qualityComparisonHref(state:QualityComparisonState,variant:QualityOverviewVariant):string {
  const q=new URLSearchParams({variant,dateStart:state.dateStart,dateEnd:state.dateEnd,from:state.from,to:state.to,
    distributionMode:state.distributionMode,evidence:state.evidence,mapMode:state.mapMode});
  for(const customer of new Set(state.customerIds))q.append('customer',customer);
  if(state.sipFilter&&state.sipFilter!=='all')q.set('sipFilter',state.sipFilter);
  if(state.search)q.set('search',state.search);
  for(const key of ['selectedBand','selectedHour','district','cohort','chosenCall','sourceRevision'] as const){
    if(state[key]!==null)q.set(key,String(state[key]));
  }
  return '/?'+q.toString();
}
