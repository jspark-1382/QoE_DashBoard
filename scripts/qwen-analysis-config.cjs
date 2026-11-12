/* eslint-disable @typescript-eslint/no-require-imports -- The local Node preview and workers load this CommonJS module. */
/* Server-only Qwen settings. Never import this module from a client component. */
const fs=require('node:fs');
const path=require('node:path');
const {parseEnv}=require('node:util');

function analysisError(code,message,status=502){const error=new Error(message);error.code=code;error.status=status;return error;}
const invalid=()=>analysisError('QWEN_CONFIG_INVALID','Qwen .env 설정 형식이 올바르지 않습니다. 설정 문서의 URL·모델·숫자 범위·추가 옵션을 확인해 주세요.',503);
function numeric(env,name,fallback,min,max,integer=false){
 const raw=env[name];if(raw==null||String(raw).trim()==='')return fallback;
 const value=Number(raw);if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw invalid();return value;
}
function extrasFrom(raw){
 if(!raw?.trim())return {};
 if(raw.length>8192)throw invalid();
 let extra;try{extra=JSON.parse(raw);}catch{throw invalid();}
 if(!extra||typeof extra!=='object'||Array.isArray(extra))throw invalid();
 const allowed=new Set(['chat_template_kwargs','reasoning_effort','top_p','top_k','min_p','repetition_penalty','presence_penalty','frequency_penalty','seed']);
 for(const [key,value] of Object.entries(extra)){
  if(!allowed.has(key))throw invalid();
  if(key==='chat_template_kwargs'){
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['enable_thinking','thinking_budget'].includes(k)))throw invalid();
   if(value.enable_thinking!==undefined&&typeof value.enable_thinking!=='boolean')throw invalid();
   if(value.thinking_budget!==undefined&&(!Number.isInteger(value.thinking_budget)||value.thinking_budget<0||value.thinking_budget>32768))throw invalid();
  }else if(key==='reasoning_effort'){
   if(!['none','minimal','low','medium','high'].includes(value))throw invalid();
  }else{
   if(typeof value!=='number'||!Number.isFinite(value))throw invalid();
   if(['top_p','min_p'].includes(key)&&(value<0||value>1))throw invalid();
   if(key==='top_k'&&(!Number.isInteger(value)||value<0||value>1000))throw invalid();
   if(key==='seed'&&(!Number.isSafeInteger(value)||Math.abs(value)>2147483647))throw invalid();
   if(['presence_penalty','frequency_penalty'].includes(key)&&(value < -2||value>2))throw invalid();
   if(key==='repetition_penalty'&&(value<=0||value>3))throw invalid();
  }
 }
 return extra;
}
function loadQwenConfig(root,processValues=process.env){
 const env={};
 for(const name of ['.env','.env.local']){
  let text;try{text=fs.readFileSync(path.join(root,name),'utf8');}catch(error){if(error.code==='ENOENT')continue;throw invalid();}
  let parsed;try{parsed=parseEnv(text);}catch{throw invalid();}
  for(const [key,value] of Object.entries(parsed))if(key.startsWith('QWEN_'))env[key]=value;
 }
 for(const [key,value] of Object.entries(processValues))if(key.startsWith('QWEN_')&&value!==undefined)env[key]=String(value);
 let baseUrl=(env.QWEN_BASE_URL??'').trim().replace(/\/+$/,'');
 if(baseUrl){
  let url;try{url=new URL(baseUrl);}catch{throw invalid();}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1'))throw invalid();
  baseUrl=url.href.replace(/\/+$/,'');
 }
 const model=(env.QWEN_MODEL??'').trim(),apiKey=(env.QWEN_API_KEY??'').trim();
 // eslint-disable-next-line no-control-regex -- Reject control characters in model identifiers and HTTP authentication values.
 if(model.length>200||/[\x00-\x1f\x7f]/.test(model)||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey))throw invalid();
 const json=(env.QWEN_JSON_MODE??'false').trim().toLowerCase();if(!['true','false'].includes(json))throw invalid();
 const config={baseUrl,model,apiKey,
  timeoutMs:numeric(env,'QWEN_TIMEOUT_MS',180000,1000,600000,true),
  maxTokens:numeric(env,'QWEN_MAX_TOKENS',4096,128,32768,true),
  temperature:numeric(env,'QWEN_TEMPERATURE',0.2,0,2),
  jsonMode:json==='true',extraBody:extrasFrom(env.QWEN_EXTRA_BODY_JSON)};
 config.missing=[...(!baseUrl?['QWEN_BASE_URL']:[]),...(!model?['QWEN_MODEL']:[])];return config;
}
function publicConfig(config){return {configured:config.missing.length===0,model:config.model,missing:[...config.missing]};}
function requireConfigured(config){if(config.missing.length)throw analysisError('QWEN_NOT_CONFIGURED','프로젝트 .env에 QWEN_BASE_URL과 QWEN_MODEL을 입력해 주세요.',503);}
module.exports={loadQwenConfig,publicConfig,requireConfigured,analysisError};
