import type { } from './types';

/** 원본 5일 overview로부터 별도 생성된 고객 선별 전용 경량 자료. */
export type ScreeningCall = [
  day:number, second:number, qoe:number|null, drop:number, area:string, cell:string,
  lat:number|null, lon:number|null, evidence:string, rawCallId:string, endSecond?:number|null,
];
export interface ScreeningSource {
  schemaVersion:'customer-screening-v1';sourceRevision:string;source:string;dates:string[];
  thresholds:{poor:number;good:number;concentratedRate:number;concentratedCount:number;minEvaluatedForRate:number;repeatDays:number;dropCount:number;dropRate:number};
  areas:Record<string,[label:string,lat:number,lon:number]>;
  cellSites?:Record<string,[lat:number,lon:number]>;
  customers:{id:string;number:string;calls:ScreeningCall[]}[];
  audit:{calls:number;poor:number;drops:number;locatedPoor:number;customers:number};
}
export type CustomerGroup='concentrated'|'repeat'|'drop'|'temporary'|'good';
export interface PoorCall {
  date:string;second:number;qoe:number;drop:boolean;area:string;cell:string;
  lat:number|null;lon:number|null;evidence:string;rawCallId:string;
}
export interface ScreeningRow {
  id:string;number:string;total:number;eligible:number;poor:number;poorRate:number;
  /** Customer-side SIP models in the selected date/time scope, most recent first. */
  deviceModels?:string[];
  drop:number;dropRate:number;mean:number|null;repeatedDays:number;sameAreaDays:number;
  latestDate:string;mainArea:string;mainAreaId:string;mainCell:string;group:CustomerGroup;
  badCalls:PoorCall[];dailyTotal:number[];dailyPoor:number[];href:string;
}
export interface ScreeningResult {
  rows:ScreeningRow[];total:number;affected:number;repeat:number;concentrated:number;
  dropHeavy:number;locationRepeat:number;groups:Record<CustomerGroup,number>;
  calls:number;eligible:number;poor:number;drop:number;
}
const emptyGroup=():Record<CustomerGroup,number>=>({concentrated:0,repeat:0,drop:0,temporary:0,good:0});
const toSeconds=(s:string)=>{const m=s.match(/^([01]\d|2[0-3]):([0-5]\d)$/);return m?Number(m[1])*3600+Number(m[2])*60:null;};
export function validScreeningSource(value:unknown):value is ScreeningSource {
  if(!value || typeof value!=='object')return false;
  const x=value as Partial<ScreeningSource>;
  return x.schemaVersion==='customer-screening-v1'&&Array.isArray(x.dates)&&
    Array.isArray(x.customers)&&!!x.areas&&typeof x.sourceRevision==='string'&&
    x.customers.every(c=>typeof c.id==='string'&&Array.isArray(c.calls));
}
export function aggregateScreening(data:ScreeningSource,start:string,end:string,from:string,to:string,scope?:{areaId?:string;cellId?:string;gnssOnly?:boolean}):ScreeningResult {
  const startIndex=data.dates.indexOf(start),endIndex=data.dates.indexOf(end);
  const first=toSeconds(from),last=toSeconds(to);
  if(startIndex<0||endIndex<startIndex||first===null||last===null||last<first)throw Error('조회 기간이나 시간이 올바르지 않습니다.');
  const t=data.thresholds,groups=emptyGroup(),rows:ScreeningRow[]=[];
  let affected=0,repeat=0,concentrated=0,dropHeavy=0,locationRepeat=0,calls=0,eligible=0,poor=0,drop=0;
  for(const customer of data.customers){
    let total=0,customerEligible=0,customerPoor=0,customerDrop=0,sum=0;
    const badCalls:PoorCall[]=[],badDays=new Set<string>(),areaDays=new Map<string,Set<string>>(),
      areaCounts=new Map<string,number>(),cellCounts=new Map<string,number>();
    const dailyTotal=Array.from({length:data.dates.length},()=>0),dailyPoor=Array.from({length:data.dates.length},()=>0);
    for(const [day,second,qoe,isDrop,area,cell,lat,lon,evidence,rawCallId] of customer.calls){
      if(day<startIndex||day>endIndex||second<first||second>=last+60)continue;
      if(scope?.areaId&&area!==scope.areaId)continue;
      if(scope?.cellId&&cell!==scope.cellId)continue;
      if(scope?.gnssOnly&&evidence!=='gnss')continue;
      total++;dailyTotal[day]++; if(isDrop)customerDrop++;
      if(qoe!==null&&Number.isFinite(qoe)){customerEligible++;sum+=qoe;}
      if(qoe!==null && Number.isFinite(qoe) && qoe<t.poor){
        customerPoor++;const date=data.dates[day];badDays.add(date);dailyPoor[day]++;
        if(area){areaCounts.set(area,(areaCounts.get(area)??0)+1);const dates=areaDays.get(area)??new Set<string>();dates.add(date);areaDays.set(area,dates);}
        if(cell)cellCounts.set(cell,(cellCounts.get(cell)??0)+1);
        badCalls.push({date,second,qoe,drop:Boolean(isDrop),area,cell,lat,lon,evidence,rawCallId});
      }
    }
    if(!total)continue;
    const poorRate=customerEligible?customerPoor/customerEligible:0,dropRate=customerDrop/total;
    const isConcentrated=customerPoor>=t.concentratedCount ||
      (customerEligible>=t.minEvaluatedForRate&&customerPoor>0&&poorRate>=t.concentratedRate);
    const isRepeat=badDays.size>=t.repeatDays;
    const isDropHeavy=customerDrop>=t.dropCount|| (total>=5&&customerDrop>0&&dropRate>=t.dropRate);
    const group:CustomerGroup=isConcentrated?'concentrated':isRepeat?'repeat':
      isDropHeavy?'drop':customerPoor?'temporary':'good';
    groups[group]++;
    affected+=Number(customerPoor>0);repeat+=Number(isRepeat);concentrated+=Number(isConcentrated);
    dropHeavy+=Number(isDropHeavy);
    const sameAreaDays=Math.max(0,...[...areaDays.values()].map(days=>days.size));
    if(sameAreaDays>=2)locationRepeat++;
    const mainAreaId=[...areaCounts].sort((a,b)=>b[1]-a[1])[0]?.[0]??'';
    const mainCell=[...cellCounts].sort((a,b)=>b[1]-a[1])[0]?.[0]??'';
    badCalls.sort((a,b)=>b.date.localeCompare(a.date)||b.second-a.second);
    const latest=badCalls[0];
    const query=new URLSearchParams({source:'MDT',view:'contract',date:latest?.date??end,customer:customer.id});
    if(latest?.rawCallId)query.set('call',latest.rawCallId);
    rows.push({id:customer.id,number:customer.number,total,eligible:customerEligible,poor:customerPoor,poorRate,
      drop:customerDrop,dropRate,mean:customerEligible?sum/customerEligible:null,repeatedDays:badDays.size,
      sameAreaDays,mainArea:data.areas[mainAreaId]?.[0]??(mainAreaId?'행정동 미확인':'위치 근거 없음'),
      mainAreaId,mainCell,latestDate:latest?.date??'',group,badCalls,dailyTotal,dailyPoor,
      href:'/?'+query.toString()});
    calls+=total;eligible+=customerEligible;poor+=customerPoor;drop+=customerDrop;
  }
  rows.sort((a,b)=>b.poor-a.poor||b.repeatedDays-a.repeatedDays||b.poorRate-a.poorRate||b.drop-a.drop||a.number.localeCompare(b.number));
  return {rows,total:rows.length,affected,repeat,concentrated,dropHeavy,locationRepeat,groups,calls,eligible,poor,drop};
}
export interface CustomerCluster {id:string;lat:number;lon:number;customerCount:number;callCount:number;
  evidence:string;customerIds:string[];customerLabel:string;}
