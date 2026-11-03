/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {load}=require('../analyst-ts-loader.cjs');
const {getOverviewAnalytics}=load('lib/analyst/overview-analytics.ts');
const {buildImprovedView}=load('lib/analyst/improved-overview.ts');
const {calculateProposalGrades}=load('lib/analyst/quality-proposal-metrics.ts');
const base=path.resolve(__dirname,'../..');
const read=(name)=>fs.readFileSync(path.join(base,name),'utf8');
const source=JSON.parse(read('public/analyst-overview/MDT/2026-10-30.json'));
const filter={from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all'};

test('original quality overview and CSS are byte-identical to protected versions',()=>{
 const sha=(name)=>crypto.createHash('sha256').update(read(name)).digest('hex').toUpperCase();
 assert.equal(sha('components/analyst/quality-overview.tsx'),
  '7D167EAE8C180B8BB37721410F5048772F3DC23035D6DE9B676CE13268BC4458');
 assert.equal(sha('components/analyst/quality-overview.module.css'),
  '3610BAF982E4FD67E0C4E54460C9C35C7D71D4FF7FA2028BA0F5DE55CAA2FD9E');
});

test('third independent route and nav after proposals 1 and 2 without changing original page',()=>{
 const nav=read('components/analyst/analyst-dashboard.tsx');
 const app=read('components/analyst/quality-proposals.tsx');
 const positions=['/mos-lab','/overview-proposal-1','/overview-proposal-2','/overview-proposal-3']
  .map(route=>nav.indexOf('href="'+route+'"'));
 assert(positions.every(value=>value>=0), 'all links must exist');
 assert(positions.every((value,i)=>i===0 || value>positions[i-1]), 'nav order');
 assert(read('app/overview-proposal-3/page.tsx').includes('<QualityProposal version={3} />'));
 assert(app.includes('<div className={styles.chartsThree}>'), 'charts at the top');
 assert(app.includes('<div className={styles.investigationThree}>'), 'map below charts');
 assert(app.includes('<CustomerExperienceThree ctx={context}/>'));
 assert(app.includes('clusterOccurrences={ctx.version===3}'), 'clustering only for proposal3');
 const map=read('components/analyst/analyst-map.tsx');
 assert(map.includes('clusterOccurrences = false'), 'legacy map rendering remains default');
 assert(map.includes('clusterZoom < 17'), 'zoom 17 reveals original location pins');
});

test('refined proposal 3 has exactly 4 summary KPIs and a single aligned row for MOS, hourly and customer experience',()=>{
 const app=read('components/analyst/quality-proposals.tsx');
 const css=read('components/analyst/quality-proposals.module.css');
 const kpis=app.split('function KpiCardsThree(')[1].split('function CustomerExperienceThree(')[0];
 assert.equal((kpis.match(/\{label:'/g)??[]).length,4);
 assert(!kpis.includes("{label:'저품질 경험 고객'"));
 assert(!kpis.includes("{label:'위치 연결 저품질'"));
 const version3=app.split('{version===3?<>')[1].split('</>:version===1?<>')[0];
 assert(version3.includes('<KpiCardsThree ctx={context}/>'));
 assert.match(version3,/className=\{styles.chartsThree\}>\s*<Distribution ctx=\{context\}\/>\s*<HourChart ctx=\{context\}\/>\s*<CustomerExperienceThree ctx=\{context\}\/>/);
 assert.match(version3,/className=\{styles.investigationThree\}>\s*<MapPanel ctx=\{context\}\/>\s*<RegionsPanel ctx=\{context\}\/>/);
 assert.equal((version3.match(/<CustomerExperienceThree /g)??[]).length,1);
 assert(css.includes('.proposalThree .kpiRow{grid-template-columns:repeat(4,minmax(0,1fr))'));
 assert(css.includes('grid-template-columns:minmax(255px,.76fr) minmax(450px,1.6fr) minmax(315px,1.04fr)'));
 assert(css.includes('.proposalThree .chartsThree .distributionBar{display:none}'));
 assert(css.includes('.proposalThree .chartsThree .donut{height:110px;width:110px;flex-shrink:0}'));
});

test('only proposal 3 suppresses its redundant banner and comparison buttons',()=>{
 const app=read('components/analyst/quality-proposals.tsx');
 const css=read('components/analyst/quality-proposals.module.css');
 assert(app.includes('{version!==3&&<div className={styles.pageHeader}>'),
  'overview intro and actions are hidden only in 3');
 assert(app.includes('className={styles.pageActions}'),
  'comparison actions remain available for 1/2');
 assert(app.includes('DESIGN PROPOSAL'),
  'proposal 1/2 keep their headings');
 assert(css.includes('.proposalThree .main{padding-top:12px}'),
  '3 should not retain a large empty band above filters');
});

test('third design uses true MOS and unique customer statistics',()=>{
 const grades=calculateProposalGrades(source,'00:00','23:59');
 assert.equal(grades.evaluated,26688);
 assert.equal(grades.unavailable,11043);
 assert.deepEqual(grades.bands.map(b=>b.count),[288,442,25958]);
 const experience=getOverviewAnalytics(source.calls,'mos',3).experience;
 assert.deepEqual(experience.map(row=>row.count),[267,18,15]);
 assert(experience.every(row=>row.total===new Set(source.calls.map(call=>call.customerId)).size));
 assert(experience.every(row=>row.hourly===null || row.hourly.length===24));
});

test('clicking a customer experience type scopes location investigation, not global CDR totals',()=>{
 const experience=getOverviewAnalytics(source.calls,'mos',3).experience;
 const full=buildImprovedView(source,filter);
 assert.equal(full.globalSummary.total,37731);
 assert.equal(full.locatedPoorCalls,source.callLocations.filter(p=>p.mos!=null&&p.mos<3).length);
 for(const group of experience){
   const ids=new Set(group.customerIds);
   const targeted=buildImprovedView(source,{...filter,customerIds:ids});
   assert.equal(targeted.globalSummary.total,full.globalSummary.total);
   assert.equal(targeted.globalSummary.poor,full.globalSummary.poor);
   assert(targeted.locatedPoorCalls<=full.locatedPoorCalls);
   assert(targeted.focusedCalls.every(call=>ids.has(call.customerId)));
 }
 const empty=buildImprovedView(source,{...filter,customerIds:new Set()});
 assert.equal(empty.locatedPoorCalls,0);
 assert.equal(empty.focusedCalls.length,0);
});

test('third design keeps exact MOS/RTP evidence and map location disclaimers',()=>{
 const app=read('components/analyst/quality-proposals.tsx');
 const css=read('components/analyst/quality-proposals.module.css');
 assert(app.includes('evaluateCallEvidence'));
 assert(app.includes('원본 CDR 통화 1건당 MOS(v5)'));
 assert(app.includes('저MOS 중심 MDT 부분표본으로 행정동 불량률은 계산하지 않습니다'));
 assert(app.includes('MOS 점수 분포'));
 assert(app.includes('시간대별 통화 품질'));
 assert(app.includes('저품질 경험 고객'));
 assert(app.includes('반복 불량 고객'));
 assert(app.includes('연속 불량 고객'));
 assert(css.includes('.proposalThree .chartsThree'));
 assert(css.includes('.proposalThree .investigationThree'));
 assert(css.includes('.customerThreeRow'));
});
