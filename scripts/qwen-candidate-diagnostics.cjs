/* eslint-disable @typescript-eslint/no-require-imports -- Immutable, bounded server-only snapshots. */
const {createHash}=require('node:crypto');
const SECRET=/(?:authorization|api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|credential|cookie)/i;
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))deepFreeze(v);}return value;};
function redactSnapshot(value,secrets=[]){
 let redacted=false;
 const walk=(v,key='')=>{
  if(SECRET.test(key)){redacted=true;return '[REDACTED]';}
  if(typeof v==='string'){
   let safe=v;
   for(const secret of secrets.filter(s=>typeof s==='string'&&s.length>2))if(safe.includes(secret)){safe=safe.split(secret).join('[REDACTED]');redacted=true;}
   safe=safe.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi,()=>{redacted=true;return 'Bearer [REDACTED]';});
   if(safe.length>2*1024*1024){safe=safe.slice(0,2*1024*1024)+'[TRUNCATED]';redacted=true;}
   return safe;
  }
  if(Array.isArray(v))return v.map(x=>walk(x));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,k)]));
  return v;
 };
 return {value:deepFreeze(walk(structuredClone(value))),redacted};
}
function captureRequest(body,config){
 const {value,redacted}=redactSnapshot(body,[config.apiKey,config.baseUrl]);
 const {messages,model,...parameters}=value;
 const hash=createHash('sha256').update(JSON.stringify(value)).digest('hex');
 return deepFreeze({capturedAt:new Date().toISOString(),model,messages,parameters,redacted,hash});
}
function captureResponse(raw,config){
 let envelope;try{envelope=JSON.parse(raw);}catch{/* Keep invalid envelope before parser failure. */}
 const envelopeSecrets=[];
 const collect=v=>{if(v&&typeof v==='object')for(const [k,item] of Object.entries(v)){if(SECRET.test(k)&&typeof item==='string')envelopeSecrets.push(item);else collect(item);}};collect(envelope);
 const choice=envelope?.choices?.[0],content=typeof choice?.message?.content==='string'?choice.message.content:raw;
 const result=redactSnapshot({receivedAt:new Date().toISOString(),model:typeof envelope?.model==='string'?envelope.model:null,content,finishReason:typeof choice?.finish_reason==='string'?choice.finish_reason:null,usage:envelope?.usage&&typeof envelope.usage==='object'?envelope.usage:null},[config.apiKey,config.baseUrl,...envelopeSecrets]);
 return deepFreeze({...result.value,redacted:result.redacted});
}
function diagnosticsSnapshot(record){
 return {schemaVersion:'candidate-analysis-diagnostics-v1',status:record.diagnostics?.request?'captured':record.diagnostics?.status??'unavailable',...record.diagnostics,transmission:record.evidence?.transmission??[],reused:record.reused===true};
}
module.exports={captureRequest,captureResponse,diagnosticsSnapshot,redactSnapshot};
