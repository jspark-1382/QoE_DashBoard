/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node export command. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const strict=d=>d?.status==='accepted'&&['gnss','reviewed-radio'].includes(d.kind)&&Number.isFinite(d.lat)&&Number.isFinite(d.lon)&&!(d.reasons?.length)&& (d.kind!=='reviewed-radio'||d.review?.accepted===true);
function proveEvidenceCensus(report,overview){
 if(!overview||overview.sourceRevision!==report.sourceRevision||report.scope.dateStart!==report.scope.dateEnd||report.scope.dateStart!==overview.date||report.scope.from!=='00:00'||report.scope.to!=='23:59')return false;
 const ids=new Set(overview.calls.map(c=>c.id.startsWith(overview.date+':')?c.id:overview.date+':'+c.id));
 const calls=new Set(report.calls.map(c=>c.callId)),decisions=new Set(report.decisions.map(d=>d.callId));
 return ids.size===overview.calls.length&&calls.size===report.calls.length&&decisions.size===report.decisions.length&&ids.size===calls.size&&ids.size===decisions.size&&report.calls.every(c=>ids.has(c.callId)&&['unique','ambiguous','none'].includes(c.mdtLinkStatus))&&report.decisions.every(d=>ids.has(d.callId)&&['accepted','excluded'].includes(d.status));
}
function splitReport(report,auditReference,censusComplete=false){
 const scope={sourceRevision:report.sourceRevision,dateStart:report.scope.dateStart,dateEnd:report.scope.dateEnd,from:report.scope.from,to:report.scope.to,policy:report.policy.locationPolicy};
 const decisions=new Map(report.decisions.map(d=>[d.callId,d]));
 const byCall=new Map(report.calls.map(c=>[c.callId,c]));
 const observations=[],records=[];
 for(const call of report.calls){
  const decision=decisions.get(call.callId);
  if(call.mdtLinkStatus==='unknown'||call.mdtLinkStatus==='none')continue;
  const record={callId:call.callId,mdtLinkStatus:call.mdtLinkStatus,status:decision?.status,reasons:decision?.reasons??[]};
  if(strict(decision)&&call.mdtLinkStatus==='unique')Object.assign(record,{status:'accepted',kind:decision.kind,lat:decision.lat,lon:decision.lon,observedAt:decision.observedAt});
  else if(record.status==='accepted'){record.status='excluded';record.reasons=['unreviewed-location'];}
  records.push(record);
  if(record.status==='accepted'&&call.mos>=1&&call.mos<3)observations.push({callId:call.callId,customerId:call.customerId,date:call.date,mos:call.mos,start:call.start,lat:record.lat,lon:record.lon,kind:record.kind,observedAt:record.observedAt});
 }
 const directory=report.sourceRevision+'/'+report.scopeKey;
 const details=report.improvedSpatialCandidates.map(candidate=>{
  const callIds=new Set([...candidate.memberCallIds,...candidate.nearbyPoints.map(p=>p.callId)]);
  return{schemaVersion:'quality-candidate-detail-v1',scope,scopeKey:report.scopeKey,candidate,calls:[...callIds].map(id=>byCall.get(id)).filter(Boolean),decisions:[...callIds].map(id=>decisions.get(id)).filter(Boolean),fieldEvidence:report.fieldEvidence??[],scanComparison:report.scanComparison??null};
 });
 const affected=new Set(report.improvedSpatialCandidates.flatMap(c=>[...c.memberCallIds,...c.nearbyPoints.map(p=>p.callId)]).map(id=>byCall.get(id)?.customerId).filter(Boolean));
 const summary={distinctAffectedCustomers:affected.size,schemaVersion:'quality-candidate-summary-v1',scope,scopeKey:report.scopeKey,discoveryDates:report.discoveryDates,validationDates:report.validationDates,coverage:report.coverage,auditReference,observationPath:directory+'/observations.json',candidates:report.improvedSpatialCandidates.map((c,i)=>({id:c.id,label:'중복 위치 '+(i+1),poorCustomerCount:c.poorCustomerCount,poorCallCount:c.poorCallCount,poorDateCount:c.poorDateCount,medoid:c.medoid,displayRadiusM:c.displayRadiusM,rangeReviewRequired:c.rangeReviewRequired,rank:c.rank,validationStatus:c.validationStatus,validationNewCustomers:c.validationNewCustomerIds.length,detailPath:directory+'/'+c.id+'.json'}))};
 if(Buffer.byteLength(JSON.stringify(summary))>1024*1024)throw new Error('Candidate summary exceeds 1 MB');
 return{summary,details,observations,evidence:{revision:report.sourceRevision,date:scope.dateStart===scope.dateEnd?scope.dateStart:undefined,policy:scope.policy,censusComplete,records}};
}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));}
function publish(inputDir,outDir,auditDir){
 const index=JSON.parse(fs.readFileSync(path.join(inputDir,'index.json'),'utf8'));
 const entries=[],audit=[],evidence=[];
 // Single-day source partitions provide a disjoint sparse index without repeated full-period reads.
 for(const entry of index.entries){
  const sourcePath=path.resolve(inputDir,entry.path);if(!sourcePath.startsWith(path.resolve(inputDir)+path.sep))throw new Error('Unsafe source path');
  const bytes=fs.readFileSync(sourcePath),report=JSON.parse(bytes.toString('utf8'));
  if(report.sourceRevision!==index.sourceRevision||report.sourceRevision!==entry.scope.sourceRevision||report.scopeKey!==entry.scopeKey)throw new Error('Stale source report');
  const auditReference='outputs/quality-improvement-audit/'+index.sourceRevision+'/audit.json';
  const overviewPath=path.resolve(inputDir,'../analyst-overview/MDT',report.scope.dateStart+'.json');
  const original=report.scope.dateStart===report.scope.dateEnd&&fs.existsSync(overviewPath)?JSON.parse(fs.readFileSync(overviewPath,'utf8')):null;
  const result=splitReport(report,auditReference,proveEvidenceCensus(report,original)),directory=report.sourceRevision+'/'+report.scopeKey;
  writeJson(path.join(outDir,directory,'summary.json'),result.summary);
  writeJson(path.join(outDir,directory,'observations.json'),{schemaVersion:'quality-observations-v1',scope:result.summary.scope,points:result.observations});
  for(const detail of result.details)writeJson(path.join(outDir,directory,detail.candidate.id+'.json'),detail);
  if(report.scope.dateStart===report.scope.dateEnd){const relative=report.sourceRevision+'/evidence/'+report.scope.dateStart+'.json';writeJson(path.join(outDir,relative),result.evidence);evidence.push({date:report.scope.dateStart,path:relative});}
  entries.push({scope:result.summary.scope,scopeKey:report.scopeKey,path:directory+'/summary.json'});
  audit.push({source:entry.path,sha256:hash(bytes),inputHash:report.inputHash,inventoryHash:report.inventoryHash,inputFiles:report.inputFiles,summaryBytes:Buffer.byteLength(JSON.stringify(result.summary)),candidateCount:result.summary.candidates.length});
 }
 writeJson(path.join(auditDir,index.sourceRevision,'audit.json'),{sourceRevision:index.sourceRevision,entries:audit});
 const output={schemaVersion:'quality-improvement-index-v1',sourceRevision:index.sourceRevision,availableDates:index.availableDates,entries,evidence};writeJson(path.join(outDir,'index.json'),output);return output;
}
if(require.main===module){const base=path.resolve(__dirname,'..'),pub=path.resolve(process.env.QOE_PUBLIC_DIR||path.join(base,'public'));const index=publish(path.join(pub,'voice-improvement-1'),path.join(pub,'quality-improvement'),path.join(base,'outputs/quality-improvement-audit'));process.stdout.write(JSON.stringify({revision:index.sourceRevision,scopes:index.entries.length,evidenceDays:index.evidence.length})+'\n');}
module.exports={splitReport,publish,proveEvidenceCensus};
