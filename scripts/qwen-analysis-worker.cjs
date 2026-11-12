/* eslint-disable @typescript-eslint/no-require-imports -- The local Node preview and workers load this CommonJS module. */
const {parentPort,workerData}=require('node:worker_threads');
const {collectEvidence}=require('./qwen-analysis-evidence.cjs');
try{
 parentPort.postMessage({evidence:collectEvidence(workerData)});
}catch(error){
 const safeCodes=new Set(['INVALID_ANALYSIS_TARGET','STALE_REVISION','EVIDENCE_UNAVAILABLE','NO_CALLS']);
 parentPort.postMessage({error:safeCodes.has(error.code)?{code:error.code,message:error.message,status:error.status}:{code:'EVIDENCE_UNAVAILABLE',message:'분석 근거를 읽지 못했습니다. 음성 자료 상태를 확인해 주세요.',status:503}});
}finally{parentPort.close();}
