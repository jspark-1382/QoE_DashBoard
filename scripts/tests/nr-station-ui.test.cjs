/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real TSX handlers and loader effects. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {load}=require('../analyst-ts-loader.cjs');
const file=path.resolve('components/analyst/station-catalog.tsx');
const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,
}}).outputText;
const MapStub=()=>null;
function component(hooks,fetcher){
  const mod={exports:{}};
  vm.runInThisContext('(function(require,module,exports,fetch){'+compiled+'\n})',{filename:file})(id=>{
    if(id==='react')return hooks;
    if(id.endsWith('.module.css'))return {};
    if(id==='./analyst-map')return {AnalystMap:MapStub};
    if(id==='./quality-top-nav')return {QualityTopNav:()=>null};
    return id.startsWith('.')?load(path.resolve(path.dirname(file),id)):require(id);
  },mod,mod.exports,fetcher);
  return mod.exports.StationCatalogWorkspace;
}
function catalog(technology,size=2){
  const rows=Array.from({length:size},(_,i)=>[
    technology+'-RU'+String(i).padStart(3,'0'),'000'+i,technology==='NR'?(i?1007:900):i,37+i/10000,127,'valid',
  ]);
  return {schemaVersion:technology==='NR'?'nr-station-catalog-v1':'lte-station-catalog-v1',
    ...(technology==='NR'?{technology:'NR'}:{}),
    source:{file:technology+'.xlsx',sha256:'a'.repeat(64),fileDate:'2026-11-06'},
    summary:{inputRows:size,invalidRows:0,registeredCells:size,withPci:size,missingPci:0,invalidPci:0,conflictingPci:0,distinctPci:new Set(rows.map(r=>r[2])).size},rows};
}
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'
  ?text(node.props?.children):typeof node==='string'||typeof node==='number'?String(node):'';