/** 독립 고객 수 기반 0.005° 검색 격자. 이것은 물리적 전파 군집 DBSCAN이 아닙니다. */
export function buildCustomerClusters(rows:ScreeningRow[],kind:'poor'|'drop'|'repeat',evidence:'all'|'gnss'):CustomerCluster[]{
  const buckets=new Map<string,{lat:number;lon:number;calls:number;customers:Set<string>;evidence:Set<string>;mainCustomer:string}>();
  for(const customer of rows){
    if(kind==='repeat'&&customer.repeatedDays<2)continue;
    for(const call of customer.badCalls){
      if(kind==='drop'&&!call.drop)continue;
      if(call.lat==null||call.lon==null)continue;
      if(evidence==='gnss'&&call.evidence!=='gnss')continue;
      // Same BYE tower may appear for multiple calls: distinct customers count once.
      const latKey=Math.round(call.lat/.005),lonKey=Math.round(call.lon/.005);
      const id=latKey+':'+lonKey;
      const bucket=buckets.get(id)??{lat:latKey*.005,lon:lonKey*.005,calls:0,customers:new Set<string>(),evidence:new Set<string>(),mainCustomer:customer.id};
      bucket.calls++;bucket.customers.add(customer.id);bucket.evidence.add(call.evidence);
      buckets.set(id,bucket);
    }
  }
  return [...buckets].map(([id,v])=>({id,lat:v.lat,lon:v.lon,customerCount:v.customers.size,
    callCount:v.calls,evidence:[...v.evidence].join(' · '),customerIds:[...v.customers],customerLabel:v.mainCustomer}))
    .sort((a,b)=>b.customerCount-a.customerCount||b.callCount-a.callCount).slice(0,120);
}
export const percent=(n:number,total:number)=>(total>0?100*n/total:0).toFixed(1)+'%';
export const number=(n:number)=>n.toLocaleString('ko-KR');
