/* Blind historical GNSS holdout, PII-minimal.
 * A true FIX is intentionally hidden; infer its location from strictly earlier
 * samples in the SAME call, and compare to the hidden GNSS coordinate.
 * Never use a future GNSS, a future radio report or future BYE metadata in
 * causal predictors. BYE position is labelled a RETROSPECTIVE tower baseline.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {load}=require('./analyst-ts-loader.cjs');
const {estimateAdaptive}=load('lib/location-estimation/adaptive.ts');
const {reviewAdaptivePosition}=load('lib/location-estimation/review.ts');
const {distanceM,offsetPoint}=load('lib/location-estimation/geo.ts');
const {latestGnssReference}=load('lib/location-estimation/gnss-reference.ts');
const ROOT=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'public/voice-1030.json'),'utf8'));
const siteMap=new Map();
for(const day of manifest.meta.dates){
 const overview=JSON.parse(fs.readFileSync(path.join(ROOT,'public/analyst-overview/MDT',day+'.json'),'utf8'));
 for(const p of overview.callLocations){
  if(p.byeRuId&&p.byeStationLat!=null&&p.byeStationLon!=null){
   siteMap.set(p.callId,{
    latitude:p.byeStationLat,longitude:p.byeStationLon,ru:p.byeRuId,cell:p.byeCellId,
   });
  }else if(p.evidence==='bye-cell'&&p.byeRuId){
   siteMap.set(p.callId,{latitude:p.lat,longitude:p.lon,ru:p.byeRuId,cell:p.byeCellId});
  }
 }
}
const safe=(v)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const percentile=(a,p)=>a.length?a[Math.min(a.length-1,Math.ceil(p*a.length)-1)]:null;
const fmt=(v)=>v==null?null:+v.toFixed(2);
const hashed=(text)=>crypto.createHash('sha256').update(text).digest('hex').slice(0,14);
const bucket=age=>age<10?'1-10s':age<30?'10-30s':age<60?'30-60s':'60-180s';
const groups=new Map();let reviewedCalls=0,olderFixNeeded=0,badTime=0;
let noDistinctNewGnssFix=0;
const dayStats={};let solverCalls=0;
for(const item of manifest.days){
 if(!item.gnssSampleCount)continue;
 const detail=JSON.parse(fs.readFileSync(path.join(ROOT,'public',item.dataPath),'utf8'));
 const byCall=new Map();
 for(let i=0;i<detail.samples.length;i++){
  const row=detail.samples[i],key=row[19],md=row[21]||{};
  const t=Date.parse(md.timestamp??'');
  if(!Number.isFinite(t))continue;
  const group=byCall.get(key)||[];
  group.push({i,t,lat:safe(row[2]),lon:safe(row[3]),
    isGnss:md.locationSource==='gnss'&&safe(row[2])!=null&&safe(row[3])!=null,
    cellId:String(md.cellId||''),baseStationId:String(md.baseStationId||''),
    matched:md.baseStationMatched===true&&md.masterMatchLevel!=='unmatched',
    rsrp:safe(row[10]),rsrq:safe(row[11]),sinr:safe(row[12])});
  byCall.set(key,group);
 }
 for(const [callId,rawRows] of byCall){
  const fixes=rawRows.filter(row=>row.isGnss).sort((a,b)=>a.t-b.t||a.i-b.i);
  if(fixes.length<2)continue;
  reviewedCalls++;
  // Never score the last *repeated* GNSS report as an independent fix.
  // Construct a sequence of genuinely new coordinates, then blind the last
  // new coordinate. Multiple MDT rows may repeat one GNSS metric ID/position.
  const novel=[];
  for(const fix of fixes){
    if(!novel.length||distanceM(
      {latitude:fix.lat,longitude:fix.lon},
      {latitude:novel.at(-1).lat,longitude:novel.at(-1).lon},
    )>=0.5)novel.push(fix);
  }
  if(novel.length<2){noDistinctNewGnssFix++;continue;}
  const target=novel.at(-1);
  const older=novel.filter(row=>row.t<target.t);
  if(!older.length){badTime++;continue;}
  const reference=latestGnssReference(
    older.map(p=>({timestamp:p.t,lat:p.lat,lon:p.lon,locationSource:'gnss'})),
    target.t);
  if(!reference){olderFixNeeded++;continue;}
  const age=reference.ageSeconds;
  if(age<1)continue; // prevent near-duplicate GNSS frames masquerading as independent localization
  const truth={latitude:target.lat,longitude:target.lon};
  const locf={latitude:reference.lat,longitude:reference.lon};
  const prior=older.filter(p=>p.t<reference.observedAt).at(-1);
  let velocity=null;
  if(prior){
   const span=(reference.observedAt-prior.t)/1000;
   const displacement=distanceM({latitude:prior.lat,longitude:prior.lon},locf);
   const measuredKmh=span>0?displacement/span*3.6:Infinity;
   if(span>=2&&span<=120&&measuredKmh<=120){
    // Candidate method, not adopted until independent evaluation.
    const e=(locf.longitude-prior.lon)*Math.PI/180*6371009*Math.cos(reference.lat*Math.PI/180);
    const n=(locf.latitude-prior.lat)*Math.PI/180*6371009;
    velocity=offsetPoint(locf,e/span*age,n/span*age);
   }
  }
  const prefix=rawRows.filter(row=>row.t<target.t||(row.t===target.t&&row.i<=target.i))
    .sort((a,b)=>a.t-b.t||a.i-b.i);
  const stations=detail.baseStations??[];
  const associated=stations.filter(station=>prefix.some(s=>s.matched&&
    s.baseStationId===station.baseStationId&&s.cellId===station.cellId));
  const input=prefix.map(s=>({
   timestamp:s.t,cellId:s.cellId,baseStationId:s.matched?s.baseStationId:'',
   frequency:null,rsrp:s.rsrp,rsrq:s.rsrq,sinr:s.sinr,
   streamId:callId,sampleIndex:s.i,measuredLat:null,measuredLon:null,
  }));
  // Target GNSS hidden from solver and from both prediction branches.
  const result=estimateAdaptive(input,associated);
  solverCalls++;
  const last=result.positions.find(p=>p.sample.sampleIndex===target.i);
  const candidate=last?.estimatedLat!=null&&last.estimatedLon!=null
    ?{latitude:last.estimatedLat,longitude:last.estimatedLon}:null;
  const review=last?reviewAdaptivePosition(last):null;
  const accepted=!!(candidate&&review?.accepted&&
    distanceM(candidate,locf)<=reference.movementRadiusM);
  const call=detail.calls.find(c=>c.id===callId);
  const quality=call?.mos==null?'unscored':call.mos<3?'poor':call.mos<3.5?'fair':'good';
  const tower=siteMap.get(item.customerId+':'+callId);
  const record={
   fingerprint:hashed(item.customerId+':'+callId),
   customerFingerprint:hashed(item.customerId),
   date:item.date,quality,ageSeconds:age,bucket:bucket(age),
   anchorUncertaintyM:reference.movementRadiusM,
   locationErrorM:distanceM(truth,locf),
   withinAssumedRadius:distanceM(truth,locf)<=reference.movementRadiusM,
   velocityErrorM:velocity?distanceM(truth,velocity):null,
   towerErrorM:tower?distanceM(truth,tower):null,
   radioErrorM:candidate?distanceM(truth,candidate):null,
   radioGeometry:fmt(last?.geometry),
   radioSiteCount:last?.siteCount??0,
   radioAccepted:review?.accepted??false,
   radioReasons:review?.reasons??[],
   fusedErrorM:accepted?distanceM(truth,candidate):distanceM(truth,locf),
   fusedUsedRadio:accepted,
   hasPastTwoGnss:!!velocity,
  };
  const a=groups.get(item.date)||[];
  a.push(record);groups.set(item.date,a);
 }
}
const all=[...groups.values()].flat();
function summarize(a){
 const q=(f)=>{const v=a.map(f).filter(x=>x!=null&&Number.isFinite(x)).sort((x,y)=>x-y);return{n:v.length,medianM:fmt(percentile(v,.5)),p90M:fmt(percentile(v,.9)),under100m:v.length?fmt(v.filter(x=>x<=100).length/v.length*100):null,under250m:v.length?fmt(v.filter(x=>x<=250).length/v.length*100):null}};
 return {
  cases:a.length,distinctCallHashes:new Set(a.map(x=>x.fingerprint)).size,
  anchor:q(x=>x.locationErrorM),
  assumedRadius:{medianM:fmt(percentile(a.map(x=>x.anchorUncertaintyM).sort((x,y)=>x-y),.5)),
    containsHiddenGnssPct:a.length?fmt(a.filter(x=>x.withinAssumedRadius).length/a.length*100):null},
  velocity:q(x=>x.velocityErrorM),retrospectiveByeTower:q(x=>x.towerErrorM),
  oldRsrpCandidate:q(x=>x.radioErrorM),strictRadioAccepted:a.filter(x=>x.radioAccepted).length,
  fused:q(x=>x.fusedErrorM),fusedUsedRadio:a.filter(x=>x.fusedUsedRadio).length,
  poorCases:a.filter(x=>x.quality==='poor').length,
 };
}
const testDays=['2026-10-29','2026-10-30'];
const test=all.filter(x=>testDays.includes(x.date));
const heldoutCustomers=new Set(test.map(x=>x.customerFingerprint));
const train=all.filter(x=>!testDays.includes(x.date)&&!heldoutCustomers.has(x.customerFingerprint));
const report={
 title:'GNSS changed-coordinate blind holdout (no repeated fix identity scoring), causal prefix only; no model trained',
 inputRevision:manifest.meta.revision,policy:{
  target:'last GENUINELY CHANGED GNSS coordinate (>=0.5m), NOT repeated event, one per call; prior different fix 1..180s',
  pastOnly:true,noTargetGnssInEstimator:true,noFutureMdtInEstimator:true,
  source:'raw GNSS coordinates in CDR-linked detail partitions',
  pseudoGroundTruth:'GNSS fix; source accuracy and survey-grade reference unknown',
  leakage:'One target per call; no future position or radio rows in causal methods. Retrospective BYE tower is NOT causal. Development excludes test-date customers; no model fit.',
  runDate:'2026-11-04',
 },
 countChecks:{availableGnssCalls:reviewedCalls,gnssFixesRepeatedWithoutMovement:noDistinctNewGnssFix,
  gnssFixesNoPriorWithin180:olderFixNeeded,sameTimestampNoIndependentAnchor:badTime,solverCalls},
 byDate:Object.fromEntries([...groups].map(([date,v])=>[date,summarize(v)])),
 byAge:Object.fromEntries(['1-10s','10-30s','30-60s','60-180s'].map(b=>[b,summarize(all.filter(x=>x.bucket===b))])),
 temporalTestDays:testDays,
 all:summarize(all),test:summarize(test),development:summarize(train),
 customerDisjointCheck:[...new Set(train.map(x=>x.customerFingerprint))].every(k=>!heldoutCustomers.has(k)),
 baselineDecision:'Keep GNSS reference unless a candidate beats it on independent test across error median, P90 and coverage; no arbitrary coordinate correction',
 caveats:['GNSS fix is not survey-grade ground truth','No RTCP time-segment labels included in this location study',
  'BYE Cell evaluated retrospectively with possibly later time; it is a tower, not handset',
  'Same-call GNSS frames are temporally correlated; one holdout per call mitigates but does not prove site-wide generalization.'],
};
const out=path.join(ROOT,'outputs','position-gnss-change-holdout.json');
fs.writeFileSync(out,JSON.stringify(report,null,2));
const perPath=path.join(ROOT,'outputs','position-gnss-change-holdout-cases.json');
fs.writeFileSync(perPath,JSON.stringify({runDate:'2026-11-04',rows:all.map(({radioReasons,...v})=>v)},null,2));
console.log('HOLDOUT_SUMMARY',JSON.stringify({all:report.all,test:report.test,byAge:report.byAge,countChecks:report.countChecks}));
console.log('SAVED',out,perPath);
