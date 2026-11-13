const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pathModule=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {load}=require('../analyst-ts-loader.cjs');
const file='lib/analyst/server-customer-picker.ts';
const helper=fs.existsSync(file)?load(file):{};

test('remote customer picker uses only base date/time scope and pages 25 real rows',()=>{
  assert.equal(typeof helper.serverCustomerPickerRequest,'function','server customer picker request exists');
  const scope={dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59',customerIds:['applied'],
    band:'poor',district:'adm:1',evidence:'gnss',cohort:'repeat',hour:9,sipFilter:'drop',search:'map-only'};
  assert.deepEqual(helper.serverCustomerPickerRequest(scope,'00012','repeat',4,['opaque','missing','opaque'],true),{
    scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'},
    query:'00012',filter:'repeat',page:4,pageSize:25,selectedIds:['opaque','missing'],selectedOnly:true,
  });
});

test('remote picker can open the all-customer population without any selected identities',()=>{
  assert.equal(typeof helper.serverCustomerPickerRequest,'function');
  const scope={dateStart:'2026-10-30',dateEnd:'2026-10-30',from:'23:59',to:'23:59'};
  const result=helper.serverCustomerPickerRequest(scope,'','poor',0,[],false);
  assert.deepEqual(result.scope,scope);
  assert.equal(result.filter,'poor');
  assert.deepEqual(result.selectedIds,[]);
  assert.equal(result.selectedOnly,false);
});

test('remote picker gates network on opening and retains cross-page selections without local sums',()=>{
  const path='components/analyst/server-quality-customer-picker.tsx';
  assert.ok(fs.existsSync(path),'server picker component exists');
  const text=fs.readFileSync(path,'utf8');
  assert.match(text,/if\(!opened\)return/);
  assert.match(text,/setTimeout\([\s\S]*?,200\)/);
  assert.match(text,/AbortController/);
  assert.match(text,/voiceQuery<ServerCustomerPickerResult>\('customers'/);
  assert.match(text,/updateQualityCustomerSelection/);
  assert.match(text,/qualityCustomerSelectionIds\(selectedCustomerIds\)/);
  assert.match(text,/onApplyCustomerIds\(draftIds\)/);
  assert.match(text,/selection\?\.withoutCalls/);
  assert.match(text,/row\.sourceContractId/);
  assert.match(text,/singleSelected\.href/);
  assert.doesNotMatch(text,/buildQualityCustomerRows|loadDataset|loadOverview|\.reduce\(/);
});

function pickerComponent(seed={},observe) {
  const componentPath=pathModule.resolve('components/analyst/server-quality-customer-picker.tsx');
  const mod={exports:{}};
  let stateIndex=0;
  const code=ts.transpileModule(fs.readFileSync(componentPath,'utf8'),{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,
  }}).outputText;
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:componentPath})(id=>{
    if(id==='react')return {...React,useState(initial){
      const index=stateIndex++;
      return React.useState(Object.hasOwn(seed,index)?seed[index]:initial);
    }};
    if(id==='react/jsx-runtime'&&observe){
      const runtime=require(id);
      const wrap=create=>(type,props,...rest)=>{observe(type,props);return create(type,props,...rest);};
      return {...runtime,jsx:wrap(runtime.jsx),jsxs:wrap(runtime.jsxs)};
    }
    if(id.endsWith('.module.css'))return {};
    if(id==='./document-link')return {default:({href,children})=>React.createElement('a',{href},children)};
    return id.startsWith('.')?load(pathModule.resolve(pathModule.dirname(componentPath),id)):require(id);
  },mod,mod.exports);
  return mod.exports.ServerQualityCustomerPicker;
}

test('actual native drawer starts closed without customer rows or a bulk-data dependency',()=>{
  const Component=pickerComponent();
  const html=renderToStaticMarkup(React.createElement(Component,{
    scope:{dateStart:'2026-10-30',dateEnd:'2026-10-30',from:'00:00',to:'23:59'},
    sourceRevision:'r1',selectedCustomerIds:['opaque-missing'],onApplyCustomerIds(){},
  }));
  assert.match(html,/<dialog[^>]*aria-labelledby="[^"]+"[^>]*aria-modal="true"/);
  assert.doesNotMatch(html,/<dialog[^>]*\sopen(?:="")?/);
  assert.equal((html.match(/data-customer-id=/g)??[]).length,0);
  assert.match(html,/고객 목록 · 1명/);
  assert.match(html,/선택 고객 1명 적용/);
  assert.doesNotMatch(html,/>opaque-missing</);
});

test('actual paged drawer renders global result and selection counts from the server fixture',()=>{
  const scope={dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'};
  const selectedIds=['opaque-0','opaque-missing'];
  const rows=Array.from({length:25},(_,i)=>({customerId:'opaque-'+i,sourceContractId:'0000'+i,
    totalCalls:2,poorCalls:i===0?1:0,locatedCalls:1,unlocatedCalls:1,
    latestDate:'2026-10-30',latestCall:{start:'23:59:59'},href:'/?customer=opaque-'+i}));
  const request={...helper.serverCustomerPickerRequest(scope,'','all',0,selectedIds,false),sourceRevision:'r1'};
  const key=JSON.stringify([request,0]);
  const listKey=JSON.stringify([scope,'','all',0,false,[],'r1']);
  const data={sourceRevision:'r1',rows,total:101,page:0,pages:5,selection:{customerIds:selectedIds,count:2,
    withoutCalls:1,totalCalls:500,poorCalls:35,locatedCalls:498,unlocatedCalls:2}};
  const Component=pickerComponent({6:true,9:{key,listKey,data}});
  const html=renderToStaticMarkup(React.createElement(Component,{scope,sourceRevision:'r1',
    selectedCustomerIds:selectedIds,onApplyCustomerIds(){}}));
  assert.equal((html.match(/data-customer-id=/g)??[]).length,25);
  assert.match(html,/101명/);
  assert.match(html,/1 \/ 5 페이지/);
  assert.match(html,/<dd>500건<\/dd>/);
  assert.match(html,/<dd>35건<\/dd>/);
  assert.match(html,/1명은 현재 기간·시간에 통화가 없습니다/);
  assert.match(html,/00000/);
  assert.doesNotMatch(html,/>opaque-missing</);
});

test('Escape cancels without changing applied IDs and Apply preserves all draft identities',()=>{
  let dialogProps,applyProps,applied=null,closed=0;
  const ids=['on-another-page','missing-in-window'];
  const Component=pickerComponent({},(type,props)=>{
    if(type==='dialog')dialogProps=props;
    if(type==='button'&&props.children==='선택 고객 2명 적용')applyProps=props;
  });
  renderToStaticMarkup(React.createElement(Component,{
    scope:{dateStart:'2026-10-30',dateEnd:'2026-10-30',from:'00:00',to:'23:59'},sourceRevision:'r1',
    selectedCustomerIds:ids,onApplyCustomerIds(value){applied=value;},
  }));
  dialogProps.ref.current={close(){closed++;}};
  let prevented=0,stopped=0;
  dialogProps.onKeyDownCapture({key:'Escape',preventDefault(){prevented++;},stopPropagation(){stopped++;}});
  assert.equal(closed,1);
  assert.equal(prevented,1);
  assert.equal(stopped,1);
  assert.equal(applied,null);
  applyProps.onClick();
  assert.deepEqual(applied,ids);
  assert.equal(closed,2);
});
