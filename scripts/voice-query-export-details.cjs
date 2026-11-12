const fs=require('node:fs');
const path=require('node:path');
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const second=value=>{const m=String(value??'').match(/(?:T|^)(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0):0;};
/** CSV reads only the selected row's original partition. Retain eight compact
 * call-metric maps, never full sample arrays or the global source catalog. */
function createExportDetailReader({publicDir,entryFor}){
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
    for(const sample of detail?.samples??[]){
      const c=records.get(sample[19]);if(!c)continue;const t=numeric(sample[0])??second(sample[1]),start=second(c.start),end=second(c.end);
      if(sample[21]?.inCallWindow===false||!(end>=start?t>=start&&t<end+1:t>=start||t<end+1))continue;
      const row=observed.get(c.id)??{count:0,rsrp:0,rsrpCount:0,sinr:0,sinrCount:0};row.count++;
      for(const [field,index] of [['rsrp',10],['sinr',12]]){const value=numeric(sample[index]);if(value!=null){row[field]+=value;row[field+'Count']++;}}observed.set(c.id,row);
    }
    for(const c of records.values()){
      const o=observed.get(c.id),matched=c.matchStatus==='MATCHED'&&(c.hasMdt??Boolean(o?.count));
      calls.set(c.id,{rtp:c.rtp,rsrp:matched?(numeric(c.rsrp)??(o?.rsrpCount?o.rsrp/o.rsrpCount:null)):null,sinr:matched?(numeric(c.sinr)??(o?.sinrCount?o.sinr/o.sinrCount:null)):null});
    }
    while(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,calls);return calls.get(rawCallId);
  };
}
module.exports={createExportDetailReader};
