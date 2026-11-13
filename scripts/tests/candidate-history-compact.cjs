/* eslint-disable no-console, @typescript-eslint/no-require-imports -- Lossless private snapshot maintenance. */
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {publicCandidateEvidence}=require('../qwen-candidate-public-evidence.cjs');
const root=path.resolve(__dirname,'../..'),directory=path.join(root,'outputs','candidate-ai-analysis'),backup=path.join(root,'outputs','candidate-full-audit','history-before-compaction');
const apply=process.argv.includes('--apply'),rows=[];
for(const name of fs.readdirSync(directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){
 const file=path.join(directory,name),original=fs.readFileSync(file),group=JSON.parse(original);
 if(group.schemaVersion!=='candidate-analysis-history-v1'||!Array.isArray(group.jobs))throw Error('Unexpected history schema');
 const jobs=group.jobs.map(item=>{
  if(item.job.status!=='completed'||!item.job.report||!item.job.evidence)throw Error('Only completed snapshots can be compacted');
  const user=item.diagnostics?.request?.messages.find(message=>message.role==='user')?.content;
  let modelInput;try{modelInput=JSON.parse(user);}catch{/* Edited user text can be plain language. Public retained IDs remain sufficient. */}
  return {...item,job:{...item.job,evidence:publicCandidateEvidence(item.job.evidence,item.job.report,modelInput)}};
 });
 const text=JSON.stringify({...group,jobs}),bytes=Buffer.byteLength(text);
 if(bytes>64*1024*1024)throw Error('Compacted history still exceeds supported size');
 if(apply&&bytes<original.length){
  fs.mkdirSync(backup,{recursive:true});const copy=path.join(backup,name);if(!fs.existsSync(copy))fs.copyFileSync(file,copy);
  const temporary=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,text,{encoding:'utf8',flag:'wx'});fs.renameSync(temporary,file);
 }
 rows.push({file:name,before:original.length,after:bytes,jobs:jobs.length,applied:apply&&bytes<original.length});
}
fs.writeFileSync(path.join(root,'outputs','candidate-full-audit','history-compaction.json'),JSON.stringify({apply,rows},null,2));
console.log('HISTORY_COMPACTION',JSON.stringify({apply,groups:rows.length,before:rows.reduce((n,r)=>n+r.before,0),after:rows.reduce((n,r)=>n+r.after,0)}));
