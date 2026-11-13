/* eslint-disable @typescript-eslint/no-require-imports -- Private local analysis history, outside public assets. */
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {validateCandidateTarget}=require('./qwen-candidate-evidence.cjs');
const LIMIT=3;
const MAX_BYTES=64*1024*1024;
const SCHEMA='candidate-analysis-history-v1';
const targetKey=input=>{
 const t=validateCandidateTarget(input),s=t.scope,c=t.candidateScope;
 return JSON.stringify([t.kind,t.candidateId,t.sourceRevision,s.dateStart,s.dateEnd,s.from,s.to,c.scopeKey,c.policy,c.analysisMode,c.locationMode,c.modelId]);
};
function historyError(){const error=new Error('저장된 후보 분석을 읽거나 저장하지 못했습니다. 저장 폴더의 상태를 확인한 뒤 다시 시도해 주세요.');error.code='ANALYSIS_HISTORY_UNAVAILABLE';error.status=503;return error;}
function createCandidateHistoryStore(root){
 const directory=path.join(root,'outputs','candidate-ai-analysis');
 const filename=key=>path.join(directory,createHash('sha256').update(key).digest('hex')+'.json');
 function read(file,key){
  let value;
  try{
   if(fs.statSync(file).size>MAX_BYTES)throw historyError();
   value=JSON.parse(fs.readFileSync(file,'utf8'));
  }catch(error){if(error.code==='ENOENT')return null;throw historyError();}
  if(value?.schemaVersion!==SCHEMA||typeof value.targetKey!=='string'||(key&&value.targetKey!==key)||!Array.isArray(value.jobs)||value.jobs.length>LIMIT)throw historyError();
  for(const item of value.jobs){
   const job=item?.job;
   try{if(!job||typeof job.id!=='string'||!/^[-A-Za-z0-9_]+$/.test(job.id)||job.status!=='completed'||!job.report||!job.evidence||job.persistence?.status!=='saved'||targetKey(job.target)!==value.targetKey)throw historyError();}catch{throw historyError();}
  }
  return value;
 }
 const list=target=>read(filename(targetKey(target)),targetKey(target))?.jobs??[];
 return {
  limit:LIMIT,
  list,
  find(id){
   if(typeof id!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(id))return null;
   let files;try{files=fs.readdirSync(directory);}catch(error){if(error.code==='ENOENT')return null;throw historyError();}
   for(const file of files.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){
    let group;try{group=read(path.join(directory,file));}catch{/* An unrelated damaged group must not hide other candidates. */continue;}
    const item=group?.jobs.find(item=>item.job.id===id);if(item)return item;
   }
   return null;
  },
  save(item){
   const key=targetKey(item.job.target),file=filename(key);
   // One atomic group replacement removes older reports and their diagnostics together.
   const jobs=[structuredClone(item),...list(item.job.target).filter(row=>row.job.id!==item.job.id)].slice(0,LIMIT);
   const serialized=JSON.stringify({schemaVersion:SCHEMA,targetKey:key,jobs});
   if(Buffer.byteLength(serialized,'utf8')>MAX_BYTES){const error=new Error('최근 후보 분석 결과의 저장 크기 한도를 초과했습니다. 이전 저장 결과는 유지됩니다.');error.code='ANALYSIS_HISTORY_TOO_LARGE';error.status=413;throw error;}
   const temporary=file+'.'+randomUUID()+'.tmp';
   try{
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(temporary,serialized,{encoding:'utf8',flag:'wx'});
    fs.renameSync(temporary,file);
   }catch{try{fs.unlinkSync(temporary);}catch{/* No partial snapshot is published. */}throw historyError();}
   return jobs;
  },
 };
}
module.exports={createCandidateHistoryStore,candidateHistoryTargetKey:targetKey};
