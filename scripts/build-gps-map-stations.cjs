/* Read-only extraction of exact same-call, same-time GPS serving-station evidence. */
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../public');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'voice-1030.json'),'utf8'));
const valid=s=>s&&!s.isVirtual&&s.baseStationId&&s.cellId&&
  Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)&&
  Math.abs(s.latitude)<=90&&Math.abs(s.longitude)<=180&&(s.latitude!==0||s.longitude!==0);
const output=path.join(root,'gps-map-stations');
fs.mkdirSync(output,{recursive:true});
for(const date of manifest.meta.dates){
  const overview=JSON.parse(fs.readFileSync(path.join(root,'analyst-overview/MDT',date+'.json'),'utf8'));
  if(overview.sourceRevision!==manifest.meta.revision)throw Error('GPS station source revision mismatch: '+date);
  const calls=new Map(overview.calls.map(c=>[c.id,c]));
  const entries=new Map(manifest.days.filter(d=>d.date===date).map(d=>[d.customerId,d]));
  const cache=new Map(),records={};
  const stats={gps:0,matched:0,missing:0};
  for(const p of overview.callLocations??[]){
    if(p.evidence!=='gnss')continue;
    stats.gps++;
    const call=calls.get(p.callId),entry=entries.get(call?.customerId);
    const timestamp=Date.parse(p.observedAt);
    if(!entry?.dataPath||!call?.rawCallId||!Number.isFinite(timestamp)){stats.missing++;continue;}
    const partitionPath=path.resolve(root,entry.dataPath);
    if(!partitionPath.startsWith(root+path.sep))throw Error('Invalid GPS station partition path');
    let partition=cache.get(partitionPath);
    if(!partition){
      partition=JSON.parse(fs.readFileSync(partitionPath,'utf8'));
      if(partition.date!==date||partition.customerId!==call.customerId)throw Error('GPS station partition identity mismatch');
      cache.set(partitionPath,partition);
    }
    const rows=partition.samples.filter(r=>r[19]===call.rawCallId&&
      r[21]?.locationSource==='gnss'&&Date.parse(r[21].timestamp)===timestamp);
    if(rows.length!==1){stats.missing++;continue;}
    const observed=rows[0][21];
    const matches=(partition.baseStations??[]).filter(s=>valid(s)&&
      s.baseStationId===observed.baseStationId&&s.cellId===observed.cellId);
    // No nearest-site guessing or arbitrary choice among different coordinates.
    if(new Set(matches.map(s=>s.latitude+'/'+s.longitude)).size!==1){stats.missing++;continue;}
    const s=matches[0];
    records[p.callId]={observedAt:p.observedAt,matchedBy:'source-date-customer-call-and-observed-time',
      station:{baseStationId:s.baseStationId,cellId:s.cellId,latitude:s.latitude,longitude:s.longitude,
        frequency:observed.frequency??null,technology:s.technology??'LTE',isVirtual:false,
        pci:s.pci??null,inventorySource:s.inventorySource,provenanceUnknown:s.provenanceUnknown??true}};
    stats.matched++;
  }
  fs.writeFileSync(path.join(output,date+'.json'),JSON.stringify({schemaVersion:'gps-map-stations-v1',
    sourceRevision:overview.sourceRevision,date,stats,records}));
  console.log(JSON.stringify({date,...stats}));
}
