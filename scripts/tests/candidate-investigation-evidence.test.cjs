/* eslint-disable @typescript-eslint/no-require-imports -- Actual source-to-investigation contract tests. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildCandidateFindings}=require('../qwen-candidate-findings.cjs');
const candidate={medoid:{lat:37,lon:127},displayRadiusM:100};
const call=(i,extra={})=>({id:'private-call-'+i,date:i%2?'2026-10-27':'2026-10-26',start:'09:10',qoe:2,mos:2.4,isDrop:false,cell:'private-cell',rsrp:-95,rsrq:-13,sinr:-3,rtp:{txPacketLoss:0,rxPacketLoss:2.3456,txJitter:1,rxJitter:3,txLossCount:0,rxLossCount:5},...extra});

test('real sampled calls become bounded observation-only targets with exact original RTP and source links',()=>{
 const calls=Array.from({length:10},(_,i)=>call(i));
 const f=buildCandidateFindings({candidate,calls,rows:[]}),quality=f.analysisTargets.filter(t=>t.kind==='call-quality');
 assert.equal(quality.length,6);
 assert.deepEqual(quality[0].allowedCauseCategories,[]);assert.deepEqual(quality[0].sopIds,[]);
 assert(quality.every(t=>t.callIds.length===1&&calls.some(c=>c.id===t.callIds[0])));
 const raw=quality[0].metrics.find(m=>m.label==='rxPacketLoss');assert.equal(raw.value,2.3456);assert.equal(raw.unit,undefined);
 const m=f.modelTargets.find(t=>t.id===quality[0].id);assert.equal(m.metrics.rtp.rxPacketLoss,2.3456);
 assert.equal(m.metrics.rsrp,-95);assert.equal(m.metrics.sinr,-3);
 assert.match(m.investigationHint.check,/시각|구간/);assert.match(quality[0].limitations.join(' '),/단위/);
 const sent=JSON.stringify(f.modelTargets);assert(!sent.includes('private-call-'));assert(!sent.includes('private-cell'));
});

test('missing quality and RTP never fabricate a call investigation or treat missing metrics as zero',()=>{
 const empty=call(1,{qoe:null,mos:null,rsrp:null,rsrq:null,sinr:null,rtp:{},radioSeries:[]});
 const missing=buildCandidateFindings({candidate,calls:[empty],rows:[]});
 assert.equal(missing.analysisTargets.filter(target=>target.kind==='call-quality').length,0);
 assert(missing.analysisTargets.filter(target=>target.kind==='call-criteria').every(target=>target.allowedCauseCategories.length===0&&Object.values(target.criteria).every(value=>value.status==='insufficient')));
 const f=buildCandidateFindings({candidate,calls:[call(2,{rtp:{rxJitter:null,txJitter:0}})],rows:[]});
 const m=f.modelTargets.find(t=>t.kind==='call-quality');assert.equal(m.metrics.rtp.rxJitter,null);assert.equal(m.metrics.rtp.txJitter,0);
 const stored=buildCandidateFindings({candidate,calls:[call(3,{qoe:-1.5})],rows:[]});assert.equal(stored.modelTargets.find(target=>target.kind==='call-quality').metrics.qoe,-1.5,'stored QoE is not silently replaced with MOS grading');
});

test('repeat groups use full exact members while limiting links and disclose no normal regional denominator',()=>{
 const rows=Array.from({length:45},(_,i)=>({id:'member-'+i,customer_id:'customer-'+i%3,date:i%2?'2026-10-27':'2026-10-26',start_second:9*3600,cell:'SECRET_CELL',qoe:2,mos:2.2,is_drop:i===0?1:0}));
 const f=buildCandidateFindings({candidate,calls:[],rows}),patterns=f.analysisTargets.filter(t=>t.kind==='call-pattern');assert(patterns.length>=1&&patterns.length<=3);
 const cell=patterns.find(t=>t.title.includes('SECRET_CELL'));assert(cell);
 assert.equal(cell.metrics.find(m=>m.label==='구성 통화 수').value,45);assert.equal(cell.callIds.length,32);
 assert(cell.callIds.every(id=>rows.some(row=>row.id===id)));assert.deepEqual(cell.allowedCauseCategories,[]);assert.deepEqual(cell.sopIds,[]);
 assert.match(cell.limitations.join(' '),/분모/);assert.match(cell.limitations.join(' '),/32/);
 const sent=JSON.stringify(f.modelTargets);assert(!sent.includes('SECRET_CELL'));assert(!sent.includes('customer-'));assert(!sent.includes('member-'));
});

test('POT investigation hints explain source comparison without inventing attached calls',()=>{
 const grid={analysisSchemaVersion:'mdt-grid-analysis-v1',records:[{pot:'P1',lat:37,lon:127,analysis:[{date:'2026-11-03',band:'900',earfcn:'3743',samples:80,rsrpMean:-99,rsrqMean:-14,belowPct:{'-105':35,'-110':10},metricSamples:{'-105':80,'-110':80}}]}]};
 const f=buildCandidateFindings({candidate,grid,rows:[],calls:[]}),pot=f.analysisTargets[0];
 assert.match(pot.investigationHint.why,/RSRP/);assert.match(pot.investigationHint.check,/인접|같은/);assert.deepEqual(pot.callIds,[]);
 assert.equal(Object.hasOwn(f.modelTargets[0],'investigationHint'),false,'repeated MDT model hints are supplied once through targetRules');
});

test('same-call radio and quality targets share a private-ID-free letter alias while distinct calls remain separate',()=>{
 const calls=[call(2),call(1,{radioSeries:[-109,-104,-94].map(rsrp=>({rsrp,cellId:'private-radio-cell',frequency:3743}))})];
 const f=buildCandidateFindings({candidate,calls,rows:[]});
 const modelFor=(kind,callId)=>f.modelTargets.find(model=>model.kind===kind&&f.analysisTargets.find(target=>target.id===model.id).callIds[0]===callId);
 const radio=modelFor('call-radio','private-call-1'),quality=modelFor('call-quality','private-call-1'),other=modelFor('call-quality','private-call-2');
 assert.equal(radio.callRef,'CALL_REF_A');assert.equal(quality.callRef,'CALL_REF_A');assert.equal(other.callRef,'CALL_REF_B');
 assert.notEqual(other.callRef,radio.callRef);assert(!JSON.stringify(f.modelTargets).includes('private-call-'));assert(!JSON.stringify(f.modelTargets).includes('private-radio-cell'));
 assert(f.analysisTargets.every(target=>!Object.hasOwn(target,'callRef')),'request-local aliases are model-only; public source joins remain exact callIds');
});

test('ambiguous duplicate sampled IDs never receive an asserted same-call alias',()=>{
 const calls=[call(1),call(1,{date:'2026-10-28',radioSeries:[-109,-104,-94].map(rsrp=>({rsrp,cellId:'private-radio-cell',frequency:3743}))})];
 const f=buildCandidateFindings({candidate,calls,rows:[]});
 assert(f.modelTargets.filter(target=>['call-radio','call-quality'].includes(target.kind)).every(target=>!Object.hasOwn(target,'callRef')));
});
