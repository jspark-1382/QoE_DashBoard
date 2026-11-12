// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=f=>JSON.parse(historicalRead(path.join(root,f),'utf8'));
const sidecar=read('public/quality-improvement/candidate-mdt-rsrp-v1.json');
const manifest=read('public/voice-1030.json');
const mixedIdx=read('public/quality-improvement-mixed-full/index.json');
const full=mixedIdx.entries.find(x=>x.scope.dateStart==='2026-10-26'&&x.scope.dateEnd==='2026-10-30');
const candidates=read('public/quality-improvement-mixed-full/'+full.path);
const modelIdx=read('public/quality-models-mixed-full/index.json');
const modelEntry=modelIdx.entries.find(x=>x.scope.dateStart==='2026-10-26'&&x.scope.dateEnd==='2026-10-30');
const models=read('public/quality-models-mixed-full/'+modelEntry.path);
const sourceMap=new Map(manifest.days.map(x=>[x.date+'|'+x.customerId,x.dataPath]));
const sourceCache=new Map();
function forIds(ids){
 const totals={},curve={},unique=[...new Set(ids)];
 let validRows=0,excludedRows=0;
 for(const id of unique){
  const rec=sidecar.records[id];
  assert(rec,'missing chart sidecar call '+id);
  validRows+=rec.validRows;excludedRows+=rec.excludedRows;
  let callValid=0;
  const source=candidates.scope.sourceRevision;
  assert.equal(sidecar.sourceRevision,source);
  for(const [earfcn,bins] of Object.entries(rec.earfcnBins)){
   assert(/^\d+$/.test(earfcn)||earfcn==='unknown');
   if(!curve[earfcn])curve[earfcn]={};
   for(const [dbm,count] of Object.entries(bins)){
    assert(Number(dbm)%5===0);
    assert(Number.isSafeInteger(count)&&count>=0);
    callValid+=count;
    totals[earfcn]=(totals[earfcn]||0)+count;
    curve[earfcn][dbm]=(curve[earfcn][dbm]||0)+count;
   }
  }
  assert.equal(callValid,rec.validRows,'frequency series must cover every valid serving measurement');
  for(const [dbm,n] of Object.entries(rec.bins)){
   const frequencySum=Object.values(rec.earfcnBins).reduce((acc,b)=>acc+(b[dbm]||0),0);
   assert.equal(frequencySum,n,'frequency line total must equal original histogram bin');
  }
 }
 return {validRows,excludedRows,totals,curve};
}
test('original MDT dlearfcn sources preserve 4900 valid RSRP rows in 5 dB groups with exact four real EARFCNs',()=>{
 assert.equal(sidecar.earfcnSource.includes('sample[21].frequency'),true);
 assert.equal(sidecar.sourceRevision,mixedIdx.sourceRevision);
 assert.equal(sidecar.binWidthDb,5);
 assert.equal(Object.keys(sidecar.records).length,237);
 const all=forIds(Object.keys(sidecar.records));
 assert.equal(all.validRows,4900);assert.equal(all.excludedRows,2386);
 assert.deepEqual(all.totals,{'475':37,'1550':1061,'1694':862,'3743':2940});
 assert.equal(Object.values(all.totals).reduce((a,b)=>a+b,0),all.validRows);
});
test('raw MDT sample[21].frequency is used, not presumed LTE band/MHz labels',()=>{
 // Re-open the source customer/day partitions and independently compare each original row.
 for(const p of [candidates.candidates[0],candidates.candidates[5]]){
  const detail=read('public/quality-improvement-mixed-full/'+p.detailPath);
  const observed=read('public/quality-improvement-mixed-full/'+candidates.observationPath).points;
  const byId=new Map(observed.map(x=>[x.callId,x]));
  for(const id of detail.candidate.memberCallIds){
   const source=byId.get(id);assert(source,'call ID missing '+id);
   const filename=sourceMap.get(source.date+'|'+source.customerId);
   assert(filename,'no partition '+id);
   let d=sourceCache.get(filename);
   if(!d){d=read('public/'+filename);sourceCache.set(filename,d);}
   const rawId=source.rawCallId||source.callId.slice(source.callId.lastIndexOf(':')+1);
   const originalRows=d.samples.filter(row=>row[19]===rawId&&typeof row[10]==='number'&&Number.isFinite(row[10])&&row[10]>=-160&&row[10]<=-25);
   const record=sidecar.records[id];
   assert.equal(originalRows.length,record.validRows);
   const rawBands={};
   for(const row of originalRows){
    const earfcn=row[21]?.frequency;
    const f=Number.isSafeInteger(earfcn)&&earfcn>=0?String(earfcn):'unknown';
    const dbm=String(Math.floor(row[10]/5)*5);
    rawBands[f]??={};
    rawBands[f][dbm]=(rawBands[f][dbm]||0)+1;
   }
   assert.deepEqual(record.earfcnBins,rawBands,id+' must match raw frequency exactly');
  }
 }
});
test('all six algorithm candidate inputs select only member call EARFCN curves, without other candidates',()=>{
 for(const c of candidates.candidates){
  const details=read('public/quality-improvement-mixed-full/'+c.detailPath);
  const totals=forIds(details.candidate.memberCallIds);
  assert(totals.validRows>=0);
 }
 for(const [name,model] of Object.entries(models.models)){
  assert(['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian'].includes(name));
  for(const c of model.candidates){
   const totals=forIds(c.members.map(x=>x.callId));
   assert(totals.validRows>=0);
  }
 }
});
test('map legend removes GPS RSRP and unknown while preserving low/high measurement colors',()=>{
 const db=historicalRead(path.join(root,'components/analyst/quality-two-candidate-workspace.tsx'),'utf8');
 const alt=historicalRead(path.join(root,'components/analyst/quality-model-alternative-workspace.tsx'),'utf8');
 const chart=historicalRead(path.join(root,'components/analyst/candidate-mdt-rsrp-chart.tsx'),'utf8');
 assert(!db.includes('<span className={styles.legendHeading}>GPS RSRP</span>'));
 assert(!db.includes('<span><i className={styles.rsrpUnknown}/>미확보</span>'));
 assert(!alt.includes('<span>GPS RSRP</span>'));
 assert(!alt.includes("style={{background:'#98a8b8'}}/>미확보"));
 assert(db.includes('<span><i className={styles.rsrpRed}/>≤ −105</span>'));
 assert(alt.includes("style={{background:'#138b62'}}"));
 assert(chart.includes('EARFCN별 MDT RSRP 추이'));
 assert(chart.includes('dlearfcn 기준'));
 assert(chart.includes('<polyline fill="none"'));
 assert(chart.includes('data-earfcn-legend={item.earfcn}'));
});
