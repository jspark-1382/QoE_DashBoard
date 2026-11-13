/* eslint-disable @typescript-eslint/no-require-imports -- Source-owned cause assessment contract. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildCauseAssessments}=require('../qwen-candidate-cause-assessment.cjs');
const target=(id,kind,categories,criteria)=>({id,kind,allowedCauseCategories:categories,evidenceIds:['T'+id],criteria});
test('all five current causes remain visible with missing evidence',()=>{
 const rows=buildCauseAssessments([],[]);
 assert.deepEqual(rows.map(row=>row.category),['coverage','capacity','interference','mobility','equipment']);
 assert(rows.every(row=>row.status==='insufficient'&&row.targetIds.length===0&&row.missingEvidence.length>0));
 assert.match(rows[1].missingEvidence.join(' '),/PRB/);
});
test('actual DL/UL and transition thresholds expose linked possible causes without confirming faults',()=>{
 const criteria={dl:{status:'matched'},ul:{status:'not-matched'},pollution:{status:'matched',window:{changes:3,startedAt:'10:00:00',endedAt:'10:00:24'}}};
 const t=target('A','call-criteria',['coverage','mobility'],criteria);
 const rows=buildCauseAssessments([t],[{id:'A',metrics:{criteria}}]);
 for(const category of ['coverage','mobility']){
  const row=rows.find(row=>row.category===category);assert.equal(row.status,'criteria-met');assert.deepEqual(row.targetIds,['A']);assert.deepEqual(row.evidenceIds,['TA']);assert(row.missingEvidence.length>0);
 }
 assert.equal(rows.find(row=>row.category==='capacity').status,'insufficient');
 assert.equal(rows.find(row=>row.category==='equipment').status,'insufficient');
});
test('zero tails, unknown PHR and ordinary BYE do not fabricate a positive cause',()=>{
 const grid=target('G','mdt-grid',['coverage','interference']);
 const term=target('B','termination-group',['equipment']);
 const rows=buildCauseAssessments([grid,term],[{id:'G',metrics:{belowPct:{'-100':0,'-105':0,'-110':0}}},{id:'B',metrics:{rawCodes:{byeReasonRaw:'Tx Bye'}}}]);
 assert(rows.every(row=>row.status==='insufficient'));
});
test('positive actual -100 POT distribution and RTP interruption remain specific source candidates',()=>{
 const grid=target('G','mdt-grid',['coverage','interference']),term=target('B','termination-group',['equipment']);
 const rows=buildCauseAssessments([grid,term],[{id:'G',metrics:{belowPct:{'-100':20,'-105':0,'-110':0}}},{id:'B',metrics:{rawCodes:{byeReasonRaw:'102^RTP timeout'}}}]);
 assert.equal(rows.find(row=>row.category==='coverage').status,'criteria-met');
 assert.equal(rows.find(row=>row.category==='equipment').status,'possible');
 assert.equal(rows.find(row=>row.category==='interference').status,'insufficient');
 assert.equal(rows.find(row=>row.category==='capacity').status,'insufficient');
});

test('bounded source cards preserve actual MDT POTs and actual calls independently without assigning UL-only sources to DL',()=>{
 const calls=Array.from({length:8},(_,i)=>target('C'+i,'call-criteria',['coverage'],{dl:{status:'matched'},ul:{status:'matched'}}));
 const grids=Array.from({length:8},(_,i)=>({...target('G'+i,'mdt-grid',['coverage'],{dl:{status:'matched'},ul:{status:'matched'}}),mapPoints:[{pot:'P'+i,lat:37+i/1000,lon:127}]}));
 const ulOnly=target('UL_ONLY','call-criteria',['coverage'],{dl:{status:'not-matched'},ul:{status:'matched'}});
 const rows=buildCauseAssessments([...calls,...grids,ulOnly,calls[0],grids[0]]);
 for(const category of ['coverage']){
  const row=rows.find(r=>r.category===category);assert.equal(row.targetIds.length,10);assert.equal(new Set(row.targetIds).size,10);
  assert.equal(row.targetIds.filter(id=>id.startsWith('G')).length,5);assert.equal(row.targetIds.filter(id=>id.startsWith('C')).length,5);
  assert.deepEqual(new Set(row.evidenceIds),new Set(row.targetIds.map(id=>'T'+id)));
 }
 assert(!rows.find(r=>r.category==='coverage').targetIds.includes('UL_ONLY'));
 assert(calls.every(call=>!call.mapPoints),'source selection never invents call coordinates');
 const missing=buildCauseAssessments([ulOnly]);assert.deepEqual(missing.find(r=>r.category==='coverage').targetIds,['UL_ONLY']);
});
