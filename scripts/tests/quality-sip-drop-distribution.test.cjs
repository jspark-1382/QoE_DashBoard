/* eslint-disable no-restricted-syntax */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const {onlyDropCalls}=load('lib/analyst/sip-drop-overview.ts');
const {calculateProposalGrades}=load('lib/analyst/quality-proposal-metrics.ts');
const {buildImprovedView}=load('lib/analyst/improved-overview.ts');
const {fourthBandCalls}=load('lib/analyst/quality-proposal-four.ts');
const {classifySipReason11}=load('lib/analyst/sip-reason.ts');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const input=JSON.parse(read('public/analyst-overview/MDT/2026-10-30.json'));

test('SIP CDR 11.REASON Drop only: real October 30 count, MOS 3 grades, missing MOS distinct',()=>{
 const drop=onlyDropCalls(input);
 const grades=calculateProposalGrades(drop,'00:00','23:59');
 assert.equal(input.calls.length,37731);
 assert.equal(drop.calls.length,53);
 assert.equal(grades.evaluated,45);
 assert.equal(grades.unavailable,8);
 assert.deepEqual(grades.bands.map(b=>b.count),[45,0,0]);
 assert.equal(grades.bands.reduce((sum,b)=>sum+b.percentage,0).toFixed(4),'100.0000');
 assert(drop.calls.every(call=>classifySipReason11(call.sipCause)==='drop'));
 assert(drop.calls.every(call=>input.calls.includes(call)));
 assert.equal(input.calls.filter(call=>classifySipReason11(call.sipCause)==='drop').length,53);
 assert.equal(input.calls.length,37731,'must not mutate source');
 assert.equal(drop.sourceRevision,input.sourceRevision);
});
test('drop-only MOS grades drill down by real call ID without normal or other SIP leakage',()=>{
 const drop=onlyDropCalls(input);
 for(const [band,count] of [['poor',45],['fair',0],['good',0]]){
  const filtered=fourthBandCalls(drop.calls,band);
  assert.equal(filtered.length,count,band);
  assert(filtered.every(call=>classifySipReason11(call.sipCause)==='drop'));
  const model=buildImprovedView(drop,{from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all',band});
  assert(model.locations.every(loc=>filtered.some(call=>call.id===loc.callId)));
  assert(model.focusedCalls.every(call=>filtered.some(x=>x.id===call.id)));
  assert(model.regions.every(region=>region.poorCalls>0));
  assert(model.regions.every(region=>region.gnssCalls+region.estimatedCalls+region.byeCellCalls===region.poorCalls));
 }
});
test('drop view cannot reuse unselected non-Drop caller location, original reference is immutable',()=>{
 const drop=onlyDropCalls(input);
 const allowed=new Set(drop.calls.map(call=>call.id));
 assert(drop.callLocations.every(loc=>allowed.has(loc.callId)));
 assert(drop.cells.every(cell=>cell.callIds.every(id=>allowed.has(id))));
 assert.notStrictEqual(drop.callLocations,input.callLocations);
 assert.equal(input.callLocations.some(loc=>!allowed.has(loc.callId)),true);
 const nonDrop=input.calls.find(call=>classifySipReason11(call.sipCause)!=='drop');
 assert(nonDrop && !allowed.has(nonDrop.id));
});
test('date/time range used identically in drop distribution and drilldown',()=>{
 const drop=onlyDropCalls(input);
 for(const range of [['07:00','10:00'],['00:00','23:59'],['13:00','12:59']]){
   const stats=calculateProposalGrades(drop,...range);
   const subset=drop.calls.filter(call=>{
     const m=Math.floor(call.startSecond/60);
     const lo=Number(range[0].slice(0,2))*60+Number(range[0].slice(3));
     const hi=Number(range[1].slice(0,2))*60+Number(range[1].slice(3));
     return m>=lo && m<=hi;
   });
   assert.equal(stats.evaluated+stats.unavailable,subset.length);
   assert.equal(stats.bands.reduce((sum,b)=>sum+b.count,0),stats.evaluated);
 }
});
test('chart dropdown MOS -> SIP Drop, all three grades, table and map share the filtered source',()=>{
 const ui=read('components/analyst/quality-proposal-four.tsx');
 const css=read('components/analyst/quality-proposal-four.module.css');
 assert(ui.includes('aria-label="QoE 분포 기준"'));
 assert(ui.includes('<option value="mos">QoE</option>'));
 assert(ui.includes('<option value="drop">절단 (SIP 상태코드)</option>'));
 assert(ui.includes("const scopeOverview=distributionMode==='drop'?dropOverview:displayOverview"));
 assert(ui.includes('const dropGrades=useMemo('));
 assert(ui.includes("setSelectedBand(mode==='drop'?'poor':null)"));
 assert(ui.includes('grades={distributionMode===\'drop\'?(dropGrades??metrics):metrics}'));
 assert(ui.includes("const activeSipFilter=distributionMode==='drop'?'drop':sipFilter;"));
 assert(ui.includes("disabled={distributionMode==='drop'}"));
 assert(ui.includes("distributionMode={distributionMode}"));
 assert(ui.includes('절단(Drop) · '));
 assert(css.includes('.distributionSelect'));
});
