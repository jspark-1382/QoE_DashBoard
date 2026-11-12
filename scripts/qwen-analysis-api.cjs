/* eslint-disable @typescript-eslint/no-require-imports -- The local Node preview and workers load this CommonJS module. */
/* Local server-only asynchronous analysis API; no Qwen settings enter the bundle. */
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {loadQwenConfig,publicConfig,requireConfigured,analysisError}=require('./qwen-analysis-config.cjs');
const {analyzeWithQwen,checkConnection}=require('./qwen-analysis-client.cjs');
const {validateTarget}=require('./qwen-analysis-evidence.cjs');
const PREFIX='/qoe/api/analysis/';
const TERMINAL=new Set(['completed','failed','cancelled']);
const SAFE_EVIDENCE_CODES=new Set(['INVALID_ANALYSIS_TARGET','STALE_REVISION','EVIDENCE_UNAVAILABLE','NO_CALLS']);
function safeError(error){
 if((typeof error.code==='string'&&(error.code.startsWith('QWEN_')||error.code.startsWith('ANALYSIS_')))||SAFE_EVIDENCE_CODES.has(error.code))return {code:error.code,message:error.message,status:error.status??502};
 return {code:'ANALYSIS_FAILED',message:'분석 처리 중 오류가 발생했습니다. 자료와 서버 상태를 확인해 주세요.',status:500};
}
async function sourceIndex(root,publicDir){
 let index;try{index=JSON.parse(await fs.promises.readFile(path.join(publicDir,'voice-query-index.json'),'utf8'));}catch{throw analysisError('EVIDENCE_UNAVAILABLE','음성 조회 자료가 없습니다. 데이터 새로 고침을 실행해 주세요.',503);}
 if(index.schemaVersion!=='voice-query-index-v1'||index.databaseSchema!=='voice-query-db-v1'||typeof index.sourceRevision!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(index.sourceRevision)||typeof index.database!=='string'||path.isAbsolute(index.database))throw analysisError('EVIDENCE_UNAVAILABLE','음성 조회 자료의 버전 정보를 확인할 수 없습니다.',503);
 const database=path.resolve(root,index.database),allowed=path.resolve(root,'outputs','voice-query-data');
 if(!database.startsWith(allowed+path.sep)||path.extname(database)!=='.sqlite')throw analysisError('EVIDENCE_UNAVAILABLE','음성 조회 자료 경로가 올바르지 않습니다.',503);
 let real,realAllowed;try{[real,realAllowed]=await Promise.all([fs.promises.realpath(database),fs.promises.realpath(allowed)]);}catch{throw analysisError('EVIDENCE_UNAVAILABLE','음성 조회 데이터베이스가 없습니다.',503);}
 if(!real.startsWith(realAllowed+path.sep))throw analysisError('EVIDENCE_UNAVAILABLE','음성 조회 자료 경로가 올바르지 않습니다.',503);
 let file,header;try{
  file=await fs.promises.open(path.join(publicDir,'voice-1030.json'),'r');
  const buffer=Buffer.alloc(128*1024),{bytesRead}=await file.read(buffer,0,buffer.length,0);header=buffer.toString('utf8',0,bytesRead);
 }catch{throw analysisError('EVIDENCE_UNAVAILABLE','원본 자료 버전을 확인할 수 없습니다.',503);}finally{await file?.close();}
 if(header.match(/"revision"\s*:\s*"([^"\\]+)"/)?.[1]!==index.sourceRevision)throw analysisError('STALE_REVISION','자료 버전이 변경되었습니다. 데이터 갱신 후 다시 분석해 주세요.',409);
 return {dbPath:real,sourceRevision:index.sourceRevision};
}
function createQwenAnalysisHandler({root,publicDir=path.join(root,'public'),env,collectEvidence,maxRunning=2,maxQueued=6,jobTtlMs=30*60*1000,maxStored=40}){
 const jobs=new Map(),queue=[],workers=new Set(),running=new Set(),connections=new Set();let closed=false;
 const readConfig=()=>loadQwenConfig(root,env??process.env);
 const snapshot=record=>{
  const result={id:record.id,target:record.target,status:record.status,createdAt:record.createdAt,updatedAt:record.updatedAt,model:record.config.model};
  if(record.error)result.error=record.error;if(record.evidence){const {modelInput:_modelInput,...publicEvidence}=record.evidence;result.evidence=publicEvidence;}if(record.report)result.report=record.report;return result;
 };
 const reply=(res,status,body)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
 const update=(record,status)=>{record.status=status;record.updatedAt=new Date().toISOString();};
 const cancel=record=>{if(TERMINAL.has(record.status))return;update(record,'cancelled');record.controller.abort();const index=queue.indexOf(record);if(index>=0)queue.splice(index,1);};
 function prune(){
  const now=Date.now();for(const [id,record] of jobs)if(TERMINAL.has(record.status)&&now-Date.parse(record.updatedAt)>jobTtlMs)jobs.delete(id);
  while(jobs.size>=maxStored){const oldest=[...jobs].find(([,record])=>TERMINAL.has(record.status));if(!oldest)break;jobs.delete(oldest[0]);}
 }
 const cleanup=setInterval(prune,60000);cleanup.unref?.();
 function workerEvidence(options){
  if(options.signal.aborted)return Promise.reject(analysisError('ANALYSIS_CANCELLED','분석이 취소되었습니다.',499));
  return new Promise((resolve,reject)=>{
   const {signal,...data}=options;const worker=new Worker(path.join(__dirname,'qwen-analysis-worker.cjs'),{workerData:data});workers.add(worker);let settled=false;
   const done=(error,evidence)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);workers.delete(worker);void worker.terminate();if(error)reject(error);else resolve(evidence);};
   const abort=()=>done(analysisError('ANALYSIS_CANCELLED','분석이 취소되었습니다.',499));
   const timer=setTimeout(()=>done(analysisError('ANALYSIS_EVIDENCE_TIMEOUT','근거 집계 제한 시간이 지났습니다. 분석 기간을 줄여 다시 시도해 주세요.',504)),60000);timer.unref?.();
   signal.addEventListener('abort',abort,{once:true});
   worker.once('error',()=>done(analysisError('EVIDENCE_UNAVAILABLE','분석 근거 작업을 실행하지 못했습니다. 음성 자료 상태를 확인해 주세요.',503)));
   worker.once('exit',()=>{if(!settled)done(analysisError('EVIDENCE_UNAVAILABLE','분석 근거 작업이 중단되었습니다. 다시 시도해 주세요.',503));});
   worker.once('message',message=>{if(message.error)done(analysisError(message.error.code,message.error.message,message.error.status));else if(message.evidence)done(null,message.evidence);else done(analysisError('EVIDENCE_UNAVAILABLE','분석 근거 응답을 읽지 못했습니다.',503));});
  });
 }
 const gather=collectEvidence??workerEvidence;
 async function execute(record){
  try{
   if(record.controller.signal.aborted)return;
   update(record,'collecting');
   const evidence=await gather({...record.source,publicDir,target:record.target,signal:record.controller.signal});
   if(record.controller.signal.aborted||closed)return;
   record.evidence=evidence;update(record,'analyzing');
   const report=await analyzeWithQwen(record.config,evidence,record.controller.signal);
   if(record.controller.signal.aborted||closed)return;
   record.report=report;update(record,'completed');
  }catch(error){
   if(record.controller.signal.aborted||closed){if(!TERMINAL.has(record.status))update(record,'cancelled');return;}
   const safe=safeError(error);record.error={code:safe.code,message:safe.message};update(record,'failed');
  }
 }
 function pump(){
  if(closed)return;
  while(running.size<maxRunning&&queue.length){
   const record=queue.shift();if(!record||record.status!=='queued')continue;
   const task=execute(record);running.add(task);void task.finally(()=>{running.delete(task);pump();});
  }
 }
 async function readBody(req){
  if(Number(req.headers['content-length'])>16384){req.resume();throw analysisError('ANALYSIS_BODY_TOO_LARGE','분석 요청이 너무 큽니다.',413);}
  let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)throw analysisError('ANALYSIS_BODY_TOO_LARGE','분석 요청이 너무 큽니다.',413);chunks.push(chunk);}
  let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw analysisError('ANALYSIS_INVALID_JSON','분석 요청 형식이 올바르지 않습니다.',400);}return input;
 }
 const method=(req,res,allowed)=>{if(!allowed.includes(req.method)){res.setHeader('Allow',allowed.join(', '));throw analysisError('ANALYSIS_METHOD_NOT_ALLOWED','지원하지 않는 요청 방식입니다.',405);}};
 const jsonRequest=req=>{if(String(req.headers['content-type']??'').split(';')[0].trim().toLowerCase()!=='application/json')throw analysisError('ANALYSIS_CONTENT_TYPE','JSON 형식의 요청이 필요합니다.',415);};
 const handler=async(req,res,pathname=(req.url??'/').split('?')[0])=>{
  if(!pathname.startsWith(PREFIX))return false;
  try{
   if(closed)throw analysisError('ANALYSIS_CLOSED','분석 서버가 종료 중입니다.',503);
   if(req.headers['sec-fetch-site']==='cross-site')throw analysisError('ANALYSIS_ORIGIN_REJECTED','다른 사이트의 분석 요청은 허용하지 않습니다.',403);
   if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{throw analysisError('ANALYSIS_ORIGIN_REJECTED','요청 출처가 올바르지 않습니다.',403);}if(origin.host!==req.headers.host||!['http:','https:'].includes(origin.protocol))throw analysisError('ANALYSIS_ORIGIN_REJECTED','다른 사이트의 분석 요청은 허용하지 않습니다.',403);}
   if(pathname===PREFIX+'config'){
    method(req,res,['GET']);
    try{reply(res,200,publicConfig(readConfig()));}catch(error){const safe=safeError(error);reply(res,200,{configured:false,model:'',missing:[],error:{code:safe.code,message:safe.message}});}
   }else if(pathname===PREFIX+'connection'){
    method(req,res,['POST']);jsonRequest(req);
    if(connections.size>=1)throw analysisError('ANALYSIS_CONNECTION_BUSY','연결 확인이 진행 중입니다.',429);
    const controller=new AbortController(),abort=()=>controller.abort();connections.add(controller);res.once('close',abort);
    try{reply(res,200,await checkConnection(readConfig(),controller.signal));}finally{connections.delete(controller);res.off('close',abort);}
   }else if(pathname===PREFIX+'jobs'){
    method(req,res,['POST']);jsonRequest(req);
    const target=validateTarget(await readBody(req)),config=readConfig();requireConfigured(config);
    const source=await sourceIndex(root,publicDir);
    if(source.sourceRevision!==target.sourceRevision)throw analysisError('STALE_REVISION','자료 버전이 변경되었습니다. 새로 고침 후 다시 분석해 주세요.',409);
    prune();
    if([...jobs.values()].filter(record=>!TERMINAL.has(record.status)).length>=maxRunning+maxQueued||jobs.size>=maxStored)throw analysisError('ANALYSIS_QUEUE_FULL','진행 중인 분석이 많습니다. 완료 후 다시 시도해 주세요.',429);
    const now=new Date().toISOString(),record={id:randomUUID(),target:structuredClone(target),config,source,status:'queued',createdAt:now,updatedAt:now,controller:new AbortController()};
    jobs.set(record.id,record);queue.push(record);reply(res,202,snapshot(record));setImmediate(pump);
   }else if(pathname.startsWith(PREFIX+'jobs/')){
    method(req,res,['GET','DELETE']);prune();const id=pathname.slice((PREFIX+'jobs/').length),record=jobs.get(id);
    if(!record)throw analysisError('ANALYSIS_JOB_NOT_FOUND','분석 결과가 만료되었거나 서버가 재시작되었습니다. 다시 분석해 주세요.',404);
    if(req.method==='DELETE')cancel(record);reply(res,200,snapshot(record));if(req.method==='DELETE')pump();
   }else throw analysisError('ANALYSIS_NOT_FOUND','분석 API 경로를 찾을 수 없습니다.',404);
  }catch(error){const safe=safeError(error);reply(res,safe.status,{error:safe.message,code:safe.code});}
  return true;
 };
 handler.close=async()=>{if(closed)return;closed=true;clearInterval(cleanup);for(const record of jobs.values())cancel(record);for(const controller of connections)controller.abort();queue.length=0;await Promise.allSettled([...workers].map(worker=>worker.terminate()));await Promise.allSettled(running);jobs.clear();};
 return handler;
}
module.exports={createQwenAnalysisHandler};
