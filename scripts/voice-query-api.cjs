/* eslint-disable @typescript-eslint/no-require-imports -- The local Node preview and workers load this CommonJS module. */
const fs=require('node:fs');
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const {createQueryLane}=require('./voice-query-lane.cjs');
const PREFIX='/qoe/api/voice/';
function httpError(message,status){const error=new Error(message);error.status=status;return error;}
function createVoiceQueryHandler({root,publicDir=path.join(root,'public'),workerPath}){
  let closed=false,exports=0;
  const active=new Map(),starting=new Map();
  const workers=new Set();
  const reply=(res,status,body)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(typeof body==='string'?body:JSON.stringify(body));};
  async function sourceIndex(){
    let index;try{index=JSON.parse(await fs.promises.readFile(path.join(publicDir,'voice-query-index.json'),'utf8'));}catch{throw httpError('음성 조회 자료가 없습니다. 데이터 새로 고침을 실행해 주세요. (voice-query-index missing)',503);}
    if(index.schemaVersion!=='voice-query-index-v1'||index.databaseSchema!=='voice-query-db-v1'||typeof index.sourceRevision!=='string'||typeof index.database!=='string'||path.isAbsolute(index.database))throw httpError('Invalid voice query index. Rebuild the voice query data.',503);
    const database=path.resolve(root,index.database),allowed=path.resolve(root,'outputs','voice-query-data');
    if(!database.startsWith(allowed+path.sep)||path.extname(database)!=='.sqlite')throw httpError('Invalid voice query database path.',503);
    let real;try{real=await fs.promises.realpath(database);}catch{throw httpError('Voice query database is missing. Rebuild the voice query data.',503);}
    const realAllowed=await fs.promises.realpath(allowed);if(!real.startsWith(realAllowed+path.sep))throw httpError('Invalid voice query database location.',503);
    // The immutable index must still match the live published source. Read only
    // the source header, never parse or load the 274 MB customer catalog.
    const file=await fs.promises.open(path.join(publicDir,'voice-1030.json'),'r');let header;
    try{const buffer=Buffer.alloc(128*1024);const {bytesRead}=await file.read(buffer,0,buffer.length,0);header=buffer.toString('utf8',0,bytesRead);}finally{await file.close();}
    const revision=header.match(/"revision"\s*:\s*"([^"\\]+)"/);if(revision?.[1]!==index.sourceRevision)throw httpError('Source revision changed. Rebuild voice query data before opening this view.',409);
    return {...index,dbPath:real};
  }
  async function getWorker(channel){
    if(closed)throw httpError('Voice query handler is closed',503);
    const index=await sourceIndex(),previous=active.get(channel);
    if(previous?.index.dbPath===index.dbPath&&!previous.lane.closed){await previous.lane.ready;return previous;}
    if(starting.has(channel)){await starting.get(channel);return getWorker(channel);}
    const launching=(async()=>{
      const lane=createQueryLane({workerData:{root,publicDir,dbPath:index.dbPath,sourceRevision:index.sourceRevision},workerPath});
      workers.add(lane.worker);lane.worker.once('exit',()=>workers.delete(lane.worker));
      try{await lane.ready;}catch(error){await lane.close();throw error;}
      if(closed){await lane.close();throw httpError('Voice query handler is closed',503);}
      const old=active.get(channel),slot={lane,index};active.set(channel,slot);old?.lane.retire();return slot;
    })();
    starting.set(channel,launching);
    try{return await launching;}finally{starting.delete(channel);}
  }
  async function readBody(req){
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>512*1024)throw httpError('Query request is too large.',413);chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
  }
  async function execute(query,res){
    const channel=['screening','screening-map','routes','customer-qoe-timeline'].includes(query.op)?'screening':'interactive';
    const controller=new AbortController(),cancel=()=>controller.abort();
    res.once('close',cancel);
    try{
      const slot=await getWorker(channel);
      if(res.destroyed)controller.abort();
      if(query.sourceRevision!=null&&query.sourceRevision!==slot.index.sourceRevision)throw httpError('Source revision mismatch; reload the dataset.',409);
      return await slot.lane.run(query,controller.signal);
    }finally{res.off('close',cancel);}
  }
  async function streamExport(req,res,query){
    const index=await sourceIndex();if(exports>=1)throw httpError('Another export is running. Retry shortly.',429);
    if(query?.sourceRevision!==index.sourceRevision)throw httpError('Source revision mismatch; reload before export.',409);
    exports++;const worker=new Worker(path.join(__dirname,'voice-query-worker.cjs'),{workerData:{root,publicDir,dbPath:index.dbPath,sourceRevision:index.sourceRevision}});workers.add(worker);
    await new Promise((resolve,reject)=>{
      let ended=false;
      const finish=error=>{if(ended)return;ended=true;workers.delete(worker);exports--;void worker.terminate();req.off('aborted',abort);res.off('close',abort);if(error){if(res.headersSent){res.destroy(error);resolve();}else reject(error);}else {res.end();resolve();}};
      const abort=()=>finish();req.once('aborted',abort);res.once('close',abort);
      worker.once('error',finish);worker.once('exit',code=>{if(!ended)finish(httpError('Voice export worker stopped ('+code+')',503));});
      worker.on('message',message=>{if(message.ready){worker.postMessage({id:1,query,export:true});return;}if(message.error){finish(httpError(message.error,message.status));return;}if(message.done){finish();return;}if(message.chunk!=null){if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="voice-calls.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(res.write(message.chunk))worker.postMessage({ack:true});else res.once('drain',()=>worker.postMessage({ack:true}));}});
    });
  }
  const handler=async(req,res,pathname=(req.url??'/').split('?')[0])=>{
    if(!pathname.startsWith(PREFIX))return false;
    try{
      if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{throw httpError('Invalid request origin',403);}if(origin.host!==req.headers.host||!['http:','https:'].includes(origin.protocol))throw httpError('Cross-origin voice queries are not allowed.',403);}
      if(pathname===PREFIX+'meta'){
        if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');throw httpError('Method not allowed',405);}
        const result=await execute({op:'meta'},res);if(req.method==='HEAD'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end();}else reply(res,200,result);
      }else if(pathname===PREFIX+'query'||pathname===PREFIX+'export'){
        if(req.method!=='POST'){res.setHeader('Allow','POST');throw httpError('Method not allowed',405);}
        const exporting=pathname===PREFIX+'export',type=String(req.headers['content-type']??'').split(';')[0].trim().toLowerCase();
        if(type!==(exporting?'application/x-www-form-urlencoded':'application/json'))throw httpError('Unsupported query content type',415);
        const body=await readBody(req);let query;try{query=JSON.parse(exporting?new URLSearchParams(body).get('query'):body);}catch{throw httpError('Invalid query JSON',400);}
        if(!query||typeof query!=='object'||Array.isArray(query))throw httpError('Invalid query object',400);
        if(exporting)await streamExport(req,res,query);else reply(res,200,await execute(query,res));
      }else throw httpError('Unknown voice API endpoint',404);
    }catch(error){reply(res,error.status??500,{error:error.status?error.message:'Voice query failed. Rebuild the query data or retry.',code:error.status===409?'STALE_REVISION':'VOICE_QUERY_ERROR'});if(!error.status)console.error('[voice-query]',error);}
    return true;
  };
  handler.close=async()=>{closed=true;await Promise.all([...active.values()].map(slot=>slot.lane.close()));await Promise.all([...workers].map(w=>w.terminate()));active.clear();};
  return handler;
}
module.exports={createVoiceQueryHandler};
