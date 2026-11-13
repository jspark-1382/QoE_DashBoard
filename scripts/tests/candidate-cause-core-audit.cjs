/* eslint-disable no-console, @typescript-eslint/no-require-imports -- One source-only core-filter audit, never model inference. */
const fs=require('node:fs'),path=require('node:path');
const {collectCandidateEvidence}=require('../qwen-candidate-evidence.cjs');
const root=path.resolve(__dirname,'../..'),publicDir=path.join(root,'public'),directory=path.join(root,'outputs/candidate-five-causes');
fs.mkdirSync(directory,{recursive:true});
const index=JSON.parse(fs.readFileSync(path.join(publicDir,'quality-improvement-mixed-full/index.json'),'utf8'));
const entry=index.entries.find(row=>row.scope.dateStart==='2026-10-26'&&row.scope.dateEnd==='2026-10-30');
const summary=JSON.parse(fs.readFileSync(path.join(publicDir,'quality-improvement-mixed-full',entry.path),'utf8'));
const dbIndex=JSON.parse(fs.readFileSync(path.join(publicDir,'voice-query-index.json'),'utf8'));
const report={schemaVersion:'candidate-five-cause-core-audit-v1',startedAt:new Date().toISOString(),mode:'source-only-no-model-requests',sourceRevision:index.sourceRevision,scope:entry.scope,status:'running',rows:[]};
const output=path.join(directory,'core-audit.json');
const selectedArg=process.argv.find(arg=>arg.startsWith('--only='));
const selected=selectedArg?new Set(selectedArg.slice(7).split(',').map(Number)):null;
for(const [ordinal,card] of summary.candidates.entries()){
 const number=ordinal+1;if(selected&&!selected.has(number))continue;
 const target={kind:'candidate',candidateId:card.id,sourceRevision:index.sourceRevision,scope:{dateStart:entry.scope.dateStart,dateEnd:entry.scope.dateEnd,from:entry.scope.from,to:entry.scope.to},candidateScope:{scopeKey:entry.scopeKey,policy:entry.scope.policy,analysisMode:'all',locationMode:index.locationMode,modelId:'dbscan'}};
 try{
  const evidence=collectCandidateEvidence({publicDir,dbPath:path.resolve(root,dbIndex.database),sourceRevision:index.sourceRevision,target});
  const calls=evidence.analysisTargets.filter(row=>row.kind==='call-criteria'),pots=evidence.analysisTargets.filter(row=>row.kind==='mdt-grid');
  const matched=(rows,key)=>rows.filter(row=>row.criteria?.[key]?.status==='matched');
  const counts={dlCalls:matched(calls,'dl').length,ulCalls:matched(calls,'ul').length,pollutionCalls:matched(calls,'pollution').length,dlPotCombinations:matched(pots,'dl').length,ulMeanPotCombinations:matched(pots,'ul').length};
  const row={number,status:'passed',target,versions:evidence.versions,counts,totalCalls:evidence.summary.totalCalls,detailedCalls:evidence.calls.length,modelCharacters:JSON.stringify(evidence.modelInput).length,causeAssessments:evidence.causeAssessments,pollutionExamples:matched(calls,'pollution').slice(0,2).map(row=>({targetId:row.id,callIds:row.callIds,criterion:row.criteria.pollution})),dlExample:matched(pots,'dl').slice(0,1).map(row=>({targetId:row.id,pots:row.mapPoints.map(point=>point.pot),criterion:row.criteria.dl}))};
  report.rows.push(row);console.log('SOURCE_CRITERIA',JSON.stringify({number,status:row.status,counts,modelCharacters:row.modelCharacters}));
 }catch(error){report.rows.push({number,target,status:'failed',code:error.code,message:error.message});console.log('SOURCE_ERROR',JSON.stringify({number,code:error.code,message:error.message}));}
 fs.writeFileSync(output,JSON.stringify(report,null,2));
}
report.finishedAt=new Date().toISOString();report.counts={reviewed:report.rows.length,passed:report.rows.filter(row=>row.status==='passed').length,failed:report.rows.filter(row=>row.status!=='passed').length};report.status=report.counts.failed?'needs-fixes':'passed';
fs.writeFileSync(output,JSON.stringify(report,null,2));console.log('SOURCE_FINISH',JSON.stringify(report.counts));if(report.counts.failed)process.exitCode=1;
