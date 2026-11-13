/* eslint-disable @typescript-eslint/no-require-imports -- Local Node worker entry points use CommonJS. */
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const failure=(message,status=503)=>Object.assign(new Error(message),{status});

/** Dispatch one job at a time, so abandoned queued requests never reach SQLite. */
function createQueryLane({workerData,workerPath=path.join(__dirname,'voice-query-worker.cjs'),maxPending=16}){
  const worker=new Worker(workerPath,{workerData});
  const queue=[];let current=null,sequence=0,closed=false,retiring=false,readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  function settle(entry,error,result){
    if(entry.settled)return;
    entry.settled=true;entry.signal?.removeEventListener('abort',entry.abort);
    if(error)entry.reject(error);else entry.resolve(result);
  }
  function pump(){
    if(closed||current)return;
    while(queue.length){
      const entry=queue.shift();if(entry.settled)continue;
      current=entry;worker.postMessage({id:entry.id,query:entry.query});return;
    }
    if(retiring)void close();
  }
  function stopped(error){
    closed=true;readyReject(error);
    if(current)settle(current,error);current=null;
    for(const entry of queue)settle(entry,error);queue.length=0;
  }
  worker.on('message',message=>{
    if(message.ready){readyResolve();return;}
    if(!current||message.id!==current.id)return;
    const entry=current;current=null;
    settle(entry,message.error?failure(message.error,message.status??500):null,message.result);
    pump();
  });
  worker.on('error',error=>stopped(error));
  worker.on('exit',()=>stopped(failure('Voice query worker stopped; retry the request.')));
  async function run(query,signal){
    if(signal?.aborted)throw failure('Query request closed.',499);
    await ready;
    if(closed||retiring)throw failure('Voice query worker is closed.');
    if(signal?.aborted)throw failure('Query request closed.',499);
    if(queue.length+(current?1:0)>=maxPending)throw failure('Voice query queue is busy; retry shortly.',429);
    return new Promise((resolve,reject)=>{
      const entry={id:++sequence,query,signal,resolve,reject,settled:false,abort:null};
      entry.abort=()=>{
        settle(entry,failure('Query request closed.',499));
        const position=queue.indexOf(entry);if(position>=0)queue.splice(position,1);
        pump();
      };
      signal?.addEventListener('abort',entry.abort,{once:true});
      queue.push(entry);pump();
    });
  }
  async function close(){
    if(closed)return;
    stopped(failure('Voice query handler is closed.'));
    await worker.terminate();
  }
  function retire(){retiring=true;pump();}
  return {worker,ready,run,close,retire,get closed(){return closed;}};
}
module.exports={createQueryLane};
