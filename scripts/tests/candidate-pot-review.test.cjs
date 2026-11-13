/* eslint-disable @typescript-eslint/no-require-imports -- Tests use the existing CommonJS TypeScript loader. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../../lib/analyst/candidate-pot-review.ts');
const load=()=>{assert.ok(fs.existsSync(file),'POT-local comparison module must exist');return require('../analyst-ts-loader.cjs').load('lib/analyst/candidate-pot-review.ts');};
function measurement(band,earfcn,samples,tail,rsrp=-94,rsrq=-14,date='2026-11-03'){return {date,band,earfcn,samples,rsrpMean:rsrp,rsrqMean:rsrq,rsrpMeanSumCnt:-88,phrMean:null,belowPct:{'-105':tail,'-110':0},metricSamples:{},sourceFiles:[]};}
function fixture(){const base={x:962687.5,y:1943937.5,lat:37.493938,lon:127.077901,rsrp:-94,samples:421,bands:{}};return {pots:[
 {...base,pot:'38507_77757',analysis:[measurement('900','3743',421,11.16),measurement('1.8광','1550',630,4.92)]},
 {...base,pot:'38507_77758',y:base.y+25,analysis:[measurement('900','3743',66,22.73,-95.33,-14.83),measurement('900','3743',80,99,-120,-19,'2026-11-04')]},
 {...base,pot:'38507_77756',y:base.y-25,analysis:[measurement('900','3743',302,6.29,-90.66,-16.47)]},
 {...base,pot:'far',y:base.y+150,analysis:[measurement('900','3743',500,99)]}
 ]};}
test('current five causes and historical four-cause labels stay distinct',()=>{
 const {POT_CAUSE_CATEGORIES,potCauseLabel}=load();
 assert.deepEqual(POT_CAUSE_CATEGORIES.map(x=>x.label),['커버리지 부족','셀 중첩·간섭','셀·주파수 전환','장비·전송·단말 이상','주파수·용량 부족']);
 assert.equal(potCauseLabel('uplink',true),'UL 커버리지 불량');
 assert.equal(potCauseLabel('interference',true),'Pollution 추정');
});
test('Top1 stays the highest measured band on the selected date and missing bands stay missing',()=>{const h=load(),p=fixture().pots[0];assert.equal(h.selectPotMeasurement(p,'top1','2026-11-03').band,'1.8광');assert.equal(h.selectPotMeasurement(p,'2.1','2026-11-03'),null);assert.equal(h.selectPotMeasurement(p,'900','2026-11-05'),null);});
test('local comparison uses same date and EARFCN within adjacent grid cells',()=>{const h=load(),c=fixture(),r=h.reviewPot(c,c.pots[0],'900','2026-11-03','coverage');assert.equal(r.comparison.pot.pot,'38507_77758');assert.equal(r.comparison.measurement.belowPct['-105'],22.73);assert.equal(r.measurement.belowPct['-105'],11.16);assert.equal(r.status,'suspected');assert.equal(r.comparison.direction,'북쪽');assert.match(r.check,/38507_77757/);assert.match(r.check,/38507_77758/);});
test('weak signal alone never becomes a spectrum, mobility or equipment diagnosis',()=>{const h=load(),c=fixture();for(const id of ['capacity','mobility','equipment'])assert.equal(h.reviewPot(c,c.pots[0],'900','2026-11-03',id).status,'unavailable');});
test('RSRP improves while RSRQ degrades identifies a comparison, not confirmed PCI interference',()=>{const h=load(),c=fixture(),r=h.reviewPot(c,c.pots[0],'900','2026-11-03','interference');assert.equal(r.comparison.pot.pot,'38507_77756');assert.equal(r.status,'review');assert.doesNotMatch(r.reason,/PCI.*(?:확정|불량입니다)/);});
test('missing measurements and null thresholds cannot be reported as a good zero rate',()=>{const h=load(),c=fixture();let r=h.reviewPot(c,c.pots[0],'2.1','2026-11-03','coverage');assert.equal(r.measurement,null);assert.equal(r.status,'unavailable');c.pots[0].analysis[0].belowPct['-105']=null;r=h.reviewPot(c,c.pots[0],'900','2026-11-03','coverage');assert.equal(r.status,'unavailable');});
