import type {AnalysisScope} from './customer-ai-analysis';
import type {CustomerQoeCall} from './customer-qoe-timeline';

export type CustomerQoeChartMode='all'|'day';
export type CustomerQoeChartPoint={call:CustomerQoeCall;x:number;y:number;outOfRange:'below'|'above'|null};
const dayNumber=(date:string)=>Date.parse(date+'T00:00:00Z')/86400000;
const timeSecond=(value:string)=>{const [hour,minute]=value.split(':').map(Number);return hour*3600+minute*60;};

/** Each connector only joins adjacent scored observations from the same day. */
export function buildCustomerQoeChart(calls:CustomerQoeCall[],{scope,mode='all',date}: {
  scope:AnalysisScope;mode?:CustomerQoeChartMode;date?:string;
}){
  const visible=calls.filter(call=>mode!=='day'||call.date===date);
  const min=1,max=5;
  const width=760,height=238,left=45,right=742,top=16,bottom=165,unscoredY=195;
  const firstDay=dayNumber(scope.dateStart),lastDay=dayNumber(scope.dateEnd);
  const first=mode==='day'?timeSecond(scope.from):firstDay*86400;
  const last=mode==='day'?timeSecond(scope.to)+60:(lastDay+1)*86400;
  const span=Math.max(1,last-first);
  const y=(score:number)=>bottom-(Math.max(min,Math.min(max,score))-min)/(max-min)*(bottom-top);
  const points:CustomerQoeChartPoint[]=visible.map(call=>{
    // Equal timestamps share their actual x coordinate; arrow navigation resolves overlap.
    const instant=mode==='day'?call.startSecond:dayNumber(call.date)*86400+call.startSecond;
    return {call,x:Math.max(left,Math.min(right,left+(instant-first)/span*(right-left))),y:call.qoe===null?unscoredY:y(call.qoe),
      outOfRange:call.qoe===null?null:call.qoe<min?'below':call.qoe>max?'above':null};
  });
  const segments:CustomerQoeChartPoint[][]=[];
  let segment:CustomerQoeChartPoint[]=[];
  const flush=()=>{if(segment.length>1)segments.push(segment);segment=[];};
  for(const point of points){
    if(point.call.qoe===null){flush();continue;}
    if(segment.length&&segment[0].call.date!==point.call.date)flush();
    segment.push(point);
  }
  flush();
  const ticks=mode==='day'?[0,.25,.5,.75,1].map(fraction=>{
    const second=Math.min(86399,first+fraction*span);
    return {x:left+fraction*(right-left),label:String(Math.floor(second/3600)).padStart(2,'0')+':'+String(Math.floor(second%3600/60)).padStart(2,'0')};
  }):Array.from({length:Math.max(1,Math.round(lastDay-firstDay)+1)},(_,i)=>({
    x:left+((i+.5)*86400)/span*(right-left),label:new Date((firstDay+i)*86400000).toISOString().slice(5,10),
  }));
  const dayBreaks=mode==='day'?[]:Array.from({length:Math.max(0,Math.round(lastDay-firstDay))},(_,i)=>left+(i+1)*86400/span*(right-left));
  return {points,segments,min,max,width,height,left,right,top,bottom,unscoredY,y,ticks,dayBreaks};
}
