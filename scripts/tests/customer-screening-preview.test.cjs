/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {load}=require('../analyst-ts-loader.cjs');
function component(file){
  const mod={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(id=>{
    if(id.endsWith('.module.css'))return {default:new Proxy({},{get:(_,key)=>String(key)})};
    if(!id.startsWith('.'))return require(id);
    const resolved=path.resolve(path.dirname(file),id);
    return fs.existsSync(resolved+'.tsx')?component(resolved+'.tsx'):load(resolved);
  },mod,mod.exports);
  return mod.exports;
}
const {CustomerScreeningPreview}=component('components/analyst/customer-screening-preview.tsx');
const dates=['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];
const row={id:'opaque:customer',number:'00012345',poor:12,eligible:29,drop:2,
  repeatedDays:3,mean:0,mainArea:'개포3동',mainCell:'3470857',dailyPoor:[8,0,3,0,1],
  href:'/contract?customer=opaque%3Acustomer&dateStart=2026-10-26&dateEnd=2026-10-30'};
const render=value=>renderToStaticMarkup(React.createElement(CustomerScreeningPreview,{row:value,dates}));

test('screening preview keeps selected identity, scoped detail link, and exact metrics',()=>{
  const html=render(row);
  assert.match(html,/data-preview-customer="opaque:customer"/);
  assert.match(html,/00012345/);assert.match(html,/개포3동/);assert.match(html,/3470857/);
  assert.match(html,/href="\/qoe\/contract\?customer=opaque%3Acustomer&amp;dateStart=2026-10-26&amp;dateEnd=2026-10-30"/);
  for(const label of ['QoE 평가 통화','Drop 통화','저품질 발생 일수','고객·통화 상세'])assert.ok(html.includes(label));
  assert.match(html,/<dd class="red">0\.00<\/dd>/);
  assert.match(html,/<dd>29<small>건<\/small><\/dd>/);
  assert.match(html,/<dd>2<small>건<\/small><\/dd>/);
  assert.match(html,/<dd>3<small>일<\/small><\/dd>/);
});

test('daily preview preserves all dates and represents zero calls without a positive bar',()=>{
  const html=render(row);
  assert.match(html,/aria-label="2026-10-26 8건, 2026-10-27 0건, 2026-10-28 3건, 2026-10-29 0건, 2026-10-30 1건"/);
  assert.equal((html.match(/class="previewDay"/g)||[]).length,5);
  assert.equal((html.match(/style="height:0%"/g)||[]).length,2);
  assert.match(html,/style="height:100%"/);
  assert.match(html,/style="height:37\.5%"/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});

test('missing QoE and location stay explicit and empty days remain safe',()=>{
  const html=render({...row,mean:null,mainArea:'',mainCell:'',dailyPoor:[],poor:0});
  assert.match(html,/<dd class="red">미평가<\/dd>/);
  assert.equal((html.match(/미확인/g)||[]).length,2);
  assert.equal((html.match(/style="height:0%"/g)||[]).length,5);
  assert.doesNotMatch(html,/NaN|Infinity/);
});
