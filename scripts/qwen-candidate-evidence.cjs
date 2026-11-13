/* eslint-disable @typescript-eslint/no-require-imports -- Local Node analysis worker. */
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createExportDetailReader}=require('./voice-query-export-details.cjs');
const {SOP_VERSION,selectCandidateSop}=require('./qwen-candidate-sop.cjs');
const {buildCandidateFindings}=require('./qwen-candidate-findings.cjs');
const {comparisonExample}=require('./candidate-coverage-comparison.cjs');
const {buildCoveragePoints}=require('../lib/analyst/candidate-coverage-points.mjs');
const {boundCandidateModelInput}=require('./qwen-candidate-model-scope.cjs');
const {buildCandidateComparisonContext}=require('./qwen-candidate-comparison-context.cjs');
const {buildCauseAssessments,buildSourceHypothesisCandidates,buildSourceInvestigationCandidates}=require('./qwen-candidate-cause-assessment.cjs');
const EVIDENCE_VERSION='candidate-evidence-v7';
const PROMPT_VERSION='candidate-prompt-v11';
const versions=Object.freeze({evidence:EVIDENCE_VERSION,prompt:PROMPT_VERSION,sop:SOP_VERSION});
const MIXED='gps-mdt-rough-unvalidated-v1';
const STRICT='strict-3-site-v1';
const SAMPLE_LIMIT=32;
const MODEL_NAMES={dbscan:'DBSCAN',hdbscan:'HDBSCAN',st_dbscan:'ST-DBSCAN',adaptive_kde:'Adaptive KDE',spatial_scan:'Spatial Scan',bayesian:'Bayesian (Empirical Bayes)'};
const RTP_FIELDS=['txPacketLoss','rxPacketLoss','txJitter','rxJitter','txLossCount','rxLossCount'];
const PARAMETERS=Object.freeze({epsM:100,minSamples:2,minPoorCustomers:3,minPoorDates:2,minNewCustomers:2,maxDiameterMultiplier:2,locationPolicy:STRICT});
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const round=value=>numeric(value)===null?null:Math.round(value*1e6)/1e6;
const mean=values=>{const valid=values.filter(v=>numeric(v)!==null);return valid.length?round(valid.reduce((a,b)=>a+b,0)/valid.length):null;};
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fail(message,code='INVALID_CANDIDATE_TARGET',status=400){const error=new Error(message);error.code=code;error.status=status;throw error;}
function exact(value,keys){return object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function validDate(value){const time=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?Date.parse(value+'T00:00:00Z'):NaN;return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;}
function seconds(value){if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return null;const [h,m]=value.split(':').map(Number);return h*3600+m*60;}
const safeId=(value,max=160)=>typeof value==='string'&&value.length>0&&value.length<=max&&/^[-A-Za-z0-9_]+$/.test(value);
function validateCandidateTarget(input){
 if(!exact(input,['kind','candidateId','sourceRevision','scope','candidateScope'])||input.kind!=='candidate'||!safeId(input.candidateId))fail('분석할 후보 지역을 선택해 주세요.');
 if(!safeId(input.sourceRevision,100))fail('후보 분석 자료 버전이 올바르지 않습니다.');
 const s=input.scope,c=input.candidateScope;
 if(!exact(s,['dateStart','dateEnd','from','to'])||!validDate(s.dateStart)||!validDate(s.dateEnd)||s.dateStart>s.dateEnd||Date.parse(s.dateEnd)-Date.parse(s.dateStart)>365*86400000)fail('후보 분석 날짜 범위가 올바르지 않습니다.');
 if(seconds(s.from)===null||seconds(s.to)===null||seconds(s.from)>seconds(s.to))fail('후보 분석 시간 범위가 올바르지 않습니다.');
 if(!exact(c,['scopeKey','policy','analysisMode','locationMode','modelId'])||!safeId(c.scopeKey)||c.policy!==STRICT||!['all','evaluation'].includes(c.analysisMode)||![MIXED,STRICT].includes(c.locationMode)||!Object.hasOwn(MODEL_NAMES,c.modelId))fail('후보의 군집·발견/평가·위치 조건이 올바르지 않습니다.');
 return {kind:'candidate',candidateId:input.candidateId,sourceRevision:input.sourceRevision,scope:{dateStart:s.dateStart,dateEnd:s.dateEnd,from:s.from,to:s.to},candidateScope:{scopeKey:c.scopeKey,policy:c.policy,analysisMode:c.analysisMode,locationMode:c.locationMode,modelId:c.modelId}};
}
function publishedReader(publicDir){
 let root;try{root=fs.realpathSync(publicDir);}catch{fail('후보 자료 경로를 확인할 수 없습니다.','EVIDENCE_UNAVAILABLE',503);}
 const digests=[];
 const read=(relative,optional=false)=>{
  if(typeof relative!=='string'||!/^[-A-Za-z0-9_/.]+$/.test(relative)||path.isAbsolute(relative)||relative.split('/').includes('..'))fail('후보 자료 경로가 올바르지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
  const candidate=path.resolve(root,relative);
  if(!candidate.startsWith(root+path.sep))fail('후보 자료 경로가 올바르지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
  let real,raw;
  try{real=fs.realpathSync(candidate);if(!real.startsWith(root+path.sep))fail('후보 자료 경로가 올바르지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);if(fs.statSync(real).size>(relative==='quality-improvement/mdt-grid-analysis-v1.json'?64:24)*1024*1024)fail('후보 자료가 허용 크기를 초과했습니다.','EVIDENCE_UNAVAILABLE',503);raw=fs.readFileSync(real,'utf8');}
  catch(error){if(error.code?.startsWith('CANDIDATE_')||error.code==='EVIDENCE_UNAVAILABLE')throw error;if(optional&&error.code==='ENOENT'){digests.push([relative,'missing']);return null;}fail('현재 조건의 후보 자료를 읽을 수 없습니다.','EVIDENCE_UNAVAILABLE',503);}
  digests.push([relative,hash(raw)]);
  try{return JSON.parse(raw);}catch{if(optional)return null;fail('후보 자료 형식이 올바르지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);}
 };
 return {read,digests};
}
function sameScope(scope,target){return object(scope)&&scope.sourceRevision===target.sourceRevision&&scope.policy===target.candidateScope.policy&&['dateStart','dateEnd','from','to'].every(key=>scope[key]===target.scope[key]);}
function resolveAlternativeCandidate(read,digests,target){
 const mixed=target.candidateScope.locationMode===MIXED,all=target.candidateScope.analysisMode==='all',id=target.candidateScope.modelId;
 const base=mixed?(all?'quality-models-mixed-full':'quality-models-mixed-evaluation'):(all?'quality-models-full':'quality-models');
 const index=read(base+'/index.json');
 if(index.schemaVersion!=='quality-model-index-v1'||index.sourceRevision!==target.sourceRevision)fail('대안 모델의 원본 자료 버전이 변경되었습니다.','STALE_REVISION',409);
 if((index.analysisMode??'evaluation')!==target.candidateScope.analysisMode||(index.locationMode===MIXED)!==mixed)fail('대안 모델의 발견·평가 또는 위치 정책이 현재 조건과 다릅니다.','CANDIDATE_SCOPE_MISMATCH',409);
 const entry=index.entries?.find(e=>sameScope(e.scope,target)&&e.scopeKey===target.candidateScope.scopeKey);
 if(!entry)fail('현재 조건의 대안 모델 자료가 없습니다.','CANDIDATE_SCOPE_MISMATCH',409);
 const report=read(base+'/'+entry.path),model=report.models?.[id];
 if(report.schemaVersion!=='quality-alternative-models-v1'||report.sourceRevision!==target.sourceRevision||!sameScope(report.scope,target)||report.scopeKey!==entry.scopeKey||(report.analysisMode??'evaluation')!==target.candidateScope.analysisMode||(report.locationMode===MIXED)!==mixed||!Array.isArray(report.discoveryDates)||!Array.isArray(report.validationDates)||!model||!object(model.parameters)||!Array.isArray(model.candidates))fail('대안 모델의 조건이나 원본 버전이 일치하지 않습니다.','CANDIDATE_SCOPE_MISMATCH',409);
 if(report.discoveryDates.some(d=>!validDate(d)||d<target.scope.dateStart||d>target.scope.dateEnd)||report.validationDates.some(d=>!validDate(d)||d<target.scope.dateStart||d>target.scope.dateEnd||report.discoveryDates.includes(d))||new Set(model.candidates.map(c=>c.id)).size!==model.candidates.length)fail('대안 모델의 발견·평가 구분이 올바르지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
 const original=model.candidates.find(c=>c.id===target.candidateId);
 if(!original)fail('선택 후보가 현재 대안 모델에 없습니다.','CANDIDATE_NOT_FOUND',404);
 if(!Array.isArray(original.members)||!original.members.length||original.members.length>20000||!Array.isArray(original.validationPoints)||new Set(original.members.map(p=>p.callId)).size!==original.members.length||original.members.length!==original.poorCalls||new Set(original.members.map(p=>p.customerId)).size!==original.poorCustomers||new Set(original.members.map(p=>p.date)).size!==original.days||numeric(original.lat)===null||numeric(original.lon)===null||numeric(original.radiusM)===null||original.radiusM<=0||numeric(original.maxPairDistanceM)===null||original.maxPairDistanceM<0)fail('대안 모델의 구성 통화 집계가 올바르지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
 const points=new Map();
 for(const [list,dates] of [[original.members,report.discoveryDates],[original.validationPoints,report.validationDates]])for(const point of list){
  if(typeof point.callId!=='string'||typeof point.customerId!=='string'||!dates.includes(point.date)||numeric(point.mos)===null||point.mos>=3||!['gnss','rough','reviewed-radio'].includes(point.kind)||numeric(point.lat)===null||numeric(point.lon)===null||Math.abs(point.lat)>90||Math.abs(point.lon)>180)fail('대안 모델 구성 통화의 날짜·품질·위치를 확인할 수 없습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
 }
 const memberCalls=original.members.map(p=>({callId:p.callId,customerId:p.customerId,date:p.date,sourceRevision:target.sourceRevision}));
 for(const point of original.members)points.set(point.callId,{...point,role:'discovery-member'});
 const candidate={id:original.id,memberCallIds:original.members.map(p=>p.callId),poorCallCount:original.poorCalls,poorCustomerCount:original.poorCustomers,poorDateCount:original.days,displayRadiusM:original.radiusM,maxPairDistanceM:original.maxPairDistanceM,rangeReviewRequired:original.rangeReviewRequired,medoid:{lat:original.lat,lon:original.lon},nearbyPoints:[...points.values(),...original.validationPoints]};
 const card={id:original.id,poorCallCount:original.poorCalls,poorCustomerCount:original.poorCustomers,poorDateCount:original.days,displayRadiusM:original.radiusM,rangeReviewRequired:original.rangeReviewRequired,gnssCallCount:original.gnssCalls,roughCallCount:original.roughCalls};
 const summary={scope:report.scope,scopeKey:report.scopeKey,discoveryDates:report.discoveryDates,validationDates:report.validationDates,candidates:model.candidates};
 // Only the documented current model parameters reach Qwen. Coordinates,
 // member IDs or future free-form metadata cannot ride inside parameters.
 const keys={hdbscan:['minClusterSize','minSamples','distance','locationInputs'],st_dbscan:['epsSpaceM','epsTimeHours','minSamples','locationInputs'],adaptive_kde:['kernel','gnssBandwidthM','radioBandwidthM','candidateSupportM','roughBandwidthAssumedM','locationInputs'],spatial_scan:['radiiM','permutations','population','locationInputs','normalLocationPolicy'],bayesian:['method','bandwidthM','priorStrength','dayDecay','population','locationInputs','normalLocationPolicy']}[id];
 const parameters=Object.fromEntries(keys.filter(key=>Object.hasOwn(model.parameters,key)).map(key=>[key,model.parameters[key]]));
 if(!Object.keys(parameters).length||Object.values(parameters).some(v=>!(numeric(v)!==null||typeof v==='boolean'||typeof v==='string'&&v.length<=200||Array.isArray(v)&&v.length<=20&&v.every(n=>numeric(n)!==null))))fail('대안 모델의 파라미터를 확인할 수 없습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
 const mdt=read('quality-improvement/candidate-mdt-rsrp-v1.json',true),grid=read('quality-improvement/mdt-grid-25m-v1.json',true),termination=read('quality-improvement/candidate-termination-v1.json',true),analysisGrid=read('quality-improvement/mdt-grid-analysis-v1.json',true);
 validateGridPair(grid,analysisGrid);
 return {summary,card,detail:{candidate},points,memberCalls,mdt,grid,termination,analysisGrid,parameters,artifactHash:hash(digests)};
}
function resolveCandidate(publicDir,target){
 const {read,digests}=publishedReader(publicDir);
 if(target.candidateScope.modelId!=='dbscan')return resolveAlternativeCandidate(read,digests,target);
 const mixed=target.candidateScope.locationMode===MIXED,all=target.candidateScope.analysisMode==='all';
 const base=mixed?(all?'quality-improvement-mixed-full':'quality-improvement-mixed-evaluation'):(all?'quality-improvement-full':'quality-improvement');
 const index=read(base+'/index.json');
 if(index.schemaVersion!=='quality-improvement-index-v1'||index.sourceRevision!==target.sourceRevision)fail('후보 자료의 원본 버전이 변경되었습니다. 새로 고침 후 다시 분석해 주세요.','STALE_REVISION',409);
 if((index.analysisMode??'evaluation')!==target.candidateScope.analysisMode||(index.locationMode===MIXED)!==mixed)fail('후보 자료의 발견·평가 또는 위치 정책이 현재 조건과 다릅니다.','CANDIDATE_SCOPE_MISMATCH',409);
 const entry=index.entries?.find(e=>sameScope(e.scope,target)&&e.scopeKey===target.candidateScope.scopeKey);
 if(!entry)fail('현재 기간·시간·군집 조건의 후보 자료가 없습니다.','CANDIDATE_SCOPE_MISMATCH',409);
 const summary=read(base+'/'+entry.path);
 if(summary.schemaVersion!=='quality-candidate-summary-v1'||summary.scopeKey!==entry.scopeKey||!sameScope(summary.scope,target)||(summary.locationMode===MIXED)!==mixed||!Array.isArray(summary.candidates)||!Array.isArray(summary.discoveryDates)||!Array.isArray(summary.validationDates))fail('후보 요약의 조건을 확인할 수 없습니다.','CANDIDATE_SCOPE_MISMATCH',409);
 if(new Set(summary.candidates.map(c=>c.id)).size!==summary.candidates.length||summary.discoveryDates.some(d=>!validDate(d)||d<target.scope.dateStart||d>target.scope.dateEnd)||summary.validationDates.some(d=>!validDate(d)||d<target.scope.dateStart||d>target.scope.dateEnd||summary.discoveryDates.includes(d)))fail('후보 자료의 발견·평가 구분이 올바르지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
 const card=summary.candidates.find(c=>c.id===target.candidateId);
 if(!card)fail('선택 후보가 현재 조건의 후보 목록에 없습니다.','CANDIDATE_NOT_FOUND',404);
 const detail=read(base+'/'+card.detailPath),c=detail.candidate;
 if(detail.schemaVersion!=='quality-candidate-detail-v1'||detail.scopeKey!==summary.scopeKey||!sameScope(detail.scope,target)||(detail.locationMode===MIXED)!==mixed||c?.id!==card.id||!Array.isArray(c.memberCallIds)||!c.memberCallIds.length||c.memberCallIds.length>20000||new Set(c.memberCallIds).size!==c.memberCallIds.length||!Array.isArray(c.nearbyPoints)||!Array.isArray(detail.calls))fail('후보 구성 통화와 원본 근거가 일치하지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
 const calls=new Map(detail.calls.map(call=>[call.callId,call])),points=new Map();
 if(calls.size!==detail.calls.length)fail('후보 원본 통화가 중복되어 있습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
 for(const point of c.nearbyPoints){
  const source=calls.get(point.callId),dates=String(point.role).startsWith('validation')?summary.validationDates:summary.discoveryDates;
  if(!source||source.sourceRevision!==target.sourceRevision||!dates.includes(point.date)||source.date!==point.date||source.customerId!==point.customerId||!['gnss','rough','reviewed-radio'].includes(point.kind)||numeric(point.lat)===null||numeric(point.lon)===null||Math.abs(point.lat)>90||Math.abs(point.lon)>180)fail('후보의 날짜·고객·위치 연결을 확인할 수 없습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
  if(point.role==='discovery-member'){if(points.has(point.callId))fail('후보 위치 근거가 중복되어 있습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);points.set(point.callId,point);}
 }
 const memberCalls=c.memberCallIds.map(id=>calls.get(id));
 if(memberCalls.some((call,i)=>!call||!summary.discoveryDates.includes(call.date)||!points.has(c.memberCallIds[i])))fail('후보 구성 통화의 위치 또는 발견일이 누락되었습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
 const customers=new Set(memberCalls.map(call=>call.customerId)),days=new Set(memberCalls.map(call=>call.date));
 if(card.poorCallCount!==memberCalls.length||c.poorCallCount!==memberCalls.length||card.poorCustomerCount!==customers.size||c.poorCustomerCount!==customers.size||card.poorDateCount!==days.size||c.poorDateCount!==days.size||card.displayRadiusM!==c.displayRadiusM||card.rangeReviewRequired!==c.rangeReviewRequired||numeric(c.displayRadiusM)===null||c.displayRadiusM<=0||numeric(c.maxPairDistanceM)===null||c.maxPairDistanceM<0||numeric(c.medoid?.lat)===null||numeric(c.medoid?.lon)===null)fail('후보 요약과 구성 통화 집계가 일치하지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
 const mdt=read('quality-improvement/candidate-mdt-rsrp-v1.json',true),grid=read('quality-improvement/mdt-grid-25m-v1.json',true),termination=read('quality-improvement/candidate-termination-v1.json',true),analysisGrid=read('quality-improvement/mdt-grid-analysis-v1.json',true);
 validateGridPair(grid,analysisGrid);
 return {summary,card,detail,points,memberCalls,mdt,grid,termination,analysisGrid,parameters:{...PARAMETERS},artifactHash:hash(digests)};
}
/** Reject mixed publication generations, not just changed filenames. */
function validateGridPair(display,analysis){
 if(!analysis)return; // A genuine legacy display remains analysis-unavailable.
 if(!display)fail('지도 표시 자료 없이 분석 자료만 남아 있습니다. 두 자료를 함께 갱신해 주세요.','CANDIDATE_EVIDENCE_MISMATCH',409);
 const keys=['inputSignature','schemaVersion','sourceDate','sourceDates','sources','cellSizeM','referenceOnly','gridCells','sourceRows','measurements','basisPerMeter'];
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
 const fingerprint=grid=>hash(canonical({metadata:Object.fromEntries(keys.map(k=>[k,grid[k]])),records:(grid.records??[]).map(c=>Object.fromEntries(['pot','x','y','lat','lon','rsrp','samples','bands','displayDate'].map(k=>[k,c[k]]))).sort((a,b)=>String(a.pot).localeCompare(String(b.pot)))}));
 if(analysis.analysisSchemaVersion!=='mdt-grid-analysis-v1'||fingerprint(display)!==fingerprint(analysis))fail('지도 표시와 MDT 분석 자료의 생성 버전이 다릅니다. 두 자료를 함께 갱신한 후 다시 분석해 주세요.','CANDIDATE_EVIDENCE_MISMATCH',409);
}
function candidateRequestKey(input,publicDir){
 const target=validateCandidateTarget(input);
 return hash({target,versions,...(publicDir?{artifact:resolveCandidate(publicDir,target).artifactHash}:{})});
}
function timeText(value){if(numeric(value)===null)return '';const whole=Math.floor(value);return [Math.floor(whole/3600)%24,Math.floor(whole/60)%60,whole%60].map(n=>String(n).padStart(2,'0')).join(':');}
function count(rows){return {totalCalls:rows.length,evaluatedCalls:rows.filter(r=>numeric(r.qoe)!==null).length,poorCalls:rows.filter(r=>numeric(r.qoe)!==null&&r.qoe<3).length,dropCalls:rows.filter(r=>r.is_drop===1).length};}
const group=(rows,key)=>{const groups=new Map();for(const row of rows){const k=key(row),list=groups.get(k)??[];list.push(row);groups.set(k,list);}return groups;};
function gridEvidence(grid,candidate){
 if(grid?.schemaVersion!=='mdt-25m-rsrp-grid-v1'||grid.referenceOnly!==true||grid.cellSizeM!==25||!validDate(grid.sourceDate)||!Array.isArray(grid.records))return {status:'unavailable',measurementDates:[],frequency:'미확보',description:'별도 측정일의 배경 MDT 격자 자료를 확인할 수 없습니다. 통화 당시 무선 상태로 대체하지 않습니다.'};
 const frequencies=new Set();let regionCells=0,measurementRows=0;
 for(const cell of grid.records){
  const dx=(cell.lon-candidate.medoid.lon)*111320*Math.cos(candidate.medoid.lat*Math.PI/180),dy=(cell.lat-candidate.medoid.lat)*110900;
  if(!Number.isFinite(dx)||!Number.isFinite(dy)||dx*dx+dy*dy>candidate.displayRadiusM**2)continue;
  regionCells++;for(const [band,values] of Object.entries(cell.bands??{}))if(Array.isArray(values)&&numeric(values[0])!==null&&Number.isSafeInteger(values[1])&&values[1]>0){frequencies.add(band);measurementRows+=values[1];}
 }
 return {status:'available',measurementDates:[grid.sourceDate],frequency:[...frequencies].sort((a,b)=>a.localeCompare(b)).join(' · ')||'해당 표시 원 내 대역 미확보',cellSizeM:25,referenceOnly:true,regionGridCells:regionCells,measurementRows,
  description:'별도 측정일의 배경 참고 격자입니다. 통화 당시 무선 상태·서빙 Cell 또는 저하 순간 위치의 근거가 아닙니다. 분석은 제공 대역 전체의 자료 존재만 확인하며 지도 표시 모드와 독립적입니다.',top1Meaning:'Top1은 측정 건수가 가장 많은 대역이며 최강 신호나 통화 당시 서빙 Cell을 뜻하지 않습니다.'};
}
function mdtCoverage(sidecar,sourceRevision,memberCalls){
 if(sidecar?.schemaVersion!=='qoe-candidate-mdt-rsrp-v1'||sidecar.sourceRevision!==sourceRevision||!object(sidecar.records))return {status:'unavailable',matchedCalls:null,measurementRows:null,validRows:null,excludedRows:null,description:'후보 통화에 연결된 MDT 측정행 집계를 확인할 수 없습니다. 배경 격자로 대신하지 않습니다.'};
 let matchedCalls=0,measurementRows=0,validRows=0,excludedRows=0;
 for(const call of memberCalls){const item=sidecar.records[call.callId];if(!item)continue;
  if(!['totalRows','validRows','excludedRows'].every(key=>Number.isSafeInteger(item[key])&&item[key]>=0)||item.validRows+item.excludedRows!==item.totalRows)continue;
  matchedCalls++;measurementRows+=item.totalRows;validRows+=item.validRows;excludedRows+=item.excludedRows;
 }
 return {status:'available',matchedCalls,measurementRows,validRows,excludedRows,description:'후보 구성 통화에 연결된 원본 MDT 측정행 수입니다. 측정행은 독립 통화·고객 수가 아닙니다. 분석의 무선 대표 평균은 통화별 평균을 동일 가중하여 측정행이 많은 통화의 지배를 피합니다.'};
}
function endCellComparison(db,members,reader){
 const memberIds=new Set(members.map(row=>row.id)),windows=new Map();
 for(const row of members){
  if(!row.cell)continue;
  const hourStart=Math.floor(row.start_second/3600)*3600,key=row.date+'|'+hourStart;
  const slot=windows.get(key)??{date:row.date,hourStart,cells:new Set()};
  slot.cells.add(row.cell);windows.set(key,slot);
 }
 const result={strata:0,totalCalls:0,evaluatedCalls:0,poorCalls:0,normalRadioCalls:reader?0:null};
 const query=db.prepare("SELECT c.id,c.qoe,c.customer_id,c.raw_id,EXISTS(SELECT 1 FROM days d WHERE d.customer_id=c.customer_id AND d.date=c.date AND json_extract(d.json,'$.sampleCount')>0) has_samples FROM calls c WHERE c.date=? AND c.start_second>=? AND c.start_second<? AND c.cell IN (SELECT value FROM json_each(?))");
 for(const {date,hourStart,cells} of windows.values()){
  result.strata+=cells.size;
  for(const row of query.iterate(date,hourStart,hourStart+3600,JSON.stringify([...cells]))){
   if(memberIds.has(row.id))continue;
   result.totalCalls++;
   if(!Number.isFinite(row.qoe))continue;
   result.evaluatedCalls++;
   if(row.qoe<3){result.poorCalls++;continue;}
   if(row.has_samples&&result.normalRadioCalls!==null)try{
    const original=reader(row.customer_id,date,row.raw_id);
    if(original?.radioSeries?.some(sample=>Number.isFinite(sample.rsrp)||Number.isFinite(sample.rsrq)||Number.isFinite(sample.sinr)||Number.isFinite(sample.phr)))result.normalRadioCalls++;
   }catch{result.normalRadioCalls=null;}
  }
 }
 return result;
}
function collectCandidateEvidence({dbPath,publicDir,target:input,sourceRevision}){
 const target=validateCandidateTarget(input);
 if(sourceRevision!==target.sourceRevision)fail('원본 자료 버전이 변경되었습니다. 새로 고침 후 다시 분석해 주세요.','STALE_REVISION',409);
 const resolved=resolveCandidate(publicDir,target),{summary:published,card,detail,points,memberCalls}=resolved;
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-8192;');
  let meta;try{meta=JSON.parse(db.prepare("SELECT json FROM meta WHERE key='dataset'").get()?.json??'null');}catch{fail('음성 분석 자료의 메타정보를 읽을 수 없습니다.','EVIDENCE_UNAVAILABLE',503);}
  if(meta?.revision!==sourceRevision)fail('원본 자료 버전이 변경되었습니다.','STALE_REVISION',409);
  if(meta.qoeBasis!=='rtcp-mos-v5')fail('현재 음성 품질 기준의 자료가 필요합니다.','EVIDENCE_UNAVAILABLE',503);
  const lookup=db.prepare('SELECT id,raw_id,customer_id,date,start_second,end_second,qoe,mos,is_drop,cell,area FROM calls WHERE id=?');
  const rows=memberCalls.map(call=>{
   const id=call.callId.startsWith(call.date+':')?call.callId.slice(11):call.callId,row=lookup.get(id);
   if(!row||row.date!==call.date||row.customer_id!==call.customerId||row.start_second<seconds(target.scope.from)||row.start_second>=seconds(target.scope.to)+60||numeric(row.qoe)===null||row.qoe>=3||(call.rawCallId&&row.raw_id!==call.rawCallId))fail('후보 구성 통화가 현재 원본의 고객·날짜·시간·저품질 조건과 다릅니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
   return {...row,memberId:call.callId,point:points.get(call.callId)};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.start_second-b.start_second||a.id.localeCompare(b.id));
  if(new Set(rows.map(r=>r.id)).size!==rows.length)fail('후보 구성 원본 통화가 중복되었습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
  const memberSetHash=hash(rows.map(row=>[row.id,row.date,row.customer_id]).sort((a,b)=>a[0].localeCompare(b[0])));
  const candidate={id:card.id,title:'후보 지역 '+(published.candidates.findIndex(c=>c.id===card.id)+1),algorithm:MODEL_NAMES[target.candidateScope.modelId],parameters:resolved.parameters,scopeKey:published.scopeKey,locationMode:target.candidateScope.locationMode,rangeReviewRequired:card.rangeReviewRequired,radiusM:card.displayRadiusM,maxPairDistanceM:round(detail.candidate.maxPairDistanceM),discoveryDates:published.discoveryDates,validationDates:published.validationDates,memberSetHash};
  const counts=count(rows),rawMos=rows.filter(row=>numeric(row.mos)!==null&&row.mos>=1&&row.mos<=5);
  const summary={customers:new Set(rows.map(row=>row.customer_id)).size,...counts,rawMosEvaluatedCalls:rawMos.length,rawMosPoorCalls:rawMos.filter(row=>row.mos<3).length,meanQoe:mean(rows.map(row=>row.qoe)),meanMos:mean(rawMos.map(row=>row.mos)),observedDays:new Set(rows.map(row=>row.date)).size,regionalPoorRate:null};
  const byDay=[...group(rows,row=>row.date)].map(([date,list])=>({date,customers:new Set(list.map(row=>row.customer_id)).size,...count(list)}));
  const cells=[...group(rows,row=>row.cell||'미확인')].map(([cell,list])=>({cell,customers:new Set(list.map(row=>row.customer_id)).size,...count(list)})).sort((a,b)=>b.poorCalls-a.poorCalls||a.cell.localeCompare(b.cell));
  const byCell=cells.slice(0,12);
  if(cells.length>12){const rest=cells.slice(12);byCell.push({cell:'기타 Cell 합계',customers:null,totalCalls:rest.reduce((n,r)=>n+r.totalCalls,0),evaluatedCalls:rest.reduce((n,r)=>n+r.evaluatedCalls,0),poorCalls:rest.reduce((n,r)=>n+r.poorCalls,0),dropCalls:rest.reduce((n,r)=>n+r.dropCalls,0)});}
  const byHour=Array.from({length:24},(_,hour)=>({hour,...count(rows.filter(row=>Math.floor(row.start_second/3600)===hour))}));
  const selected=new Map();
  // Balanced dates and representative Cell groups precede the most severe rows.
  for(const row of rows.filter(row=>row.is_drop===1).slice(0,8))selected.set(row.id,row);
  for(const [,list] of group(rows,row=>row.date))if(selected.size<SAMPLE_LIMIT)selected.set(list[0].id,list[0]);
  for(const cell of cells.slice(0,12)){const row=rows.find(row=>(row.cell||'미확인')===cell.cell);if(selected.size<SAMPLE_LIMIT)selected.set(row.id,row);}
  for(const row of [...rows].sort((a,b)=>a.qoe-b.qoe||a.id.localeCompare(b.id))){if(selected.size>=SAMPLE_LIMIT)break;selected.set(row.id,row);}
  let detailFailures=0,reader;
  try{reader=createExportDetailReader({publicDir,exactWindow:true,sourceRevision,entryFor:(id,date)=>{const found=db.prepare('SELECT json FROM days WHERE customer_id=? AND date=?').get(id,date);return found?JSON.parse(found.json):null;}});}catch{detailFailures++;}
  const metrics=[];
  const href=row=>'/?'+new URLSearchParams({source:'MDT',view:'contract',date:row.date,customer:row.customer_id,call:row.raw_id??row.id}).toString();
  const calls=[...selected.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.start_second-b.start_second||a.id.localeCompare(b.id)).map(row=>{
   let original;if(reader)try{original=reader(row.customer_id,row.date,row.raw_id);}catch{detailFailures++;}
   const rtp=Object.fromEntries(RTP_FIELDS.map(field=>[field,numeric(original?.rtp?.[field])])),rsrp=numeric(original?.rsrp),sinr=numeric(original?.sinr);
   metrics.push({rsrp,sinr,rtp});
   return {id:row.id,rsrq:numeric(original?.rsrq),radioSeries:original?.radioSeries??[],rtp,date:row.date,start:timeText(row.start_second),end:timeText(row.end_second),qoe:row.qoe,mos:row.mos,isDrop:row.is_drop===1,cell:row.cell??'',area:row.area??'',locationEvidence:row.point.kind,href:href(row),rsrp,sinr};
  });
  const aliases=new Map([...new Set(rows.map(r=>r.customer_id))].sort((a,b)=>a.localeCompare(b)).map((id,index)=>[id,'고객 '+String(index+1).padStart(3,'0')]));
  const members=rows.map(row=>({id:row.id,customerLabel:aliases.get(row.customer_id),date:row.date,start:timeText(row.start_second),qoe:row.qoe,mos:row.mos,isDrop:row.is_drop===1,cell:row.cell??'',locationEvidence:row.point.kind,href:href(row)}));
  const radioCalls=metrics.filter(row=>row.rsrp!==null||row.sinr!==null).length,rtpCalls=metrics.filter(row=>Object.values(row.rtp).some(value=>value!==null)).length;
  const detailsPolicy='전체 집계는 서버에서 확인한 후보 구성 통화 전체입니다. 원본 상세는 Drop 최대 8건을 우선하고 날짜·대표 Cell을 분산한 뒤 낮은 QoE 통화를 채워 최대 32건을 사용합니다. 무작위 표본이 아니며 무선·RTP 평균은 이 상세 표본에서 통화별 동일 가중으로 계산합니다.';
  const coverage={sampledCalls:calls.length,radioCalls,rtpCalls,locationCalls:rows.length,fullPopulation:true,population:'candidate-members',detailsPolicy,detailFailures,totalCellGroups:cells.length,
   matchedMdt:mdtCoverage(resolved.mdt,sourceRevision,memberCalls),timingStatus:'not-verified'};
  const radio={sampledCalls:calls.length,rsrpCalls:metrics.filter(row=>row.rsrp!==null).length,sinrCalls:metrics.filter(row=>row.sinr!==null).length,meanRsrp:mean(metrics.map(row=>row.rsrp)),meanSinr:mean(metrics.map(row=>row.sinr)),weighting:'통화별 동일 가중',timingStatus:'저하 순간 정밀 시간 정합 미검증'};
  const rtp=RTP_FIELDS.map(field=>({field,measuredCalls:metrics.filter(row=>row.rtp[field]!==null).length,mean:mean(metrics.map(row=>row.rtp[field])),unit:'원본 단위 미확인'}));
  const comparison={status:'unavailable',calls:null,conditions:'동일 발견 기간·매일 시간 범위·조사 구간·위치 확보 정책을 맞춘 정상 통화 집단이 이 후보 산출물에 제공되지 않았습니다.',limitations:['후보 구성 통화는 저품질 조건으로 선정한 집단이며 지역 전체 통화가 아닙니다.','같은 고객의 기간 전체 통화를 후보 지역의 정상 분모로 사용하지 않습니다.','미평가·위치 미확보·시간 정합 부족 통화는 비교 집단의 결측이며 정상 0건으로 바꾸지 않습니다.']};
  const gpsCalls=rows.filter(row=>row.point.kind==='gnss').length,roughCalls=rows.filter(row=>row.point.kind==='rough').length,reviewedRadioCalls=rows.filter(row=>row.point.kind==='reviewed-radio').length;
  if((card.gnssCallCount!=null&&card.gnssCallCount!==gpsCalls)||(card.roughCallCount!=null&&card.roughCallCount!==roughCalls))fail('후보 위치 종류의 집계가 일치하지 않습니다.','CANDIDATE_EVIDENCE_MISMATCH',409);
  const location={gpsCalls,roughCalls,reviewedRadioCalls,missingCalls:0,unvalidated:roughCalls>0,policy:target.candidateScope.locationMode,description:'표시 원의 반경과 구성점 간 최대 거리는 별개입니다. GPS·BYE 대표 위치·MDT 근사는 실제 품질 저하 순간의 위치나 정확도 보장이 아닙니다.'};
  const mdtGrid=gridEvidence(resolved.grid,detail.candidate);
  const limitations=[
   '후보 구성 통화는 저품질로 선정한 집단입니다. 정상 지역 분모가 없어 지역 불량률은 미산정이며 구성 통화의 비율을 지역 전체 불량률로 제시하지 않습니다.',
   '원인 가설은 확인할 대상이며 확정 원인이나 조치 승인 결과가 아닙니다. 장비 조정값·임계값·명령어를 생성하거나 실행하지 않습니다.',
   '표시 반경·구성점 간 최대 거리·위치 추정 불확실성·실제 저하 순간 위치는 서로 다른 개념입니다. 넓은 원 전체를 하나의 원인 또는 하나의 기지국 문제로 확정하지 않습니다.',
   '무선·RTP는 대표 상세 표본입니다. 원시 지표의 정밀 시간 정합과 RTP 단위·방향·구간 정의를 별도로 확인해야 합니다.',
   'Drop이 없거나 일부만 관측되었다는 사실은 전체 SIP 성공이나 다른 장애의 부재를 증명하지 않습니다.',
   detailsPolicy,
   published.validationDates.length?'발견 자료와 별도 평가 자료의 날짜를 구분했습니다. 별도 관측도 원인 또는 개선 효과를 확정하는 실험은 아닙니다.':'별도 검증일이 없습니다. 같은 발견 자료로 원인 가설이나 개선 효과가 검증되었다고 판단할 수 없습니다.'
  ];
  if(detailFailures)limitations.push('일부 원본 상세를 읽지 못해 해당 무선·RTP 지표는 미확인으로 유지했습니다. 후보 전체 집계는 유지합니다.');
  const facts=[
   {id:'E01',title:'후보 구성 집단과 분모',detail:`후보 구성 고객 ${summary.customers}명, 통화 ${summary.totalCalls}건, 관측 ${summary.observedDays}일입니다. 저품질로 선정된 집단이며 지역 전체 정상 분모와 지역 불량률은 미산정입니다.`,severity:'caution'},
   {id:'E02',title:'저장 QoE·원본 MOS·SIP Drop 구분',detail:`저장 QoE 평가 ${summary.evaluatedCalls}건 중 저QoE ${summary.poorCalls}건, 평균 ${summary.meanQoe??'미평가'}. 유효 원본 MOS ${summary.rawMosEvaluatedCalls}건 중 MOS 저품질 ${summary.rawMosPoorCalls}건, 평균 ${summary.meanMos??'미평가'}. SIP Drop ${summary.dropCalls}건은 별도 집계이며 다른 SIP 상태의 부재를 뜻하지 않습니다.`,severity:'attention'},
   {id:'E03',title:'날짜·시간대별 관측',detail:`구성 통화는 발견일 ${published.discoveryDates.length}일의 매일 ${target.scope.from}~${target.scope.to} 범위입니다. 날짜·시간대 집계는 전체 구성 통화 기준이며 저하 순간의 정밀 시간 정합은 미검증입니다.`,severity:'info'},
   {id:'E04',title:'위치 근거와 범위 불확실성',detail:`GPS ${gpsCalls}통화, MDT 근사 ${roughCalls}통화, 검토 통과 삼각 측량 ${reviewedRadioCalls}통화입니다. 표시 반경 ${candidate.radiusM}m, 구성점 간 최대 거리 ${candidate.maxPairDistanceM}m는 별개이며 ${candidate.rangeReviewRequired?'범위 검토가 필요합니다':'표시 범위의 위치·시각 근거를 확인해야 합니다'}. 하나의 기지국 원인이나 저하 순간 위치로 확정할 수 없습니다.`,severity:'caution'},
   {id:'E05',title:'Cell별 구성과 조사 단위',detail:`대표 Cell은 ${cells.length}개 집계 집단입니다. 상위 ${Math.min(12,cells.length)}개와 나머지 합계를 구분했습니다. Cell·시간대·위치 근거별로 조사하며 같은 건수만으로 같은 통화 집합이라고 판단하지 않습니다.`,severity:'caution'},
   {id:'E06',title:'전체 집계와 상세 표본 확보 범위',detail:`전체 구성 ${rows.length}통화와 상세 표본 ${calls.length}통화를 구분합니다. 상세 표본 중 통화 매칭 무선 ${radioCalls}통화, 수치형 RTP ${rtpCalls}통화입니다. ${detailsPolicy}`,severity:'caution'},
   {id:'E07',title:'통화 연결 무선 근거',detail:radioCalls?`표본 RSRP ${radio.rsrpCalls}통화 평균 ${radio.meanRsrp??'미확보'} dBm, SINR ${radio.sinrCalls}통화 평균 ${radio.meanSinr??'미확보'} dB입니다. 통화별 동일 가중이며 정상 비교나 승인 기준 없이 양호·불량으로 등급화하지 않습니다.`:'상세 표본에서 통화에 매칭된 RSRP·SINR을 확보하지 못했습니다. 결측을 정상으로 해석하지 않습니다.',severity:'caution'},
   {id:'E08',title:'RTP 원본 지표와 단위',detail:rtpCalls?rtp.filter(row=>row.measuredCalls).map(row=>`${row.field}: ${row.measuredCalls}통화 평균 ${row.mean}`).join('; ')+'. 원본 단위 미확인으로 백분율 또는 ms를 붙이지 않습니다.':'상세 표본에 수치형 RTP 근거가 없습니다. 결측을 손실 또는 지터 0으로 처리하지 않습니다.',severity:'caution'},
   {id:'E09',title:'정상 비교군 미산정',detail:comparison.conditions+' 같은 고객의 기간 전체 통화는 지역 정상 분모가 아닙니다. 조건에 맞는 자료를 추가 확보해야 합니다.',severity:'caution'},
   {id:'E10',title:'서로 다른 MDT 자료 구분',detail:`후보 위치에 사용한 GPS·MDT 근사와 통화 연결 MDT 측정행, 별도 측정일의 배경 참고 격자는 다른 자료입니다. ${coverage.matchedMdt.status==='available'?`통화 연결 MDT ${coverage.matchedMdt.matchedCalls}통화, 측정행 ${coverage.matchedMdt.measurementRows}행입니다. 측정행은 독립 통화·고객 수가 아닙니다.`:'통화 연결 MDT 측정행 집계는 미확보입니다.'} ${mdtGrid.status==='available'?`배경 격자 측정일 ${mdtGrid.measurementDates.join(', ')}, 격자 ${mdtGrid.cellSizeM}m입니다. Top1은 최다 측정 대역이며 최강 신호나 통화 당시 서빙 Cell이 아닙니다.`:'배경 참고 격자는 미확보입니다.'}`,severity:'caution'},
   {id:'E11',title:'발견·별도 평가 자료',detail:published.validationDates.length?`발견 ${published.discoveryDates.length}일과 별도 평가 ${published.validationDates.length}일을 구분합니다. 별도 관측도 원인 확정이나 개선 효과의 인과 검증은 아닙니다.`:'모든 선택 날짜가 후보 발견에 사용되었습니다. 별도 검증일은 없으며 개선 효과는 별도 날짜와 비교 조건으로 확인해야 합니다.',severity:'caution'},
   {id:'E12',title:'대상 고정과 자료 계보',detail:'서버가 현재 후보 원본과 구성 통화의 고객·날짜·시간·품질 조건을 재확인했습니다. 군집 조건·구성 통화 집합·위치 정책·원본 자료와 분석·SOP 버전을 함께 고정했습니다. 지도 배경 격자 표시 변경은 분석 대상을 바꾸지 않습니다.',severity:'info'}
  ];
  const findings=buildCandidateFindings({grid:resolved.analysisGrid??resolved.grid,termination:resolved.termination,sourceRevision,candidate:detail.candidate,rows,calls});
  const coveragePoints=buildCoveragePoints(findings.analysisTargets,findings.neighbourLinks);
  const coverageComparison=comparisonExample(coveragePoints);
  const capacityComparison=endCellComparison(db,rows,reader);
  const causeAssessments=buildCauseAssessments(findings.analysisTargets,findings.modelTargets,{coveragePoints,capacityComparison,calls});
  const capacityRow=causeAssessments.find(row=>row.category==='capacity');
  facts.push({id:'E13',title:'같은 날짜·시작 시간대·종료 셀의 비교 통화',detail:capacityRow.reason,severity:'info'});
  capacityRow.evidenceIds=['E13'];
  facts.unshift(...findings.facts);limitations.push(...findings.limitations);
  const sop=selectCandidateSop({candidate,summary,comparison,coverage,location,mdtGrid,analysisTargets:findings.analysisTargets});
  const fingerprint=hash({request:candidateRequestKey(target),artifact:resolved.artifactHash,memberSetHash});
  const evidence={schemaVersion:'qwen-candidate-evidence-v2',target,sourceRevision,generatedAt:new Date().toISOString(),fingerprint,versions,candidate,summary,byDay,byCell,byHour,facts,analysisTargets:findings.analysisTargets,neighbourLinks:findings.neighbourLinks,mdtCoverage:findings.mdtCoverage,transmission:findings.transmission,calls,members,coverage,comparison,location,radio,rtp,mdtGrid,limitations,sop};
  // Explicit allowlist: do not pass local identifiers, URLs, paths or coordinates.
  const safeTargets=findings.modelTargets.map(model=>{
   const publicTarget=findings.analysisTargets.find(t=>t.id===model.id);
   return {...publicTarget,title:model.id,observation:JSON.stringify(model.metrics),
    metrics:model.kind==='termination-group'?Object.entries(model.metrics.rawCodes).map(([label,value])=>({label,value})):publicTarget.metrics};
  });
  const modelSop=selectCandidateSop({candidate,summary,comparison,coverage,location,mdtGrid,analysisTargets:safeTargets});
  // Public evidence preserves full source details. The model sees each value once.
  const compactSop={...modelSop,templates:modelSop.templates.map(step=>({
   id:step.id,title:step.title,targetKind:step.targetKind,...(step.causeCategory?{causeCategory:step.causeCategory}:{}),
   checkNow:step.checkNow,conditionalActions:step.conditionalActions,verifyAfter:step.verifyAfter
  }))};
  const modelFacts=facts.map(fact=>/^T\d+$/.test(fact.id)?{id:fact.id}:fact);
  const targetFacts=new Map(findings.analysisTargets.map(t=>[t.id,t.evidenceIds[0]]));
  const modelNeighbourLinks=findings.neighbourLinks.map(([from,to,direction,distance])=>[targetFacts.get(from),targetFacts.get(to),direction,distance]);
  const targetRules={'mdt-grid':{allowedCauseCategories:['coverage'],sopByCategory:{coverage:['MDT_COVERAGE_REVIEW']},investigationHint:{why:'같은 날짜·대역·EARFCN의 RSRP 분포를 주변 POT와 비교해 조사 경계를 좁힐 수 있습니다. 기준 이하 영 비율도 전체 품질 정상을 뜻하지 않습니다.',check:'같은 날짜·대역·EARFCN 인접 POT의 RSRP·RSRQ를 비교하고, 선택 구간에서 서빙·이웃 셀과 음성 품질을 동시 측정합니다.'}}};

  const modelInput={schemaVersion:'qwen-candidate-evidence-v2',subject:'선택 후보 지역',versions,scope:target.scope,causeAssessments:findings.causeAssessments,criteriaPolicy:{dl:{field:'RSRP',operator:'<=',threshold:-100,unit:'dBm'},ul:{field:'PHR',operator:'<=',threshold:3,unit:'원본 단위 미확인',gridAggregation:'원본 평균이며 개별 측정 비율 아님'},pollution:{fields:['servingPci','cellId'],minimumChanges:3,windowSeconds:30,changeRule:'동일 통화의 연속 관측 사이 실제 PCI 또는 Cell-ID 변경을 한 경계당 1회 집계; 이웃 PCI 수 아님'}},targetIdPolicy:'evidence-id-alias-v1',observationGroups:findings.observationGroups,
   candidate:{algorithm:candidate.algorithm,parameters:candidate.parameters,locationMode:candidate.locationMode,rangeReviewRequired:candidate.rangeReviewRequired,radiusM:candidate.radiusM,maxPairDistanceM:candidate.maxPairDistanceM,discoveryDates:candidate.discoveryDates,validationDates:candidate.validationDates},
   analysisTargets:findings.modelTargets,targetRules,neighbourLinkColumns:['fromEvidenceId','toEvidenceId','direction','distanceM'],neighbourLinks:modelNeighbourLinks,neighbourLinksMeaning:'각 쌍은 analysisTargets.evidenceIds로 두 대상에 연결됩니다. 방향은 앞 대상에서 뒤 대상 기준이며 같은 날짜·대역·EARFCN 인접 쌍만 한 번 포함합니다. 가설 targetIds는 해당 대상의 id를 사용합니다.',mdtCoverage:findings.mdtCoverage,mdtMetricBasis:{metricWeightBasis:findings.metricWeightBasis,metricSamplesOmitted:'생략한 지표별 집계 가중치는 해당 행의 samples와 같습니다. 실제 유효 분모 확정이 아닙니다.',sampleSupportOmitted:'생략한 sampleSupport는 집계 가중치 30 이상입니다. 독립 통화 수가 아닙니다.'},transmission:findings.transmission,summary,byDay,byHour,byCell:byCell.map((row,index)=>({...row,cell:row.cell==='미확인'?'Cell 미확인':row.cell==='기타 Cell 합계'?row.cell:'대표 Cell '+String(index+1).padStart(2,'0')})),facts:modelFacts,coverage,comparison,location,radio,rtp,mdtGrid,limitations,sop:compactSop};
  // The detailed public assessments contain POT and serving identifiers. Only
  // aliases, category headlines, source links and de-identified measures are sent.
  modelInput.causeAssessments=causeAssessments.map(row=>({...row,reason:row.category==='capacity'?row.reason:row.status==='insufficient'?'원본 근거 미확보':row.headline+'의 원본 근거를 연결했습니다.'}));
  modelInput.coveragePointTargetIds=coveragePoints.points.map(point=>point.targetId);
  modelInput.capacityComparison=capacityComparison;
  modelInput.criteriaPolicy.overlap={sameEarfcn:true,sequence:'A→B→A',windowSeconds:30,meaning:'동일 주파수 셀 중첩 조사 단서이며 간섭 확정 근거는 아닙니다.'};
  modelInput.criteriaPolicy.frequencyChange={fields:['EARFCN'],meaning:'연속한 동일 통화 측정의 실제 주파수 변경입니다. RRC 절차 결과는 미확인입니다.'};
  modelInput.comparisonContext=buildCandidateComparisonContext(modelInput,findings,calls);
  // Reserve room for the two source link catalogs added after selection.
  const boundedModel=boundCandidateModelInput(modelInput,findings,154000);
  boundedModel.modelInput.sourceHypothesisCandidates=buildSourceHypothesisCandidates(boundedModel.modelInput);
  boundedModel.modelInput.sourceInvestigationCandidates=buildSourceInvestigationCandidates(boundedModel.modelInput);
  const modelCharacters=JSON.stringify(boundedModel.modelInput).length;
  if(modelCharacters>160000)fail(`후보 전체 ${findings.mdtCoverage.measuredPots} POT의 분석 입력이 허용 크기를 초과했습니다 (${modelCharacters}자). 일부만 잘라 분석하지 않았습니다. 조사 범위를 나누어 분석해 주세요.`,'ANALYSIS_EVIDENCE_TOO_LARGE',413);
  return {...evidence,causeAssessments,coveragePoints,coverageComparison,capacityComparison,independentReview:findings.independentReview,transmission:boundedModel.transmission,modelInput:boundedModel.modelInput};
 }finally{db.close();}
}
module.exports={resolveCandidate,validateGridPair,validateCandidateTarget,collectCandidateEvidence,candidateRequestKey,versions,EVIDENCE_VERSION,PROMPT_VERSION,SOP_VERSION};
