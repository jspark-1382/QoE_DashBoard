/* Build real per-call MDT RSRP histograms for every GPS/MDT mixed poor-QoE call.
 * No fabricated chart values, no frequency-based shaping, no RF imputation.
 * Partitions and call identities must match the signed source revision.
 */
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const pub=path.join(root,'public');
const read=(p)=>JSON.parse(fs.readFileSync(path.join(pub,p),'utf8'));
const manifest=read('voice-1030.json');
const index=read('quality-improvement-mixed-full/index.json');
const dateScope=index.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30'&&e.scope.from==='00:00'&&e.scope.to==='23:59');
if(!dateScope)throw Error('Required full-period mixed evidence scope missing');
const summary=read('quality-improvement-mixed-full/'+dateScope.path);
const observed=read('quality-improvement-mixed-full/'+summary.observationPath);
const revision=index.sourceRevision;
if(revision!==manifest.meta.revision||observed.scope.sourceRevision!==revision||summary.locationMode!=='gps-mdt-rough-unvalidated-v1')throw Error('Source revision or candidate policy conflict');
const manifestByCustomer=new Map(manifest.days.map(d=>[d.date+'|'+d.customerId,d]));
const cache=new Map();
const result={schemaVersion:'qoe-candidate-mdt-rsrp-v1',sourceRevision:revision,
 dataBasis:'all-original-serving-MDT-RSRP-rows-per-poor-call',
 source:'voice-1030.json -> original customer/day MDT partitions',
 binWidthDb:5,validRangeDbm:[-160,-25],includes:'all raw serving-cell MDT sample rows matching each GPS-or-MDT member CDR call',
 excludes:'invalid/non-finite/null/out-of-physical-range RSRP; no invented values, no frequency filter; neighbor objects not counted as serving rows',
 earfcnSource:'original sample[21].frequency = MDT dlearfcn, integer only; all available EARFCN series retained',
 records:{}};
const stats={calls:0,withValid:0,allRows:0,validRows:0,excludedRows:0,missingPartitions:0,rough:0,gps:0};
for(const p of observed.points){
 const callId=p.callId, key=p.date+'|'+p.customerId;
 if(result.records[callId])throw Error('Duplicate evidence call: '+callId);
 const source=manifestByCustomer.get(key);
 if(!source||!source.dataPath||!/^voice-1030-data\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.json$/.test(source.dataPath))throw Error('Missing/unsafe partition for '+callId);
 let day=cache.get(source.dataPath);
 if(!day){
  day=read(source.dataPath);
  if(day.date!==p.date||day.customerId!==p.customerId)throw Error('Source partition identity mismatch '+source.dataPath);
  cache.set(source.dataPath,day);
 }
 const rawId=p.rawCallId||p.callId.slice(p.callId.lastIndexOf(':')+1);
 if(!rawId||!p.callId.endsWith(':'+rawId))throw Error('CDR ID cannot be linked '+callId);
 const bins={},earfcnBins={};let all=0,valid=0;
 for(const sample of day.samples){
  if(sample[19]!==rawId)continue;
  all++;
  const rsrp=sample[10];
  if(typeof rsrp!=='number'||!Number.isFinite(rsrp)||rsrp < -160||rsrp > -25)continue;
  const bin=String(Math.floor(rsrp/5)*5);
  bins[bin]=(bins[bin]||0)+1;
  const dlearfcn=sample[21]?.frequency;
  const freq=typeof dlearfcn==='number'&&Number.isSafeInteger(dlearfcn)&&dlearfcn>=0?String(dlearfcn):'unknown';
  const freqBins=earfcnBins[freq]??(earfcnBins[freq]={});
  freqBins[bin]=(freqBins[bin]||0)+1;
  valid++;
 }
 if(!all)throw Error('No linked raw MDT measurement rows: '+callId);
 if(!valid)throw Error('Linked call has no valid raw MDT RSRP: '+callId);
 if(Object.values(bins).reduce((a,b)=>a+b,0)!==valid)throw Error('Histogram conservation failed '+callId);
 if(Object.values(earfcnBins).reduce((sum,freqBins)=>sum+Object.values(freqBins).reduce((a,b)=>a+b,0),0)!==valid)throw Error('dlearfcn series conservation failed '+callId);
 result.records[callId]={validRows:valid,excludedRows:all-valid,totalRows:all,bins,earfcnBins};
 stats.calls++;stats.allRows+=all;stats.validRows+=valid;stats.excludedRows+=(all-valid);
 stats.withValid+=Number(valid>0);if(p.kind==='rough')stats.rough++;else if(p.kind==='gnss')stats.gps++;
}
if(stats.calls!==237||stats.rough!==106||stats.gps!==131)throw Error('Unexpected mixed-call distribution: '+JSON.stringify(stats));
const dest=path.join(pub,'quality-improvement','candidate-mdt-rsrp-v1.json');
fs.writeFileSync(dest,JSON.stringify(result),'utf8');
console.log(JSON.stringify({output:path.relative(root,dest),sourceRevision:revision,stats,
 firstCandidate:Object.fromEntries((()=>{
  const d=read('quality-improvement-mixed-full/'+summary.candidates[0].detailPath);
  const n={};let valid=0,excluded=0;
  for(const p of d.candidate.nearbyPoints.filter(x=>x.role==='discovery-member')){
   const r=result.records[p.callId];
   if(!r)throw Error('Missing first-candidate evidence '+p.callId);
   valid+=r.validRows;excluded+=r.excludedRows;
   for(const [bin,count] of Object.entries(r.bins))n[bin]=(n[bin]||0)+count;
  }
  return Object.entries({validRows:valid,excludedRows:excluded,...n});
 })())},null,2));
