// Deterministic POC regression tests. Run: node scripts/test-location-estimation.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const cache=new Map();
function load(file){
  file=path.resolve(file);
  if(!path.extname(file))file=fs.existsSync(file+'.ts')?file+'.ts':path.join(file,'index.ts');
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const localRequire=id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id)):require(id);
  vm.runInThisContext('(function(require,module,exports){'+js+'\n})',{filename:file})(localRequire,module,module.exports);
  return module.exports;
}
const root='lib/location-estimation/';
const {estimateBaseRadius}=load(root+'rsrp-distance');
const {getFrequencyMultiplier,getTxPowerMultiplier}=load(root+'frequency-adjustment');
const {calculateUncertainty,calculateRadius}=load(root+'uncertainty');
const {generateCandidateGrid}=load(root+'candidate-grid');
const {distanceM,offsetPoint}=load(root+'geo');
const {applyMovementPenalty}=load(root+'trajectory');
const {matchBaseStation}=load(root+'master');
const {estimatePosition,DEFAULT_OPTIONS}=load(root+'index');
const {decideConfidence}=load(root+'confidence');
const {estimateAdaptive,groupPhysicalSites,logDistance,solveWeighted}=load(root+'adaptive');
const {ADAPTIVE_CONFIG}=load(root+'adaptive-config');
let tests=0;
function test(name,fn){fn();tests++;console.log('PASS '+name);}
const station={baseStationId:'A',cellId:'1',frequency:1550,latitude:35.21,longitude:126.86,txPowerDbm:43,txPowerType:'TOTAL',isVirtual:true};
const sample={timestamp:0,baseStationId:'A',cellId:'1',frequency:1550,rsrp:-90,rsrq:null,sinr:null,streamId:'one',sampleIndex:0};
test('Stable causal prefixes, spike smoothing, weak point suppression and segment breaks',()=>{
 const input=Array.from({length:10},(_,i)=>({...sample,timestamp:i*1000,sampleIndex:i,rsrp:i===4?-110:-90}));
 const all=estimatePosition(input,[station]);
 assert.equal(all[4].smoothedRsrp,-90);
 assert.equal(all[4].sample.rsrp,-110);
 assert(all.every(e=>!e.showRepresentative));
 for(let i=1;i<=input.length;i++)assert.deepEqual(estimatePosition(input.slice(0,i),[station]).at(-1),all[i-1]);
 const gap=estimatePosition([...input,{...sample,timestamp:200000,sampleIndex:10}],[station]);
 assert.notEqual(gap.at(-1).segmentId,gap.at(-2).segmentId);
 const missing=estimatePosition([input[0],{...input[1],cellId:'missing',baseStationId:'missing'},input[2]],[station]);
 assert.notEqual(missing[0].segmentId,missing[1].segmentId);
 const interleaved=input.flatMap(s=>[s,{...s,streamId:'two',sampleIndex:s.sampleIndex+100}]);
 assert.deepEqual(estimatePosition(interleaved,[station]).filter(e=>e.sample.streamId==='one'),all);
});
test('Adaptive physical grouping, outlier, log model and nonlinear solver',()=>{
 const b={...station,...offsetPoint(station,600,0),cellId:'2',baseStationId:'B'};
 const c={...station,...offsetPoint(station,0,800),cellId:'3',baseStationId:'C'};
 const distant={...station,latitude:37.3,cellId:'4',baseStationId:'D'};
 const sites=groupPhysicalSites([station,{...station,cellId:'duplicate'},b,c,distant]);
 assert.equal(sites.length,4);assert.equal(sites.filter(s=>s.excluded).length,1);
 assert.equal(logDistance(-65),100);assert(logDistance(-95)>logDistance(-85));
 const truth=offsetPoint(station,180,220);
 const used=[station,b,c].map((s,i)=>({...s,siteId:String(i),weight:1,estimatedDistanceM:distanceM(truth,s),rsrp:-80,deltaTimeSec:0,cellIds:[s.cellId],residualM:0}));
 const solved=solveWeighted(used);assert(distanceM(truth,solved)<2);assert(solved.residual<2);
});
test('Adaptive smallest window, fallback caps, invalid and stream isolation',()=>{
 const b={...station,...offsetPoint(station,600,0),cellId:'2',baseStationId:'B'};
 const c={...station,...offsetPoint(station,0,800),cellId:'3',baseStationId:'C'};
 const input=[sample,{...sample,cellId:'2',baseStationId:'B',timestamp:8000,sampleIndex:1},{...sample,cellId:'3',baseStationId:'C',timestamp:18000,sampleIndex:2}];
 const result=estimateAdaptive(input,[station,b,c]);assert.equal(result.positions[0].windowSec,20);assert.equal(result.positions[0].method,'MULTILATERATION');
 assert(result.positions.every(p=>p.usedSites.length===new Set(p.usedSites.map(s=>s.siteId)).size));
 const two=estimateAdaptive(input.slice(0,2),[station,b]).positions[0];assert.equal(two.method,'WEIGHTED_2_SITE');assert(two.confidenceScore<=64);
 const one=estimateAdaptive([sample],[station]).positions[0];assert.equal(one.method,'CELL_SITE');assert(one.confidenceScore<=49);assert.equal(one.estimatedLat,station.latitude);
 const bad=estimateAdaptive([sample],[]).positions[0];assert.equal(bad.method,'INVALID');assert.equal(bad.estimatedLat,null);
 const separate=estimateAdaptive(input.map((p,i)=>({...p,streamId:String(i)})),[station,b,c]);assert(separate.positions.every(p=>p.siteCount===1));
 const spike=estimateAdaptive([sample,{...input[1],timestamp:200000},{...input[2],timestamp:400000}],[station,b,c]);assert(spike.positions.slice(1).every(p=>p.breakBefore));
});
test('Lookup interpolation, monotonicity and caps',()=>{
 assert.equal(estimateBaseRadius(-82.5),325);assert.equal(estimateBaseRadius(-90),650);
 assert.equal(estimateBaseRadius(-60),100);assert.equal(estimateBaseRadius(-125),4000);
 for(let rsrp=-120;rsrp<-60;rsrp+=.5)assert(estimateBaseRadius(rsrp)>=estimateBaseRadius(rsrp+.5));
 assert.equal(estimateBaseRadius(-90,'site-specific','missing'),null);
});
test('Explicit frequency modes, channel conversion, unconfirmed stays neutral',()=>{
 assert.equal(getFrequencyMultiplier(3743,'unknown').multiplier,1);
 assert.equal(getFrequencyMultiplier(3743,'lte-earfcn').multiplier,1.25);
 assert(Math.abs(getFrequencyMultiplier(1550,'lte-earfcn').mhz-1840)<1e-9);
 assert.equal(getFrequencyMultiplier(900,'mhz').multiplier,1.25);
 assert.equal(getFrequencyMultiplier(2100,'mhz').multiplier,1);
 assert.equal(getFrequencyMultiplier(2600,'mhz').multiplier,.8);
 assert.equal(getFrequencyMultiplier(999999,'lte-earfcn').mhz,null);
});
test('TOTAL relative power capped; RS physical calculation intentionally absent',()=>{
 assert.equal(getTxPowerMultiplier(43,'TOTAL'),1);
 assert(getTxPowerMultiplier(100,'TOTAL')<=1.15);
 assert(getTxPowerMultiplier(0,'TOTAL')>=.85);
 assert.equal(getTxPowerMultiplier(100,'RS'),1);
});
test('Uncertainty defaults, quality worsening expands annulus',()=>{
 assert.equal(calculateUncertainty({}),.4);
 assert.equal(calculateUncertainty({sinr:15}),.25);
 assert.equal(calculateUncertainty({sinr:-1}),.6);
 assert(calculateUncertainty({sinr:15,rsrq:-21})>calculateUncertainty({sinr:15,rsrq:-10}));
 const r=calculateRadius(sample,station,DEFAULT_OPTIONS);
 assert(Math.abs(r.innerRadiusM-390)<1e-8);assert(Math.abs(r.outerRadiusM-910)<1e-8);
 assert.equal(calculateRadius({...sample,rsrp:null},station,DEFAULT_OPTIONS),null);
});
test('Strict cell join, ambiguity rejected and fallback disclosed',()=>{
 assert.equal(matchBaseStation(sample,[station]).mode,'cell');
 assert.equal(matchBaseStation(sample,[station,{...station}]),null);
 assert.equal(matchBaseStation({...sample,cellId:'2'},[station]).mode,'station-fallback');
 assert.equal(matchBaseStation({...sample,baseStationId:'missing',cellId:'missing'},[station]),null);
});
test('Annulus grid excludes the hole; center is a supported candidate',()=>{
 const radius=calculateRadius(sample,station,DEFAULT_OPTIONS);
 const grid=generateCandidateGrid(station,radius);
 assert(grid.candidates.length>0);
 for(const p of grid.candidates){const d=distanceM(p,station);assert(d>=radius.innerRadiusM && d<=radius.outerRadiusM);}
 const result=estimatePosition([sample],[station])[0];
 assert.equal(result.confidence,'LOW');
 assert(result.candidates.some(p=>p.latitude===result.latitude && p.longitude===result.longitude));
});
test('Movement penalty attenuates 2km/5sec, retains 50m/10sec',()=>{
 assert(applyMovementPenalty(station,offsetPoint(station,2000,0),5)<.1);
 assert.equal(applyMovementPenalty(station,offsetPoint(station,50,0),10),1);
});
test('Transitions and weakening/strengthening trends constrain candidates',()=>{
 const b={...station,...offsetPoint(station,1000,0),cellId:'2',baseStationId:'B'};
 const seq=[{...sample,rsrp:-80},{...sample,timestamp:10000,rsrp:-92,sampleIndex:1},
   {...sample,timestamp:15000,baseStationId:'B',cellId:'2',rsrp:-91,sampleIndex:2},
   {...sample,timestamp:25000,baseStationId:'B',cellId:'2',rsrp:-78,sampleIndex:3}];
 const out=estimatePosition(seq,[station,b]);
 assert(out[2].transition);assert(out[3].transition.trend);
 assert(out.every(e=>e.confidence!=='HIGH'));
 assert(out[3].transitionCandidates.length>0);
});
test('Empty, unmatched, missing signals and separate streams are safe',()=>{
 assert.equal(estimatePosition([],[]).length,0);
 assert.equal(estimatePosition([sample],[]).length,0);
 assert.equal(estimatePosition([{...sample,rsrp:null}],[station]).length,0);
 const out=estimatePosition([sample,{...sample,streamId:'two',timestamp:1000}],[station]);
 assert.equal(out[1].historyCount,1);
 const gap=estimatePosition([sample,{...sample,timestamp:1000000}],[station]);
 assert.equal(gap[1].historyCount,1);
});
test('HIGH requires nonvirtual multistation calibrated-format evidence',()=>{
 const evidence={cells:3,history:8,areaKm2:.01,transition:true,trend:true,sinr:20,consistent:true,virtual:true,exact:true,knownFrequency:true,score:1};
 assert.notEqual(decideConfidence(evidence).confidence,'HIGH');
 assert.equal(decideConfidence({...evidence,virtual:false}).confidence,'HIGH');
 assert.equal(decideConfidence({...evidence,cells:1}).confidence,'LOW');
});
if(fs.existsSync('public/mdt-data.json'))test('Local MDT + virtual Master real fixture joins and bounded estimates',()=>{
 const d=JSON.parse(fs.readFileSync('public/mdt-data.json','utf8'));
 const events=d.days.flatMap(day=>day.samples.map((s,i)=>({...s[21],timestamp:Date.parse(s[21].timestamp),rsrp:s[10],rsrq:s[11],sinr:s[12],sampleIndex:i})));
 const matches=events.map(e=>matchBaseStation(e,d.meta.baseStations));
 const adaptive=estimateAdaptive(events,d.meta.baseStations);
 const methods=Object.fromEntries(['MULTILATERATION','WEIGHTED_2_SITE','CELL_SITE','INVALID'].map(m=>[m,adaptive.positions.filter(p=>p.method===m).length]));
 console.log('  Adaptive:',JSON.stringify({stats:adaptive.stats,sites:adaptive.sites.length,methods,windows:Object.fromEntries(ADAPTIVE_CONFIG.windowsSec.map(w=>[w,adaptive.positions.filter(p=>p.windowSec===w).length])),grades:Object.fromEntries(['A','B','C','D','E'].map(g=>[g,adaptive.positions.filter(p=>p.confidenceGrade===g).length])),jumps:adaptive.positions.filter(p=>p.jump).length}));
 assert.equal(adaptive.positions.length,events.length);
 assert(adaptive.positions.every(p=>p.estimatedLat==null||Number.isFinite(p.estimatedLat)&&Number.isFinite(p.estimatedLon)));
 assert(adaptive.positions.every(p=>p.usedSites.every(s=>!adaptive.stats.excludedSites.includes(s.siteId))));
 console.log('  Master join:',matches.filter(m=>m?.mode==='cell').length,'exact,',matches.filter(m=>m?.mode==='station-fallback').length,'fallback,',matches.filter(m=>!m).length,'unmatched');
 assert(events.length>0);
 for(let i=0;i<events.length;i++)if(matches[i]?.mode==='cell'){
   assert.equal(matches[i].station.cellId,events[i].cellId);
   assert.equal(matches[i].station.baseStationId,events[i].baseStationId);
   assert(matches[i].station.frequency==null || matches[i].station.frequency===events[i].frequency);
 }
 const stream=events.filter(e=>e.streamId===events[0].streamId).slice(0,8);
 const start=performance.now(),out=estimatePosition(stream,d.meta.baseStations);
 assert(out.length>0);assert(out.every(e=>Number.isFinite(e.latitude) && Number.isFinite(e.longitude)));
 assert(out.filter(e=>e.station.isVirtual || e.station.provenanceUnknown).every(e=>e.confidence!=='HIGH'));
 console.log('  8-sample estimate ms:',Math.round(performance.now()-start));
});
console.log(tests+' test groups passed.');
