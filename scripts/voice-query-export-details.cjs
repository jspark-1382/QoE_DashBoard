/* eslint-disable @typescript-eslint/no-require-imports -- Server-only CommonJS source reader. */
const fs=require('node:fs');
const path=require('node:path');
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const second=value=>{const m=String(value??'').match(/(?:T|^)(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0):0;};
const structuralId=value=>typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'&&/^[\w.:-]{1,128}$/.test(value)?value:null;
const timestamp=value=>typeof value==='string'&&/^(?:\d{4}-\d{2}-\d{2}T)?\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)?value:null;
const radioTriggers=new Set(['A1','A2','A3','A4','A5','A6','B1_NR','B2_NR']);
const terminationKeys=['fcRaw','reasonRaw','releaseCauseRaw','secondaryReleaseCause1Raw','secondaryReleaseCause2Raw','sipFailResponseCodeRaw','byeReasonRaw','callDirectionRaw'];
function originalTermination(call){
 const fields=call.termination??{fcRaw:call.fc,releaseCauseRaw:call.q850Cause,callDirectionRaw:call.direction};
 const result=Object.fromEntries(terminationKeys.map(key=>[key,fields[key]==null||fields[key]===''?null:String(fields[key])]));
 return Object.values(result).some(v=>v!==null)?result:null;
}
function radioObservation(sample){
 const m=sample[21]&&typeof sample[21]==='object'?sample[21]:{};
 return {timestamp:timestamp(m.timestamp)??timestamp(sample[1]),cellId:structuralId(m.cellId),
  servingPci:numeric(sample[9]),radioTechnology:['LTE','NR'].includes(sample[8])?sample[8]:null,
  frequency:numeric(m.frequency),rsrp:numeric(sample[10]),rsrq:numeric(sample[11]),sinr:numeric(sample[12]),phr:numeric(m.phr),
  ...(radioTriggers.has(m.triggerEvent)?{triggerEvent:m.triggerEvent}:{}),
  neighbors:Array.isArray(m.neighbors)?m.neighbors.slice(0,64).map(n=>({pci:numeric(n?.pci),rsrp:numeric(n?.rsrp)})).filter(n=>n.pci!==null||n.rsrp!==null):[]};
}
/** Read only the selected original partition; keep eight compact call maps.
 * The location view can request the recorded POT ID. Raw coordinates and
 * stream identifiers stay within the partition reader. */
function createExportDetailReader({publicDir,entryFor,exactWindow=false,sourceRevision,includeObservedPot=false}){
 const cache=new Map(),base=fs.realpathSync(publicDir);
 return (customerId,date,rawCallId)=>{
  const key=customerId+':'+date;let calls=cache.get(key);
  if(calls){cache.delete(key);cache.set(key,calls);return calls.get(rawCallId);}
  const entry=entryFor(customerId,date);let detail=entry;
  if(entry?.dataPath){
   const file=path.resolve(publicDir,entry.dataPath);
   if(!file.startsWith(path.resolve(publicDir)+path.sep))throw Error('Invalid original detail path');
   const real=fs.realpathSync(file);if(!real.startsWith(base+path.sep))throw Error('Original detail path leaves the published data directory');
   if(fs.statSync(real).size>64*1024*1024)throw Error('Original detail partition exceeds the 64 MiB local export memory limit. Export a smaller source partition.');
   detail=JSON.parse(fs.readFileSync(real,'utf8'));
  }
  if(detail&&(detail.customerId!==customerId||detail.date!==date))throw Error('Original export detail customer/date mismatch');
  calls=new Map();const records=new Map((detail?.calls??[]).map(c=>[c.id,c])),observed=new Map();
  const triggerPath=exactWindow&&/^[a-f0-9]{20}$/.test(sourceRevision??'')?path.resolve(publicDir,'../outputs/voice-query-data',sourceRevision+'-radio-triggers.sqlite'):null;
  const triggerDb=triggerPath&&fs.existsSync(triggerPath)?new (require('node:sqlite').DatabaseSync)(triggerPath,{readOnly:true}):null;
  try {
  const triggers=triggerDb?.prepare('select revision from meta').get()?.revision===sourceRevision&&triggerDb
    ?triggerDb.prepare('select event from triggers where customer=? and stamp=? and cell=? and pci=? and frequency=?'):null;
  for(const sample of detail?.samples??[]){
   const c=records.get(sample[19]);if(!c)continue;
   const t=numeric(sample[0])??second(sample[1]),start=second(c.start),end=second(c.end);
   if(sample[21]?.inCallWindow===false||!(end>=start?t>=start&&t<end+1:t>=start||t<end+1))continue;
   const observation=radioObservation(sample);
   if(includeObservedPot){
    const source=sample[21];
    observation.pot=source?.locationSource==='gnss'&&typeof source.gnssMetricId==='string'&&/^\d{1,8}_\d{1,8}$/.test(source.gnssMetricId)&&
     Number.isFinite(sample[2])&&Number.isFinite(sample[3])?source.gnssMetricId:null;
   }
   if(exactWindow&&c.startTimestamp&&c.endTimestamp){
    const at=Date.parse(observation.timestamp),begin=Date.parse(c.startTimestamp),finish=Date.parse(c.endTimestamp);
    if(!Number.isFinite(at)||!(begin<=at&&at<=finish))continue;
   }
   if(triggers && observation.timestamp && observation.cellId && observation.servingPci!==null && observation.frequency!==null){
    const match=triggers.get(customerId,observation.timestamp,observation.cellId,observation.servingPci,observation.frequency);
    if(match)observation.triggerEvent=match.event;
   }
   const row=observed.get(c.id)??{count:0,rsrp:0,rsrpCount:0,rsrq:0,rsrqCount:0,sinr:0,sinrCount:0,radioSeries:[]};
   row.count++;
   for(const [field,index] of [['rsrp',10],['rsrq',11],['sinr',12]]){
    const value=numeric(sample[index]);if(value!=null){row[field]+=value;row[field+'Count']++;}
   }
   row.radioSeries.push(observation);observed.set(c.id,row);
  }
  } finally {triggerDb?.close();}
  for(const c of records.values()){
   const o=observed.get(c.id),matched=c.matchStatus==='MATCHED'&&(c.hasMdt??Boolean(o?.count));
   const metric=field=>matched?(numeric(c[field])??(o?.[field+'Count']?o[field]/o[field+'Count']:null)):null;
   calls.set(c.id,{rtp:c.rtp,rsrp:metric('rsrp'),rsrq:metric('rsrq'),sinr:metric('sinr'),radioSeries:matched?(o?.radioSeries??[]):[],termination:originalTermination(c)});
  }
  while(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,calls);return calls.get(rawCallId);
 };
}
module.exports={createExportDetailReader};
