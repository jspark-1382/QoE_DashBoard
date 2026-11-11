const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const source=fs.readFileSync(path.join(root,'components/analyst/candidate-mdt-rsrp-chart.tsx'),'utf8');
const basic=fs.readFileSync(path.join(root,'components/analyst/quality-two-candidate-workspace.tsx'),'utf8');
const alternative=fs.readFileSync(path.join(root,'components/analyst/quality-model-alternative-workspace.tsx'),'utf8');
const map=fs.readFileSync(path.join(root,'components/analyst/improvement-candidate-map.tsx'),'utf8');
const symbols=fs.readFileSync(path.join(root,'components/analyst/gps-marker-style.tsx'),'utf8');
const sidecar=read('public/quality-improvement/candidate-mdt-rsrp-v1.json');
const index=read('public/quality-improvement-mixed-full/index.json');
const e=index.entries.find(x=>x.scope.dateStart==='2026-10-26'&&x.scope.dateEnd==='2026-10-30');
const summary=read('public/quality-improvement-mixed-full/'+e.path);
const modelIndex=read('public/quality-models-mixed-full/index.json');
const modelEntry=modelIndex.entries.find(x=>x.scope.dateStart==='2026-10-26'&&x.scope.dateEnd==='2026-10-30');
const models=read('public/quality-models-mixed-full/'+modelEntry.path);
function validateCallIds(ids){
 let total=0,excluded=0;
 for(const id of new Set(ids)){
  const rec=sidecar.records[id];
  assert(rec,'missing MDT record '+id);
  const sum=Object.entries(rec.bins).reduce((acc,[dbm,count])=>{
   assert(Number(dbm)%5===0,'RSRP bin must be divisible by 5'); assert(Number.isInteger(count)&&count>=0);
   return acc+count;
  },0);
  assert.equal(sum,rec.validRows,id);
  assert.equal(rec.totalRows,rec.validRows+rec.excludedRows,id);
  total+=rec.validRows;excluded+=rec.excludedRows;
 }
 return {total,excluded};
}
test('source-linked real MDT counts include all 237 GPS/MDT calls, preserving 5 dB bucket conservation',()=>{
 assert.equal(sidecar.schemaVersion,'qoe-candidate-mdt-rsrp-v1');
 assert.equal(sidecar.sourceRevision,index.sourceRevision);
 assert.equal(sidecar.binWidthDb,5);
 assert.equal(Object.keys(sidecar.records).length,237);
 const all=validateCallIds(Object.keys(sidecar.records));
 assert.equal(all.total,4900);
 assert.equal(all.excluded,2386);
});
test('selected DBSCAN candidate plots the actual included 18 CDR call MDT sample rows and never example bars',()=>{
 assert.equal(summary.candidates.length,22);
 const detail=read('public/quality-improvement-mixed-full/'+summary.candidates[0].detailPath);
 const ids=detail.candidate.memberCallIds;
 assert.equal(new Set(ids).size,18);
 const r=validateCallIds(ids);
 assert.equal(r.total,895);
 assert.equal(r.excluded,875);
 assert(source.includes('aggregateCandidateMdtRsrp(state.sidecar,callIds)'));
 assert(source.includes('Math.floor(rsrp/5)')===false,'no inventing values on client');
 assert(source.includes('data-earfcn={item.earfcn} data-rsrp-bin={p.dbm} data-count={p.count}'));
 assert(source.includes('<polyline fill="none" stroke={color}'));
 assert(source.includes('<circle key={p.dbm}'));
 assert(source.includes('Count</text>'));
 assert(source.includes('RSRP (dBm)</text>'));
});
test('all five alternative algorithms use the identical call-specific MDT histogram data',()=>{
 for(const name of ['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian']){
  for(const c of models.models[name].candidates){
   const ids=c.members.map(x=>x.callId);
   assert.equal(ids.length,new Set(ids).size);
   validateCallIds(ids);
  }
 }
});
test('both candidate pages, full screen rails, and RF markers are circular without frequency labels',()=>{
 assert(basic.includes('rsrpChart={selected?<CandidateMdtRsrpChart'));
 assert(basic.includes('{selected&&<CandidateMdtRsrpChart'));
 assert(alternative.includes('rsrpChart={active?<CandidateMdtRsrpChart'));
 assert(alternative.includes("{detailTab==='summary'&&<CandidateMdtRsrpChart"));
 assert(!basic.includes('GPS_BANDS.map'));
 assert(!alternative.includes('GPS_BANDS.map'));
 assert(!basic.includes('GpsLegendSymbol'));
 assert(!alternative.includes('GpsLegendSymbol'));
 assert(symbols.includes('<circle cx='));
 assert(!symbols.includes('<polygon'));
 assert(!symbols.includes('<rect'));
 assert(map.includes('html:gpsMarkerSvg(band,rf?.rsrpDbm)'));
 assert(map.includes('<circle cx='));
 assert(!map.includes('<polygon'));
});
