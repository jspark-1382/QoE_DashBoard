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
const scope={dateStart:dates[0],dateEnd:dates.at(-1),from:'00:00',to:'23:59'};
const sourceRevision='preview-fixture-revision';
const row={id:'opaque:customer',number:'00012345',total:40,poor:12,eligible:29,drop:2,
  repeatedDays:3,mean:0,mainArea:'개포3동',mainCell:'3470857',dailyTotal:[20,0,12,0,8],dailyPoor:[8,0,3,0,1],
  href:'/contract?customer=opaque%3Acustomer&dateStart=2026-10-26&dateEnd=2026-10-30'};
const render=value=>renderToStaticMarkup(React.createElement(CustomerScreeningPreview,{row:value,dates,scope,sourceRevision}));

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

test('daily preview stacks each poor subset inside the exact total and preserves zero-call days',()=>{
  const html=render(row);
  assert.match(html,/일별 전체 · 저품질 통화 수/);
  assert.match(html,/2026-10-26 전체 20건, 저품질 8건/);
  assert.match(html,/2026-10-27 전체 0건, 저품질 0건/);
  assert.match(html,/숫자 = 저품질\/총통화/);
  assert.match(html,/그 외 통화/);
  assert.match(html,/QoE 미평가 통화가 포함/);
  const stacks=[...html.matchAll(/<g data-day="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)];
  assert.equal(stacks.length,5);
  const heights=stacks.map(([,date,content])=>[date,...[...content.matchAll(/<rect[^>]*height="([\d.]+)"/g)].map(match=>Number(match[1]))]);
  assert.deepEqual(heights.map(([date,...values])=>[date,values.length]),dates.map(date=>[date,2]));
  const unit=(heights[0][1]+heights[0][2])/20;
  for(const [index,total,poor] of [[0,20,8],[1,0,0],[2,12,3],[3,0,0],[4,8,1]]){
    const [,otherHeight,poorHeight]=heights[index];
    assert.ok(Math.abs(otherHeight-(total-poor)*unit)<1e-8,'blue segment excludes the poor subset');
    assert.ok(Math.abs(poorHeight-poor*unit)<1e-8,'red segment preserves the poor count');
    assert.ok(Math.abs(otherHeight+poorHeight-total*unit)<1e-8,'whole column equals total, never total plus poor');
  }
  assert.doesNotMatch(html,/NaN|Infinity/);
});

test('daily preview shows the selected date range while retaining source date indices',()=>{
  const html=renderToStaticMarkup(React.createElement(CustomerScreeningPreview,{row,dates,
    scope:{...scope,dateStart:dates[2],dateEnd:dates[3]},sourceRevision}));
  assert.match(html,/2026-10-28 전체 12건, 저품질 3건/);
  assert.match(html,/2026-10-29 전체 0건, 저품질 0건/);
  assert.equal((html.match(/data-day=/g)||[]).length,2);
  assert.doesNotMatch(html,/data-day="2026-10-26"|data-day="2026-10-30"/);
});

test('missing daily totals remain unavailable instead of inventing totals from poor calls',()=>{
  const html=render({...row,dailyTotal:undefined});
  assert.match(html,/전체 통화 미제공/);
  assert.match(html,/저품질 8건/);
  assert.doesNotMatch(html,/data-segment="other"/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});

test('missing QoE and location stay explicit and empty days remain safe',()=>{
  const html=render({...row,mean:null,mainArea:'',mainCell:'',dailyTotal:[0,0,0,0,0],dailyPoor:[],total:0,poor:0});
  assert.match(html,/<dd class="red">미평가<\/dd>/);
  assert.equal((html.match(/미확인/g)||[]).length,2);
  assert.equal((html.match(/data-segment="(?:other|poor)"[^>]*height="0"/g)||[]).length,10);
  assert.doesNotMatch(html,/NaN|Infinity/);
});
