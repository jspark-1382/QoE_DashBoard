/* eslint-disable @typescript-eslint/no-require-imports -- Execute the actual UI and draft hook with controlled React lifecycle/fetch boundaries. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {load}=require('../analyst-ts-loader.cjs');
const {fixture}=require('./fixtures/candidate-targeted-ui.cjs');
function component(file,overrides={}){
 const mod={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8').split('import.meta').join('({env:{}})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(id=>{
  if(overrides[id])return overrides[id];
  if(id.endsWith('.css'))return{default:new Proxy({},{get:(_,key)=>String(key)})};
  if(!id.startsWith('.'))return require(id);
  const p=path.resolve(path.dirname(file),id);
  return fs.existsSync(p+'.tsx')?component(p+'.tsx',overrides):load(p);
 },mod,mod.exports);
 return mod.exports;
}
const editorFile='components/analyst/candidate-prompt-editor.tsx';
const analysisFile='components/analyst/candidate-ai-analysis.tsx';
const libraryId='../../lib/analyst/candidate-ai-analysis';
const originalLib=()=>load(path.resolve('lib/analyst/candidate-ai-analysis.ts'));
const draft={system:'System original\nkeep exact',user:'{"candidate":"original"}\n'};
const editorState=(overrides={})=>({draft:{...draft},loading:false,error:'',storageError:false,dirty:false,source:'이전 실제 전송본',update(){},restoreDefault(){},retry(){},markSent(){},...overrides});
const fakeReact={...React,useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useRef:initial=>({current:initial}),useId:()=> 'test',useEffect(){},useCallback:fn=>fn};
function children(element){
 if(!element||typeof element!=='object')return[];
 return [element,...React.Children.toArray(element.props?.children).flatMap(children)];
}
function textOf(element){return React.Children.toArray(element.props?.children).map(c=>typeof c==='string'?c:typeof c==='object'?textOf(c):'').join('');}

test('header surrounds analysis status with edit and send in all supported states',()=>{
 for(const status of ['completed','failed','idle']){
  const entry=fixture();if(status==='idle')delete entry.job;else entry.job.status=status;
  const {CandidateAiDialog}=component(analysisFile,{'./candidate-prompt-editor':{useCandidatePromptDraft:()=>editorState(),CandidatePromptEditor:()=>null}});
  const html=renderToStaticMarkup(React.createElement(CandidateAiDialog,{target:entry.target,title:'후보',entry,onClose(){},onStart(){},onCancel(){},onSendPrompt(){}}));
  const edit=html.indexOf('>프롬프트 수정</button>'),state=html.indexOf('class="workspaceJobStatus"'),send=html.indexOf('>전송</button>');
  assert(edit>0&&state>edit&&send>state,'Required edit → status → send order');
  assert.doesNotMatch(html,/<button[^>]*disabled[^>]*>프롬프트 수정/);
 }
});

test('send takes the latest draft exactly and bypasses the normal analysis callback',()=>{
 const entry=fixture(),sent=[],normal=[],marked=[];
 const changed={system:'  Changed system\n한국어  ',user:'Plain test request\n{"evidence":"edited"}\n'};
 const editor=editorState({draft:changed,dirty:true,markSent:()=>marked.push(true)});
 const {CandidateAiDialog}=component(analysisFile,{react:fakeReact,'./candidate-prompt-editor':{useCandidatePromptDraft:()=>editor,CandidatePromptEditor:()=>null}});
 const tree=CandidateAiDialog({target:entry.target,title:'후보',entry,onClose(){},onStart:()=>normal.push(true),onCancel(){},onSendPrompt:value=>sent.push(value)});
 const send=children(tree).find(node=>node.type==='button'&&textOf(node)==='전송');
 assert.equal(send.props.disabled,false);send.props.onClick();
 assert.deepEqual(sent,[changed]);assert.notEqual(sent[0],changed);assert.equal(normal.length,0);assert.equal(marked.length,1);
});

test('send is disabled while busy/loading or either prompt is blank',()=>{
 for(const [busy,state]of [[false,{loading:true}],[false,{draft:{system:' ',user:'ready'}}],[false,{draft:{system:'ready',user:'\n'}}],[true,{}]]){
  const entry=fixture();if(busy){entry.job.status='analyzing';entry.pending=true;}
  const {CandidateAiDialog}=component(analysisFile,{react:fakeReact,'./candidate-prompt-editor':{useCandidatePromptDraft:()=>editorState(state),CandidatePromptEditor:()=>null}});
  const tree=CandidateAiDialog({target:entry.target,title:'후보',entry,onClose(){},onStart(){},onCancel(){},onSendPrompt(){}});
  assert.equal(children(tree).find(node=>node.type==='button'&&textOf(node)==='전송').props.disabled,true);
 }
});

test('hook custom send starts an explicit rerun with a copied prompt override',()=>{
 const calls=[];
 const manager={start:(...args)=>calls.push(args)};
 const {useCandidateAiAnalysis}=component(analysisFile,{react:fakeReact,[libraryId]:{...originalLib(),createCandidateAnalysisManager:()=>manager}});
 const hook=useCandidateAiAnalysis(),target=fixture().target;
 hook.sendPrompt(target,draft);
 assert.deepEqual(calls,[[target,{rerun:true,promptOverride:draft}]]);
 assert.notEqual(calls[0][1].promptOverride,draft);
});

function hookHarness(library){
 const cells=[],pending=[];let cursor=0,changed=false,args,value;
 const same=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((item,i)=>Object.is(item,b[i]));
 const react={...React,
  useState(initial){const i=cursor++;if(!cells[i])cells[i]={value:typeof initial==='function'?initial():initial};return[cells[i].value,next=>{cells[i].value=typeof next==='function'?next(cells[i].value):next;changed=true;}];},
  useRef(initial){const i=cursor++;return cells[i]??(cells[i]={current:initial});},
  useCallback(fn,deps){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps))cells[i]={value:fn,deps};return cells[i].value;},
  useEffect(fn,deps){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps)){const prior=cells[i];cells[i]={deps,cleanup:prior?.cleanup};pending.push(()=>{prior?.cleanup?.();cells[i].cleanup=fn();});}},
 };
 const hook=component(editorFile,{react,[libraryId]:{...originalLib(),...library}}).useCandidatePromptDraft;
 function render(){cursor=0;changed=false;value=hook(...args);}
 return {
  mount(...next){args=next;render();return this;},
  async settle(){for(let i=0;i<20;i++){while(pending.length)pending.shift()();await new Promise(resolve=>setImmediate(resolve));if(!changed&&!pending.length)break;render();}return value;},
  get value(){if(changed)render();return value;},
  unmount(){for(const cell of cells)cell?.cleanup?.();},
 };
}
function storage(){const items=new Map();return{getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,value),items};}

test('draft edits survive close/reopen and are isolated from another candidate scope',async()=>{
 const prior=global.sessionStorage;global.sessionStorage=storage();
 const target=fixture().target,calls=[];
 const lib={fetchCandidatePromptDraft:async value=>{calls.push(value);return{target:value,...draft,fingerprint:'fp'};}};
 let h;
 try{
  h=hookHarness(lib).mount(target);await h.settle();assert.deepEqual(h.value.draft,draft);
  h.value.update('system','unsent System\n');h.value.update('user','unsent User\n');await h.settle();
  assert.equal(h.value.dirty,true);h.unmount();
  h=hookHarness(lib).mount(structuredClone(target));await h.settle();
  assert.deepEqual(h.value.draft,{system:'unsent System\n',user:'unsent User\n'});assert.equal(h.value.dirty,true);assert.equal(calls.length,1);
  const other={...target,scope:{...target.scope,dateEnd:'2026-12-01'}};h.mount(other);await h.settle();
  assert.deepEqual(h.value.draft,draft);assert.equal(calls.length,2);assert.equal(h.value.dirty,false);
 }finally{h?.unmount();global.sessionStorage=prior;}
});

test('captured first System/User seeds edits without appending hidden correction instructions',async()=>{
 const prior=global.sessionStorage;global.sessionStorage=storage();let prepared=0;
 const entry=fixture();
 const h=hookHarness({fetchCandidateAnalysisDiagnostics:async()=>({request:{messages:[{role:'system',content:'actual System'},{role:'user',content:'actual original User'},{role:'user',content:'hidden repair User'}]},status:'captured'}),fetchCandidatePromptDraft:async()=>{prepared++;return draft;}}).mount(entry.target,entry.job);
 try{await h.settle();assert.deepEqual(h.value.draft,{system:'actual System',user:'actual original User'});assert.equal(prepared,0);assert.equal(h.value.source,'이전 실제 전송본');}
 finally{h.unmount();global.sessionStorage=prior;}
});

test('restore obtains the current server default without sending inference and keeps an unsent notice',async()=>{
 const prior=global.sessionStorage;global.sessionStorage=storage();let prepares=0;
 const entry=fixture();
 const h=hookHarness({fetchCandidateAnalysisDiagnostics:async()=>({request:{messages:[{role:'system',content:'previous system'},{role:'user',content:'previous user'}]},status:'captured'}),fetchCandidatePromptDraft:async()=>{prepares++;return{...draft,fingerprint:'new'};}}).mount(entry.target,entry.job);
 try{await h.settle();h.value.update('user','test');await h.settle();h.value.restoreDefault();await h.settle();assert.equal(prepares,1);assert.deepEqual(h.value.draft,draft);assert.equal(h.value.dirty,true);h.value.markSent();await h.settle();assert.equal(h.value.dirty,false);}
 finally{h.unmount();global.sessionStorage=prior;}
});

test('late preparation cannot overwrite a new candidate draft',async()=>{
 const prior=global.sessionStorage;global.sessionStorage=storage();let release;
 const first=fixture().target,other={...first,candidateId:'another-candidate'};
 const h=hookHarness({fetchCandidatePromptDraft:async target=>target.candidateId===first.candidateId?new Promise(resolve=>{release=resolve;}):{system:'other System',user:'other User',fingerprint:'other'}}).mount(first);
 try{await h.settle();h.mount(other);await h.settle();h.value.update('user','other unsent');await h.settle();release({...draft,fingerprint:'late'});await h.settle();assert.deepEqual(h.value.draft,{system:'other System',user:'other unsent'});assert.equal(h.value.dirty,true);}
 finally{h.unmount();global.sessionStorage=prior;}
});

test('prompt workspace labels editable fields, unsent changes, and a raw response test panel',()=>{
 const {CandidatePromptEditor}=component(editorFile);
 const html=renderToStaticMarkup(React.createElement(CandidatePromptEditor,{editor:editorState({dirty:true}),busy:false,id:'editor'}));
 assert.match(html,/System · 분석 지시/);assert.match(html,/User · 분석 요청·자료/);
 assert.match(html,/aria-label="system 프롬프트 수정"/);assert.match(html,/aria-label="user 프롬프트 수정"/);
 assert.match(html,/미전송 수정사항/);assert.match(html,/기본값 복원/);assert.match(html,/aria-label="프롬프트 테스트 응답"/);
});

test('failed freeform response remains readable with validation failure and is not presented as a report',()=>{
 const {CandidatePromptTestResponse}=component(editorFile,{react:{...fakeReact,useState:initial=>{
  if(initial===null)return[{id:'custom-run',value:{schemaVersion:'candidate-analysis-diagnostics-v1',status:'captured',transmission:[],reused:false,response:{receivedAt:'2026-11-13T00:00:00Z',model:'Qwen',content:'Plain response marker: CUSTOM_EDIT_OK',finishReason:'stop',usage:null},validation:{status:'failed',code:'INVALID_JSON',message:'응답이 보고서 JSON 형식이 아닙니다.'}}},()=>{}];
  return[initial,()=>{}];
 }}});
 const html=renderToStaticMarkup(React.createElement(CandidatePromptTestResponse,{job:{id:'custom-run',status:'failed',promptEdited:true,error:{message:'형식 검증 실패'}}}));
 assert.match(html,/응답 수신 · 분석 보고서에는 미적용/);assert.match(html,/검증 실패/);assert.match(html,/CUSTOM_EDIT_OK/);
 assert.match(html,/모델 실제 응답 원문/);assert.doesNotMatch(html,/data-cause-category=|data-pot-stage=|최근 결과/);
});
