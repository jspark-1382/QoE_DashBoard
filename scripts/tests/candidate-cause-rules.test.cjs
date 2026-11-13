/* eslint-disable @typescript-eslint/no-require-imports -- Pure source criterion boundaries. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildRadioCriteriaTargets,parseRadioTimestamp,summarizeRadioCriteria}=require('../qwen-candidate-cause-rules.cjs');
const date='2026-10-26';
const point=(second,cellId,extra={})=>({timestamp:'10:00:'+String(second).padStart(2,'0'),cellId,frequency:3743,rsrp:-99,phr:4,...extra});
const call=radioSeries=>({id:'actual-original-call',date,start:'10:00:00',radioSeries});
const criteria=rows=>buildRadioCriteriaTargets({calls:[call(rows)]})[0].criteria;

test('DL and UL use exact inclusive thresholds and missing values never become zero',()=>{
 let c=criteria([point(0,'A',{rsrp:-100,phr:3})]);assert.equal(c.dl.status,'matched');assert.equal(c.ul.status,'matched');assert.equal(c.dl.minimum,-100);assert.equal(c.ul.minimum,3);
 c=criteria([point(0,'A',{rsrp:-99.999,phr:3.001})]);assert.equal(c.dl.status,'not-matched');assert.equal(c.ul.status,'not-matched');
 c=criteria([point(0,'A',{rsrp:null,phr:null})]);assert.equal(c.dl.status,'insufficient');assert.equal(c.ul.status,'insufficient');
 c=criteria([point(0,'A',{rsrp:0,phr:null})]);assert.equal(c.dl.status,'insufficient');
});

test('three chronological A-B-A-B changes in thirty seconds meet the transition rule',()=>{
 const c=criteria([point(0,'A'),point(10,'B'),point(20,'A'),point(30,'B')]);
 assert.equal(c.pollution.status,'matched');assert.equal(c.pollution.observedCount,3);assert.equal(c.pollution.window.events.length,3);assert.equal(c.pollution.window.startedAt,'10:00:00');assert.equal(c.pollution.window.endedAt,'10:00:30');
});

test('a thirty-one second span and only two transitions do not satisfy three changes',()=>{
 let c=criteria([point(0,'A',{servingPci:1}),point(10,'B',{servingPci:2}),point(20,'A',{servingPci:1}),point(31,'B',{servingPci:2})]);assert.notEqual(c.pollution.status,'matched');assert.equal(c.pollution.observedCount,2);
 c=criteria([point(0,'A',{servingPci:1}),point(10,'B',{servingPci:2}),point(20,'C',{servingPci:3})]);assert.notEqual(c.pollution.status,'matched');assert.equal(c.pollution.observedCount,2);
});

test('a PCI and Cell change at the same boundary are one event, and PCI zero is valid',()=>{
 const c=criteria([point(0,'A',{servingPci:0}),point(10,'B',{servingPci:1}),point(20,'A',{servingPci:0}),point(30,'B',{servingPci:1})]);
 assert.equal(c.pollution.observedCount,3);assert(c.pollution.window.events.every(event=>event.cellChanged&&event.pciChanged));
});

test('neighbor PCI diversity is never treated as a serving PCI transition',()=>{
 const c=criteria([0,10,20,30].map((s,i)=>point(s,'A',{neighbors:[{pci:i,rsrp:-90}]})));
 assert.notEqual(c.pollution.status,'matched');assert.equal(c.pollution.observedCount,0);assert(c.pollution.missing.some(text=>text.includes('PCI')));
});

test('explicit serving PCI transitions work without Cell IDs while frequency-only changes do not',()=>{
 const pciOnly=criteria([0,10,20,30].map((second,i)=>point(second,null,{servingPci:i})));assert.equal(pciOnly.pollution.status,'matched');assert.equal(pciOnly.pollution.observedCount,3);assert(pciOnly.pollution.window.events.every(event=>event.pciChanged&&!event.cellChanged));
 const frequencyOnly=criteria([0,10,20,30].map((second,i)=>point(second,'A',{servingPci:0,frequency:3743+i})));assert.equal(frequencyOnly.pollution.status,'not-matched');assert.equal(frequencyOnly.pollution.observedCount,0);
});

test('unknown timestamps, long gaps and conflicting duplicate timestamps cannot create a window',()=>{
 for(const rows of [[point(0,'A'),point(10,'B'),point(20,'A',{timestamp:null}),point(30,'B')],[point(0,'A'),point(31,'B'),point(32,'A'),point(33,'B')],[point(0,'A'),point(10,'B'),point(10,'C'),point(20,'A'),point(30,'B')]])assert.notEqual(criteria(rows).pollution.status,'matched');
 const rows=[point(0,'A'),point(10,'B'),point(10,'B'),point(20,'A'),point(30,'B')];assert.equal(criteria(rows).pollution.observedCount,3);
});

test('missing dates do not invent midnight rollover while explicit ISO dates can prove it',()=>{
 const times=['23:59:50','23:59:59','00:00:10','00:00:20'];assert.notEqual(criteria(times.map((timestamp,i)=>({...point(0,i%2?'B':'A'),timestamp}))).pollution.status,'matched');
 const iso=['2026-10-26T23:59:50','2026-10-26T23:59:59','2026-10-27T00:00:10','2026-10-27T00:00:20'];assert.equal(criteria(iso.map((timestamp,i)=>({...point(0,i%2?'B':'A'),timestamp}))).pollution.status,'matched');
 assert.equal(parseRadioTimestamp('2026-02-30T10:00:00',date),null);assert.equal(parseRadioTimestamp('bad',date),null);
});

test('explicit ISO samples are counted chronologically and unknown time bases are kept separate',()=>{
 const ordered=[0,10,20,30].map((second,i)=>point(second,i%2?'B':'A',{timestamp:date+'T10:00:'+String(second).padStart(2,'0')}));
 assert.equal(criteria([ordered[2],ordered[0],ordered[3],ordered[1]]).pollution.status,'matched');
 const mixed=ordered.map((row,i)=>({...row,timestamp:i===2?row.timestamp+'Z':row.timestamp}));assert.notEqual(criteria(mixed).pollution.status,'matched');
});

test('calls remain independent and model criteria never contain actual identity values',()=>{
 const a={...call([point(0,'private-cell-A'),point(10,'private-cell-B')]),id:'first-private-call'},b={...call([point(20,'private-cell-C'),point(30,'private-cell-D')]),id:'second-private-call'};
 const targets=buildRadioCriteriaTargets({calls:[a,b]});assert.equal(targets.length,2);assert(targets.every(target=>target.criteria.pollution.observedCount===1));
 const matched=buildRadioCriteriaTargets({calls:[call([point(0,'private-cell-A'),point(10,'private-cell-B'),point(20,'private-cell-A'),point(30,'private-cell-B')])]})[0];
 assert.deepEqual(matched.allowedCauseCategories,['interference','mobility']);assert(!JSON.stringify(matched._model).includes('private-cell'));assert(!JSON.stringify(matched._model).includes('actual-original-call'));
 assert.equal(summarizeRadioCriteria(targets).calls,2);
});

test('all source calls remain represented, including all-insufficient calls',()=>{
 const targets=buildRadioCriteriaTargets({calls:Array.from({length:32},(_,i)=>({id:'source-'+i,date,radioSeries:[]}))});assert.equal(targets.length,32);assert(targets.every(target=>Object.values(target.criteria).every(c=>c.status==='insufficient')));
});

test('frequency changes and same-frequency returns provide independent original-call evidence',()=>{
 const target=rows=>buildRadioCriteriaTargets({calls:[call(rows)]})[0];
 const overlap=target([point(0,'private-A',{servingPci:0,rsrq:-14,triggerEvent:'A3'}),point(6,'private-B',{servingPci:1,rsrq:-16}),point(8,'private-A',{servingPci:0,rsrq:-13,triggerEvent:'A3'})]);
 assert.deepEqual(overlap.allowedCauseCategories,['interference']);
 assert.deepEqual(overlap.criteria.overlap.window.events.map(e=>e.servingPci),[0,1,0]);
 assert.deepEqual(overlap.criteria.overlap.a3Reports.map(e=>e.rsrq),[-14,-13]);
 assert(!JSON.stringify(overlap._model).includes('private-A'));
 const crossing=target([point(0,'private-A',{frequency:1694,servingPci:139}),point(1,'private-A',{frequency:1550,servingPci:139})]);
 assert.deepEqual(crossing.allowedCauseCategories,['mobility']);
 assert.deepEqual(crossing.criteria.frequencyChange.window.events.map(e=>e.earfcn),[1694,1550]);
 for(const middle of [{frequency:1550},{frequency:null},{timestamp:null}]){
  const separated=target([point(0,'A'),point(1,'B',middle),point(2,'A')]);
  assert.notEqual(separated.criteria.overlap.status,'matched');
 }
 assert.equal(target([point(0,'A',{frequency:1694}),point(31,'B',{frequency:1550})]).criteria.frequencyChange.status,'insufficient');
 const repeated=target([point(0,'A'),point(4,'B'),point(8,'C'),point(12,'D')]);
 assert.deepEqual(repeated.allowedCauseCategories,['mobility']);
});
