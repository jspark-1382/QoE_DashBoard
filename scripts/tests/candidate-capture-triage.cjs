/* eslint-disable no-console, @typescript-eslint/no-require-imports -- Read-only validation of captured audit responses; never invokes Qwen. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {numericTokens}=require('../qwen-analysis-client.cjs');
const clientFile=path.resolve(__dirname,'../qwen-candidate-client.cjs');

// Preserve the actual validator while attaching the exact failing source line.
// The instrumented copy is isolated from the live batch's required module.
function instrumentedValidator(){
 const source=fs.readFileSync(clientFile,'utf8').split('\n').map((line,index)=>line.replace(/throw (invalid(?:Sop)?)\(\)/g,(_match,name)=>'throw Object.assign('+name+'(),{validationLine:'+(index+1)+'})')).join('\n');
 const mod={exports:{}};
 vm.runInThisContext('(function(require,module,exports){'+source+'\n})',{filename:clientFile})(createRequire(clientFile),mod,mod.exports);
 return mod.exports.validateCandidateReport;
}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function reportIssues(report,evidence){
 const issues=[],facts=new Set((evidence.modelInput.facts??evidence.facts).map(row=>row.id));
 const targets=new Map(evidence.analysisTargets.map(row=>[row.id,row]));
 const modelTargets=new Set((evidence.modelInput.analysisTargets??[]).map(row=>row.id));
 const templates=new Map(evidence.sop.templates.map(row=>[row.id,row]));
 const add=(field,problem,value)=>issues.push({field,problem,...(value!==undefined?{value}:{})});
 const keys=(value,required,field)=>{
  if(!object(value)){add(field,'expected object',value);return false;}
  const missing=required.filter(key=>!Object.hasOwn(value,key)),extra=Object.keys(value).filter(key=>!required.includes(key));
  if(missing.length)add(field,'missing keys',missing);if(extra.length)add(field,'extra keys',extra);return true;
 };
 const text=(value,max,field)=>{if(typeof value!=='string'||!value.trim())add(field,'expected nonempty text',value);else if(value.length>max)add(field,'text exceeds '+max+' characters',value.length);};
 const array=(value,min,max,field)=>{if(!Array.isArray(value)){add(field,'expected array',value);return [];}if(value.length<min||value.length>max)add(field,'array length outside '+min+'..'+max,value.length);return value;};
 const refs=(value,field)=>{const rows=array(value,1,12,field);for(const id of rows)if(!facts.has(id))add(field,'unknown or unsent evidence ID',id);if(new Set(rows).size!==rows.length)add(field,'duplicate evidence IDs',rows);};
 if(!keys(report,['summary','observations','hypotheses','checks','limitations','sop'],'$'))return issues;
 if(keys(report.summary,['observed','priority','missing'],'summary'))for(const field of ['observed','priority','missing'])text(report.summary[field],180,'summary.'+field);
 for(const [i,row] of array(report.observations,1,8,'observations').entries())if(keys(row,['text','evidenceIds'],'observations['+i+']')){text(row.text,500,'observations['+i+'].text');refs(row.evidenceIds,'observations['+i+'].evidenceIds');}
 for(const [i,row] of array(report.hypotheses,0,3,'hypotheses').entries()){
  const field='hypotheses['+i+']';
  if(!keys(row,['category','title','assessment','reason','supportingEvidenceIds','missingEvidence','sopIds','targetIds'],field))continue;
  for(const [key,max] of [['title',160],['reason',800],['missingEvidence',500]])text(row[key],max,field+'.'+key);
  if(!['capacity','interference','coverage','mobility','equipment'].includes(row.category))add(field+'.category','unknown category',row.category);
  if(!['supported','possible','insufficient'].includes(row.assessment))add(field+'.assessment','unknown assessment',row.assessment);
  refs(row.supportingEvidenceIds,field+'.supportingEvidenceIds');
  const selected=array(row.targetIds,1,5,field+'.targetIds');
  if(new Set(selected).size!==selected.length)add(field+'.targetIds','duplicate target IDs',selected);
  for(const id of selected)if(!targets.has(id)||!modelTargets.has(id))add(field+'.targetIds','unknown or unsent target ID',id);
  const linked=selected.map(id=>targets.get(id)).filter(Boolean);
  if(Array.isArray(row.supportingEvidenceIds)){
   for(const id of row.supportingEvidenceIds)if(!linked.some(target=>target.evidenceIds.includes(id)))add(field+'.supportingEvidenceIds','reference belongs to none of the selected targets',id);
   for(const target of linked)if(!target.evidenceIds.some(id=>row.supportingEvidenceIds.includes(id)))add(field+'.supportingEvidenceIds','selected target lacks supporting evidence',{targetId:target.id,expectedAny:target.evidenceIds});
  }
  const selectedSops=array(row.sopIds,1,5,field+'.sopIds');
  for(const id of selectedSops){if(!templates.has(id))add(field+'.sopIds','unknown SOP',id);else if(templates.get(id).causeCategory&&templates.get(id).causeCategory!==row.category)add(field+'.sopIds','SOP category mismatch',id);}
  for(const target of linked)if(!target.sopIds.some(id=>selectedSops.includes(id)))add(field+'.sopIds','selected target has no linked SOP',{targetId:target.id,expectedAny:target.sopIds});
 }
 for(const [i,row] of array(report.checks,1,6,'checks').entries())if(keys(row,['action','reason','evidenceIds'],'checks['+i+']')){text(row.action,240,'checks['+i+'].action');text(row.reason,500,'checks['+i+'].reason');refs(row.evidenceIds,'checks['+i+'].evidenceIds');}
 for(const [i,row] of array(report.limitations,1,8,'limitations').entries())text(row,500,'limitations['+i+']');
 const expectedSops=new Set((Array.isArray(report.hypotheses)?report.hypotheses:[]).flatMap(row=>Array.isArray(row?.sopIds)?row.sopIds:[]));
 const actualSops=array(report.sop,expectedSops.size,expectedSops.size,'sop');
 for(const [i,row] of actualSops.entries())if(keys(row,['sopId','reason','evidenceIds'],'sop['+i+']')){if(!expectedSops.has(row.sopId))add('sop['+i+'].sopId','SOP is not linked by a hypothesis',row.sopId);text(row.reason,500,'sop['+i+'].reason');refs(row.evidenceIds,'sop['+i+'].evidenceIds');}
 for(const id of expectedSops)if(!actualSops.some(row=>row?.sopId===id))add('sop','missing hypothesis-linked SOP',id);
 const identifiers=new Set([...facts,...templates.keys(),...targets.keys(),...(evidence.modelInput.observationGroups??[]).map(row=>row.id)]);
 for(const row of evidence.modelInput.byCell??[])if(typeof row.cell==='string'){identifiers.add(row.cell);if(row.cell.startsWith('대표 Cell '))identifiers.add(row.cell.slice(3));}
 const allowed=new Set(numericTokens(evidence.modelInput,identifiers)),unknown=[...new Set(numericTokens(report,identifiers).filter(value=>!Number.isFinite(Number(value))||!allowed.has(value)))];
 if(unknown.length)add('$','unsupported numeric tokens',unknown);
 return issues;
}

function triageCapture(job,diagnostics){
 const validate=instrumentedValidator(),attempts=diagnostics.attempts?.length?diagnostics.attempts:[{attempt:job.attempt?.attempt??1,request:diagnostics.request,response:diagnostics.response,validation:diagnostics.validation}];
 return attempts.map(attempt=>{
  const result={attempt:attempt.attempt,capturedValidation:attempt.validation};
  try{
   const user=attempt.request?.messages?.find(row=>row.role==='user')?.content;
   if(typeof user!=='string')return {...result,status:'not-captured'};
   const modelInput=JSON.parse(user),evidence={...job.evidence,modelInput};
   let raw=attempt.response?.content;if(typeof raw!=='string')return {...result,status:'no-response'};
   raw=raw.trim();const fence=raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);if(fence)raw=fence[1];
   let report;try{report=JSON.parse(raw);}catch{return {...result,status:'invalid-json',excerpt:raw.slice(0,300)};}
   result.issues=reportIssues(report,evidence);
   try{
    let referenceResolution;validate(report,evidence,{onReferenceResolution:value=>{referenceResolution=value;}});
    return {...result,status:'passed',...(referenceResolution?{referenceResolution,sourceGraphNotes:result.issues,issues:[]}:{})};
   }catch(error){return {...result,status:'failed',code:error.code,message:error.message,validationLine:error.validationLine,repair:error.repair,stack:error.stack?.split('\n').slice(0,5)};}
  }catch(error){return {...result,status:'triage-error',message:error.message};}
 });
}

function triageDirectory(directory){
 return fs.readdirSync(directory).filter(file=>/^candidate-\d+-job\.json$/.test(file)).map(file=>{
  const stem=file.slice(0,-9),job=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')),diagnostics=JSON.parse(fs.readFileSync(path.join(directory,stem+'-diagnostics.json'),'utf8'));
  return {number:Number(file.match(/candidate-(\d+)/)[1]),jobStatus:job.status,error:job.error,attempts:triageCapture(job,diagnostics)};
 }).sort((a,b)=>a.number-b.number);
}
if(require.main===module){const directory=path.resolve(process.argv[2]??'outputs/candidate-full-audit');console.log(JSON.stringify({generatedAt:new Date().toISOString(),directory,rows:triageDirectory(directory)},null,2));}
module.exports={triageCapture,triageDirectory,reportIssues};