function harness(){
  const states=[],effects=[],requests=[];
  let stateIndex=0,effectIndex=0,tree;
  const planned=[];
  const hooks={
    useState(initial){const index=stateIndex++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;
      return [states[index],next=>{states[index]=typeof next==='function'?next(states[index]):next;}];},
    useMemo:callback=>callback(),
    useEffect(callback,deps){const index=effectIndex++,old=effects[index];
      if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))planned.push(()=>{
        old?.cleanup?.();effects[index]={deps,cleanup:callback()};
      });},
  };
  const fetcher=(url,options)=>new Promise((resolve,reject)=>requests.push({url,...options,resolve,reject}));
  const Workspace=component(hooks,fetcher);
  const nodes=()=>{
    const found=[];
    const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object'||!node.props)return;
      found.push(node);walk(node.props.children);};walk(tree);return found;
  };
  const render=()=>{stateIndex=0;effectIndex=0;tree=Workspace();while(planned.length)planned.shift()();};
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));render();};
  render();
  return {requests,render,text:()=>text(tree),
    button:name=>nodes().find(node=>node.type==='button'&&(node.props['aria-label']===name||text(node)===name)),
    input:name=>nodes().find(node=>node.type==='input'&&node.props['aria-label']===name),
    map:()=>nodes().find(node=>node.type===MapStub),
    async resolve(index,data){requests[index].resolve({ok:true,json:async()=>data});await settle();},
    async reject(index,error){requests[index].reject(error);await settle();},
    cleanup(){effects.forEach(effect=>effect.cleanup?.());},
  };
}
test('actual station workspace initially offers LTE and NR selection without fetching during SSR',()=>{
  const Workspace=component(React,()=>{throw Error('SSR must not fetch');});
  const html=renderToStaticMarkup(React.createElement(Workspace));
  assert.match(html,/<button[^>]*aria-pressed="true"[^>]*>LTE<\/button>/);
  assert.match(html,/<button[^>]*aria-pressed="false"[^>]*>5G \(NR\)<\/button>/);
  assert.match(html,/기지국 목록을 불러오는 중입니다/);
  assert.doesNotMatch(html,/기지국 선택 LTE-RU/);
});
test('switching RAT clears old filters, page and map selection and supports NR PCI above 503',async()=>{
  const ui=harness();
  try{
    assert.equal(ui.requests[0].url,'/qoe/station-catalog.json');
    await ui.resolve(0,catalog('LTE',53));
    ui.input('RU 또는 Cell 검색').props.onChange({target:{value:'LTE'}});ui.render();
    ui.button('기지국 다음 페이지').props.onClick();ui.render();
    ui.button('기지국 선택 LTE-RU050 00050').props.onClick();ui.render();
    ui.input('PCI 검색').props.onChange({target:{value:'50'}});ui.render();
    ui.button('5G (NR)').props.onClick();ui.render();
    assert.equal(ui.requests[1].url,'/qoe/nr-station-catalog.json');
    assert.equal(ui.map(),undefined,'old LTE map disappears while NR is loading');
    await ui.resolve(1,catalog('NR'));
    assert.equal(ui.input('RU 또는 Cell 검색').props.value,'');
    assert.equal(ui.input('PCI 검색').props.value,'');
    assert.equal(ui.button('기지국 이전 페이지').props.disabled,true);
    assert.equal(ui.map().props.stations[0].technology,'NR');
    assert.equal(ui.map().props.stations[0].baseStationId,'NR-RU000');
    ui.input('PCI 검색').props.onChange({target:{value:'1007'}});ui.render();
    assert.equal(ui.map().props.stations[0].baseStationId,'NR-RU001');
    assert.equal(ui.map().props.stations[0].pci,1007);
    assert.match(ui.text(),/5G 관측 비교/);
    assert.equal(ui.button('기지국 선택 NR-RU000 0000'),undefined);
  }finally{ui.cleanup();}
});
test('an aborted LTE response cannot replace the selected NR catalog',async()=>{
  const ui=harness();
  try{
    ui.button('5G (NR)').props.onClick();ui.render();
    assert.equal(ui.requests[0].signal.aborted,true);
    await ui.resolve(1,catalog('NR'));
    await ui.resolve(0,catalog('LTE'));
    assert.equal(ui.button('5G (NR)').props['aria-pressed'],true);
    assert.equal(ui.map().props.stations[0].technology,'NR');
    assert.equal(ui.map().props.stations[0].inventorySource,'NR.xlsx');
  }finally{ui.cleanup();}
});
test('a response for the wrong RAT is rejected and switching back to LTE recovers',async()=>{
  const ui=harness();
  try{
    ui.button('5G (NR)').props.onClick();ui.render();
    await ui.resolve(1,catalog('LTE'));
    assert.match(ui.text(),/선택한 LTE\/5G와 기지국 자료가 일치하지 않습니다/);
    assert.equal(ui.map(),undefined);
    ui.button('LTE').props.onClick();ui.render();
    await ui.resolve(2,catalog('LTE'));
    assert.equal(ui.map().props.stations[0].technology,'LTE');
    assert.doesNotMatch(ui.text(),/자료가 일치하지 않습니다/);
  }finally{ui.cleanup();}
});
test('NR loading failure allows retry without preventing LTE selection',async()=>{
  const ui=harness();
  try{
    ui.button('5G (NR)').props.onClick();ui.render();
    await ui.reject(1,Error('NR unavailable'));
    assert.match(ui.text(),/NR unavailable/);
    ui.button('다시 불러오기').props.onClick();ui.render();
    assert.equal(ui.requests[2].url,'/qoe/nr-station-catalog.json');
    await ui.resolve(2,catalog('NR'));
    assert.equal(ui.map().props.stations[0].technology,'NR');
    ui.button('LTE').props.onClick();ui.render();
    await ui.resolve(3,catalog('LTE'));
    assert.equal(ui.map().props.stations[0].technology,'LTE');
  }finally{ui.cleanup();}
});
