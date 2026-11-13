/* eslint-disable @typescript-eslint/no-require-imports -- Read-only local Node map context. */
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {validateCandidateTarget,resolveCandidate}=require('./qwen-candidate-evidence.cjs');

const SCHEMA='candidate-pot-context-v1';
const cache=new Map(),MAX_CACHE=8;
const OPTIONAL_ARTIFACTS=[
 'quality-improvement/candidate-mdt-rsrp-v1.json',
 'quality-improvement/mdt-grid-25m-v1.json',
 'quality-improvement/candidate-termination-v1.json',
 'quality-improvement/mdt-grid-analysis-v1.json',
 'station-catalog.json','voice-query-index.json','voice-1030.json'
];
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const number=value=>typeof value==='number'&&Number.isFinite(value);
const coordinate=(lat,lon)=>number(lat)&&number(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const fail=(message,code='CANDIDATE_EVIDENCE_MISMATCH',status=409)=>{throw Object.assign(new Error(message),{code,status});};

/** Keep registry and cache reads inside the same published root used by the resolver. */
function publicFiles(publicDir){
 let root;try{root=fs.realpathSync(publicDir);}catch{fail('후보 지도 자료 경로를 확인할 수 없습니다.','EVIDENCE_UNAVAILABLE',503);}
 const file=relative=>{
  if(typeof relative!=='string'||!/^[-A-Za-z0-9_/.]+$/.test(relative)||path.isAbsolute(relative)||relative.split('/').includes('..'))fail('후보 지도 자료 경로가 올바르지 않습니다.');
  const filename=path.resolve(root,relative);
  if(!filename.startsWith(root+path.sep))fail('후보 지도 자료 경로가 올바르지 않습니다.');
  try{
   const real=fs.realpathSync(filename);
   if(!real.startsWith(root+path.sep))fail('후보 지도 자료 경로가 올바르지 않습니다.');
   const stat=fs.statSync(real);
   if(!stat.isFile())fail('후보 지도 자료 형식을 확인할 수 없습니다.');
   return {real,stat};
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
 };
 const stamp=relative=>{
  const current=file(relative);
  return [relative,current?{real:current.real,size:current.stat.size,mtimeMs:current.stat.mtimeMs,ctimeMs:current.stat.ctimeMs}:null];
 };
 const read=(relative,optional=false)=>{
  const current=file(relative);
  if(!current){if(optional)return null;fail('현재 조건의 후보 지도 자료를 읽을 수 없습니다.','EVIDENCE_UNAVAILABLE',503);}
  if(current.stat.size>24*1024*1024)fail('후보 지도 자료가 허용 크기를 초과했습니다.','EVIDENCE_UNAVAILABLE',503);
  try{return JSON.parse(fs.readFileSync(current.real,'utf8'));}
  catch{fail('후보 지도 자료 형식이 올바르지 않습니다.');}
 };
 return {root,stamp,read};
}
function sourceBase(target){
 const {analysisMode,locationMode,modelId}=target.candidateScope;
 const mixed=locationMode==='gps-mdt-rough-unvalidated-v1',all=analysisMode==='all';
 if(modelId==='dbscan')return mixed?(all?'quality-improvement-mixed-full':'quality-improvement-mixed-evaluation'):(all?'quality-improvement-full':'quality-improvement');
 return mixed?(all?'quality-models-mixed-full':'quality-models-mixed-evaluation'):(all?'quality-models-full':'quality-models');
}
function sameScope(scope,target){
 return scope&&scope.sourceRevision===target.sourceRevision&&scope.policy===target.candidateScope.policy&&['dateStart','dateEnd','from','to'].every(key=>scope[key]===target.scope[key]);
}
/** Paths are taken from server-owned artifacts, never supplied by the client. */
function dependencies(files,target){
 const base=sourceBase(target),paths=[base+'/index.json',...OPTIONAL_ARTIFACTS];
 const index=files.read(base+'/index.json');
 const entry=index.entries?.find(item=>item.scopeKey===target.candidateScope.scopeKey&&sameScope(item.scope,target));
 if(entry){
  const relative=base+'/'+entry.path;paths.push(relative);
  const summary=files.read(relative);
  if(target.candidateScope.modelId==='dbscan'){
   const card=summary.candidates?.find(item=>item.id===target.candidateId);
   if(card?.detailPath)paths.push(base+'/'+card.detailPath);
  }
 }
 return [...new Set(paths)].sort((a,b)=>a.localeCompare(b));
}
function distanceSquared(a,b){
 const dx=(a.lon-b.lon)*111320*Math.cos(b.lat*Math.PI/180),dy=(a.lat-b.lat)*110900;
 return dx*dx+dy*dy;
}
function gridContext(resolved,center,radiusM,limitations){
 const grid=resolved.analysisGrid??resolved.grid;
 if(!grid){
  limitations.push('후보 범위의 MDT 격자 자료를 확보하지 못했습니다.');
  return {grid:{status:'unavailable',cellSizeM:25,basisPerMeter:null,measurementDates:[],metricWeightBasis:'미확인',inputSignature:''},pots:[]};
 }
 const basis=grid.basisPerMeter;
 if(grid.schemaVersion!=='mdt-25m-rsrp-grid-v1'||grid.cellSizeM!==25||!basis||
  !['latPerX','lonPerX','latPerY','lonPerY'].every(key=>number(basis[key]))||!Array.isArray(grid.records))fail('MDT 격자의 좌표 체계 또는 자료 형식을 확인할 수 없습니다.');
 const pots=[],seen=new Set(),dates=new Set();
 for(const record of grid.records){
  if(!coordinate(record.lat,record.lon)||typeof record.pot!=='string'||!record.pot||seen.has(record.pot))fail('MDT POT 위치 또는 식별자가 올바르지 않습니다.');
  seen.add(record.pot);
  if(distanceSquared(record,center)>radiusM*radiusM)continue;
  if(!number(record.x)||!number(record.y)||!number(record.rsrp)||!number(record.samples)||record.samples<0||!record.bands||typeof record.bands!=='object'||Array.isArray(record.bands))fail('MDT POT 측정값을 확인할 수 없습니다.');
  const bands={};
  for(const [key,value] of Object.entries(record.bands)){
   if(!Array.isArray(value)||value.length!==2||!value.every(number)||value[1]<0)fail('MDT 대역별 측정값을 확인할 수 없습니다.');
   bands[key]=[value[0],value[1]];
  }
  const pot={pot:record.pot,x:record.x,y:record.y,lat:record.lat,lon:record.lon,rsrp:record.rsrp,samples:record.samples,bands};
  if(date(record.displayDate)){pot.displayDate=record.displayDate;dates.add(record.displayDate);}
  if(Array.isArray(record.analysis)){
   pot.analysis=record.analysis.map(row=>{
    if(!date(row.date)||typeof row.band!=='string'||typeof row.earfcn!=='string'||!number(row.samples)||row.samples<0||!number(row.rsrpMean)||
      !row.belowPct||typeof row.belowPct!=='object'||!row.metricSamples||typeof row.metricSamples!=='object'||!Array.isArray(row.sourceFiles))fail('MDT POT 상세 집계의 날짜·대역·지표를 확인할 수 없습니다.');
    const nullable=value=>value===null||number(value);
    if(![row.rsrqMean,row.phrMean,row.rsrpMeanSumCnt].every(nullable)||
      !Object.values(row.belowPct).every(value=>nullable(value)&&(value===null||value>=0&&value<=100))||
      !Object.values(row.metricSamples).every(value=>number(value)&&value>=0)||
      !row.sourceFiles.every(value=>typeof value==='string'))fail('MDT 지표의 결측값 또는 집계 가중치를 확인할 수 없습니다.');
    dates.add(row.date);
    return {date:row.date,band:row.band,earfcn:row.earfcn,samples:row.samples,rsrpMean:row.rsrpMean,rsrqMean:row.rsrqMean,
     phrMean:row.phrMean,rsrpMeanSumCnt:row.rsrpMeanSumCnt,belowPct:{...row.belowPct},metricSamples:{...row.metricSamples},sourceFiles:[...row.sourceFiles]};
   });
  }
  pots.push(pot);
 }
 pots.sort((a,b)=>a.pot.localeCompare(b.pot));
 if(!resolved.analysisGrid)limitations.push('현재 MDT는 표시용 격자입니다. 날짜·대역별 상세 지표가 없어 원인 비교를 제한합니다.');
 if(!pots.length)limitations.push('후보 표시 반경 안에 중심점이 포함되는 MDT POT가 없습니다.');
 limitations.push('POT는 25m 격자의 대표 위치입니다. 후보 표시 반경에 중심점이 포함된 모든 POT를 제공하며 저품질 통화의 정확한 발생 위치를 뜻하지 않습니다.');
 limitations.push('MDT 측정일과 후보 통화일은 다를 수 있습니다. Top1 대역은 최다 측정 대역이며 통화 당시 서빙 Cell이나 최강 신호를 뜻하지 않습니다.');
 limitations.push('지표별 metricSamples는 원본 집계 가중치입니다. 실제 비율 분모로 확정하지 않으며 PHR의 원본 단위는 확인이 필요합니다.');
 return {grid:{status:'available',cellSizeM:25,basisPerMeter:{...basis},measurementDates:[...dates].sort((a,b)=>a.localeCompare(b)),
  metricWeightBasis:typeof grid.metricWeightBasis==='string'?grid.metricWeightBasis:'원본 집계 가중치 · 실제 지표 분모 미확인',
  inputSignature:typeof grid.inputSignature==='string'?grid.inputSignature:''},pots};
}
function stationContext(catalog,memberCalls,center,radiusM,limitations){
 const callCounts=new Map();
 for(const call of memberCalls){
  const cellId=typeof call.endCellId==='string'?call.endCellId.trim():number(call.endCellId)?String(call.endCellId):'';
  if(cellId)callCounts.set(cellId,(callCounts.get(cellId)??0)+1);
 }
 const stationSummary={sourceDate:null,uniqueCells:0,ambiguousCells:[],missingCells:[]};
 if(!catalog){
  stationSummary.missingCells=[...callCounts.keys()].sort((a,b)=>a.localeCompare(b));
  limitations.push('기지국 등록 자료를 확보하지 못했습니다. 가까운 위치를 실제 관련 기지국으로 대신 지정하지 않습니다.');
  return {stations:[],stationSummary};
 }
 if(catalog.schemaVersion!=='lte-station-catalog-v1'||!Array.isArray(catalog.rows))fail('기지국 등록 자료 형식을 확인할 수 없습니다.');
 stationSummary.sourceDate=date(catalog.source?.fileDate)?catalog.source.fileDate:null;
 const byCell=new Map(),rows=[],ids=new Set();
 for(const row of catalog.rows){
  if(!Array.isArray(row)||row.length<6||!coordinate(row[3],row[4])||typeof row[0]!=='string'||typeof row[1]!=='string')continue;
  const [ruId,cellId,pci,lat,lon,pciStatus]=row,id='station-'+digest([ruId,cellId,lat,lon]).slice(0,24);
  if(ids.has(id))continue;ids.add(id);
  const station={id,lat,lon,ruId,cellId,pci:pciStatus==='valid'&&Number.isInteger(pci)&&pci>=0&&pci<=503?pci:null};
  rows.push(station);
  if(!byCell.has(cellId))byCell.set(cellId,[]);
  byCell.get(cellId).push(station);
 }
 const stations=[],relatedIds=new Set();
 for(const [cellId,callCount] of [...callCounts].sort((a,b)=>a[0].localeCompare(b[0]))){
  const matched=byCell.get(cellId)??[];
  if(!matched.length){stationSummary.missingCells.push(cellId);continue;}
  const positions=new Set(matched.map(row=>row.lat+','+row.lon)),ambiguous=positions.size>1;
  if(ambiguous)stationSummary.ambiguousCells.push(cellId);else stationSummary.uniqueCells++;
  for(const station of matched){relatedIds.add(station.id);stations.push({...station,relation:ambiguous?'ambiguous-bye':'candidate-bye',callCount});}
 }
 const nearby=rows.filter(row=>!relatedIds.has(row.id)&&distanceSquared(row,center)<=(radiusM+200)**2)
  .sort((a,b)=>distanceSquared(a,center)-distanceSquared(b,center)||a.id.localeCompare(b.id));
 for(const station of nearby.slice(0,100))stations.push({...station,relation:'nearby-inventory',callCount:0});
 if(nearby.length>100)limitations.push('주변 등록 기지국 참고 표시는 후보 반경+200m 내 최대 100개입니다. 후보 BYE 일치 등록 위치는 이 제한으로 잘리지 않습니다.');
 if(!callCounts.size)limitations.push('현재 후보 자료에 BYE CellID가 없어 통화와 기지국의 연결을 확인하지 못했습니다. 주변 등록 위치만 참고로 표시합니다.');
 if(stationSummary.ambiguousCells.length)limitations.push('하나의 BYE CellID에 여러 위치가 등록된 경우 모든 등록 위치를 표시합니다. 가까운 위치 하나를 실제 연결 기지국으로 선택하지 않습니다.');
 limitations.push('BYE 일치는 후보 구성 통화의 종료 CellID와 등록 자료의 연결입니다. 선택 POT의 서빙 기지국 또는 불량 원인·책임 기지국을 확정하는 근거가 아닙니다.');
 limitations.push('주변 등록 기지국은 위치 참고입니다. 등록 자료에 포함된 과거 통화 관측 집계는 이번 후보의 근거로 사용하지 않습니다.');
 return {stations,stationSummary};
}

/** No Qwen configuration, prompt, inference, or source-file mutation is involved. */
function collectCandidatePotContext({publicDir,target:input,sourceRevision}){
 const target=validateCandidateTarget(input);
 if(typeof sourceRevision!=='string'||sourceRevision!==target.sourceRevision)fail('자료 버전이 변경되었습니다. 새로 고침 후 다시 확인해 주세요.','STALE_REVISION',409);
 const files=publicFiles(publicDir),key=digest({root:files.root,target,sourceRevision}),cached=cache.get(key);
 if(cached){
  const current=cached.dependencies.map(files.stamp);
  if(digest(current)===cached.stampHash){
   cache.delete(key);cache.set(key,cached);
   return structuredClone(cached.value);
  }
  cache.delete(key);
 }
 const paths=dependencies(files,target),before=paths.map(files.stamp);
 const resolved=resolveCandidate(publicDir,target),candidate=resolved.detail.candidate,center={lat:candidate.medoid?.lat,lon:candidate.medoid?.lon};
 if(!coordinate(center.lat,center.lon)||!number(candidate.displayRadiusM)||candidate.displayRadiusM<=0)fail('후보의 조사 중심과 반경을 확인할 수 없습니다.');
 const limitations=[],mdt=gridContext(resolved,center,candidate.displayRadiusM,limitations);
 const catalog=files.read('station-catalog.json',true),stations=stationContext(catalog,resolved.memberCalls,center,candidate.displayRadiusM,limitations);
 const after=paths.map(files.stamp),stampHash=digest(after);
 if(digest(before)!==stampHash)fail('후보 자료가 갱신 중입니다. 잠시 후 다시 확인해 주세요.');
 const rank=resolved.summary.candidates.findIndex(row=>row.id===candidate.id)+1;
 const title=typeof resolved.card.title==='string'&&resolved.card.title?resolved.card.title:'후보 지역 '+rank;
 const value={schemaVersion:SCHEMA,target,generatedAt:new Date().toISOString(),
  fingerprint:digest({schemaVersion:SCHEMA,target,artifactHash:resolved.artifactHash,files:after,registry:catalog?digest(catalog):null}),
  candidate:{id:candidate.id,title,center,radiusM:candidate.displayRadiusM},...mdt,...stations,limitations};
 cache.set(key,{dependencies:paths,stampHash,value});
 while(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);
 return structuredClone(value);
}
module.exports={collectCandidatePotContext};
