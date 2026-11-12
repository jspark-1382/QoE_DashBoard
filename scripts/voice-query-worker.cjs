const {parentPort,workerData}=require('node:worker_threads');
const {createQueryEngine}=require('./voice-query-engine.cjs');
const engine=createQueryEngine(workerData);
const cache=new Map();let cacheBytes=0,acknowledge;
const MAX_CACHE_BYTES=16*1024*1024,MAX_ENTRY_BYTES=2*1024*1024,MAX_ENTRIES=32;
parentPort.on('message',async message=>{
  if(message.ack){acknowledge?.();acknowledge=null;return;}
  const {id,query,export:exporting}=message;
  try{
    if(exporting){
      for(const chunk of engine.exportCsv(query)){
        const accepted=new Promise(resolve=>{acknowledge=resolve;});parentPort.postMessage({id,chunk});await accepted;
      }
      parentPort.postMessage({id,done:true});return;
    }
    const key=JSON.stringify(query);let result=cache.get(key);
    if(result){cache.delete(key);cache.set(key,result);}else{
      result=JSON.stringify(engine.query(query));const bytes=Buffer.byteLength(result);
      if(bytes<=MAX_ENTRY_BYTES){while(cache.size>=MAX_ENTRIES||cacheBytes+bytes>MAX_CACHE_BYTES){const first=cache.keys().next().value;cacheBytes-=Buffer.byteLength(cache.get(first));cache.delete(first);}cache.set(key,result);cacheBytes+=bytes;}
    }
    parentPort.postMessage({id,result});
  }catch(error){parentPort.postMessage({id,error:error.message,status:error.status??500});}
});
const meta=engine.query({op:'meta'});
if(workerData.sourceRevision&&meta.sourceRevision!==workerData.sourceRevision)throw Error('Query database/index source revision mismatch');
parentPort.postMessage({ready:true});
