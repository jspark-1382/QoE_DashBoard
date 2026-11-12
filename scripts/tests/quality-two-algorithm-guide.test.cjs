// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=(s)=>historicalRead(path.join(root,s),'utf8');
const json=s=>JSON.parse(read(s));
const idx=json('public/quality-improvement/index.json');
const entry=idx.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30'&&e.scope.from==='00:00');
const summary=json('public/quality-improvement/'+entry.path);
const detail=json('public/quality-improvement/'+summary.candidates[0].detailPath);
test('tutorial accurately reflects offline DBSCAN rules and strict low MOS input',()=>{
 const algo=read('scripts/voice_improvement_1.py'),policy=read('lib/analyst/voice-improvement-1/scope.ts'),panel=read('components/analyst/quality-two-algorithm-guide.tsx');
 assert(policy.includes('epsM:100,minSamples:2,minPoorCustomers:3'));
 assert(policy.includes('minPoorDates:2,minNewCustomers:2,maxDiameterMultiplier:2'));
 assert(algo.includes("if isinstance(mos,(int,float))")&&algo.includes('1 <= mos < 3'));
 assert(algo.includes("DBSCAN(eps=policy['epsM']/R, min_samples=policy['minSamples']"));
 assert(algo.includes("nearby_test = [p for p, dist in zip(test, near) if dist <= policy['epsM']+1e-7]"));
 assert(algo.includes('math.ceil(max(100, center_max+20)/10)*10'));
 for(const word of ['100m','2점','3명↑','2일↑','200m','Haversine','GPS','삼각 측량','마지막 날','실제 데이터에 대입해 보기','지도','미확정']){
  assert(panel.includes(word),'missing tutorial step: '+word);
 }
});
test('tutorial example matches original approved candidate and its withheld rank',()=>{
 assert.equal(summary.candidates.length,7);
 const c=summary.candidates[0],d=detail.candidate;
 assert.equal(c.poorCustomerCount,5);
 assert.equal(c.poorCallCount,5);
 assert.equal(c.poorDateCount,3);
 assert.equal(c.validationNewCustomers,2);
 assert.equal(c.displayRadiusM,170);
 assert.equal(c.rangeReviewRequired,true);
 assert.equal(c.rank,null);
 assert(d.maxPairDistanceM>200&&d.maxPairDistanceM<210);
 assert(d.maxCenterDistanceM>145&&d.maxCenterDistanceM<146);
 assert.deepEqual(summary.discoveryDates,['2026-10-26','2026-10-27','2026-10-28','2026-10-29']);
 assert.deepEqual(summary.validationDates,['2026-10-30']);
});
test('fullscreen rail is opt-in and keeps same Leaflet map mounted',()=>{
 const p=read('components/analyst/quality-two-candidate-workspace.tsx'),style=read('components/analyst/quality-two-candidate-workspace.module.css');
 assert(p.includes('<MapPanelFrame className={styles.mapPanel}'));
 assert(p.includes('{({toggleButton,expanded,close})=>'));
 assert(p.includes('hidden={!expanded}'));
 assert(p.includes('data-expanded={expanded'));
 assert(p.includes('<QualityTwoAlgorithmGuide'));
 assert(p.includes('<ImprovementCandidateMap'));
 assert(style.includes('.algorithmRail[hidden]{display:none}'));
 assert(style.includes('data-expanded="true"'));
 assert(!p.includes('data-map-surface>\n       <ImprovementCandidateMap'),'map must be wrapped with stable workspace');
});
