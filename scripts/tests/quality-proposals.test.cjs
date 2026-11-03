/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const {calculateProposalGrades}=load('lib/analyst/quality-proposal-metrics.ts');
const root=path.resolve(__dirname,'../..');
const file=(relative)=>path.join(root,relative);
const source=(relative)=>fs.readFileSync(file(relative),'utf8');
const overview=JSON.parse(source('public/analyst-overview/MDT/2026-10-30.json'));

test('the ORIGINAL quality overview implementation and styling remain byte-for-byte unchanged',()=>{
  const sha=(filePath)=>crypto.createHash('sha256').update(fs.readFileSync(file(filePath))).digest('hex').toUpperCase();
  assert.equal(sha('components/analyst/quality-overview.tsx'),
    '7D167EAE8C180B8BB37721410F5048772F3DC23035D6DE9B676CE13268BC4458');
  assert.equal(sha('components/analyst/quality-overview.module.css'),
    '3610BAF982E4FD67E0C4E54460C9C35C7D71D4FF7FA2028BA0F5DE55CAA2FD9E');
});

test('two independent proposal routes appear right after MOS algorithm link, original tab stays first',()=>{
  const dashboard=source('components/analyst/analyst-dashboard.tsx');
  const mosIndex=dashboard.indexOf('href="/mos-lab"');
  const oneIndex=dashboard.indexOf('href="/overview-proposal-1"');
  const twoIndex=dashboard.indexOf('href="/overview-proposal-2"');
  assert(mosIndex>0&&oneIndex>mosIndex&&twoIndex>oneIndex);
  assert(dashboard.indexOf('품질 현황',dashboard.indexOf('<nav '))<mosIndex);
  assert(source('app/overview-proposal-1/page.tsx').includes('<QualityProposal version={1} />'));
  assert(source('app/overview-proposal-2/page.tsx').includes('<QualityProposal version={2} />'));
});

test('red amber green MOS categories calculate from real 10/30 CDR without invented totals',()=>{
  const result=calculateProposalGrades(overview,'00:00','23:59');
  const [poor,fair,good]=result.bands;
  assert.deepEqual([poor.id,fair.id,good.id],['poor','fair','good']);
  assert.deepEqual([poor.count,fair.count,good.count],[288,442,25958]);
  assert.equal(result.evaluated,26688);
  assert.equal(result.unavailable,11043);
  assert.equal(result.evaluated+result.unavailable,37731);
  assert(result.mean>1&&result.mean<=5);
  assert.equal(result.bands.reduce((sum,band)=>sum+band.count,0),result.evaluated);
  assert(Math.abs(result.bands.reduce((sum,band)=>sum+band.percentage,0)-100)<1e-8);
  assert.deepEqual(result.bands.map(b=>b.color),['#e35d64','#efa93b','#279d78']);
  assert.equal(result.hours.length,24);
  assert.equal(result.hours.reduce((sum,h)=>sum+h.total,0),37731);
  for(const hour of result.hours){
    assert.equal(hour.evaluated,hour.poor+hour.fair+hour.good);
    assert.equal(hour.total,hour.evaluated+hour.unavailable);
  }
});

test('hourly data scope and MOS threshold boundaries are consistent',()=>{
  const all=calculateProposalGrades(overview,'00:00','23:59');
  const h=all.hours.find(x=>x.total>0);
  assert(h);
  const h2=calculateProposalGrades(overview,String(h.hour).padStart(2,'0')+':00',
    String(h.hour).padStart(2,'0')+':59');
  assert.equal(h2.hours[h.hour].total,h.total);
  assert.equal(h2.evaluated,h.evaluated);
  assert.equal(h2.unavailable,h.unavailable);
  assert.equal(h2.hours.reduce((a,b)=>a+b.total,0),h.total);
  const invalid=calculateProposalGrades(overview,'22:00','06:00');
  assert.equal(invalid.evaluated,0);
  assert.equal(invalid.unavailable,0);
  assert.equal(invalid.mean,null);
});

test('the two visual proposals have distinct reference-inspired layouts with chart and call evidence widgets',()=>{
  const ui=source('components/analyst/quality-proposals.tsx');
  const css=source('components/analyst/quality-proposals.module.css');
  assert(ui.includes('<div className={styles.heroOne}>'));
  assert(ui.includes('<div className={styles.heroTwo}>'));
  assert(ui.includes('<ExperienceCard ctx={context}/>'));
  assert(ui.includes('<KpiCards ctx={context}/>'));
  assert(ui.includes('<MapPanel ctx={context}/>'));
  assert(ui.includes('<RegionsPanel ctx={context}/>'));
  assert(ui.includes('<HourChart ctx={context}/>'));
  assert(ui.includes('<Distribution ctx={context}/>'));
  assert(ui.includes('<DetailCard ctx={context}/>'));
  assert(ui.includes('evaluateCallEvidence'));
  assert(ui.includes('MOS(v5)'));
  assert(ui.includes('직접 고객 설문 결과는 아닙니다'));
  assert(ui.includes('행정동별 불량률은 계산하지'));
  assert(css.includes('.proposalOne .topNav'));
  assert(css.includes('.proposalTwo .topNav'));
  assert(css.includes('.proposalOne .detailInner'));
  assert(css.includes('.proposalTwo .detailInner'));
  assert(css.includes('.donut'));
  assert(css.includes('.experienceRows'));
  assert(css.includes('.hourPlot'));
});
