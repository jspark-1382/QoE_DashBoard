/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {combineDateOverviews}=load('lib/analyst/date-range.ts');
const {calculateProposalGrades}=load('lib/analyst/quality-proposal-metrics.ts');
const {overlayThreeSiteRough}=load('lib/analyst/three-site-rough.ts');
const {buildImprovedView,summarizeMappedLocationEvidence}=load('lib/analyst/improved-overview.ts');
const dates=[26,27,28,29,30].map(d=>'2026-10-'+d);
const raw=combineDateOverviews(dates.map(day=>require('../../public/analyst-overview/MDT/'+day+'.json')));
const rough=dates.map(day=>require('../../public/three-site-rough/'+day+'.json'));
const mappedOverview=overlayThreeSiteRough(raw,{...rough[0],date:raw.date,points:rough.flatMap(d=>d.points)},true);
const scope=(extra={})=>({from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all',band:'poor',...extra});
const mapped=(extra={})=>summarizeMappedLocationEvidence(buildImprovedView(mappedOverview,scope(extra)));

test('237 mapped low-QoE calls / 1,580 poor calls = 15.0% over exactly the same 5-day range',()=>{
  const stats=calculateProposalGrades(raw,'00:00','23:59');
  const numerator=mapped();
  assert.equal(stats.bands[0].count,1580);
  assert.deepEqual([numerator.G,numerator.T,numerator.U],[131,106,237]);
  assert.equal((100*numerator.U/stats.bands[0].count).toFixed(1)+'%','15.0%');
});
test('date/time, GPS-only and grade filters give truthful coverage fractions',()=>{
  for(const [from,to] of [['00:00','23:59'],['10:00','10:59']]){
    const stats=calculateProposalGrades(raw,from,to);
    for(const band of ['poor','fair','good']){
      const total=stats.bands.find(b=>b.id===band).count;
      const result=mapped({from,to,band});
      assert(result.U>=0&&result.U<=total, 'geolocated calls cannot exceed same-grade CDR total');
      const gps=mapped({from,to,band,evidence:'gnss'});
      assert(gps.U<=result.U, 'GPS filter may reduce only the numerator');
      if(total>0)assert(Number.isFinite(result.U/total));
    }
  }
});
test('improvement2 all five KPI cards remove miniature graphs while keeping ratio badges',()=>{
  const source=fs.readFileSync('components/analyst/quality-proposal-four.tsx','utf8');
  const css=fs.readFileSync('components/analyst/quality-proposal-four.module.css','utf8');
  assert(source.includes("const mappedBand=selectedBand??'poor'"));
  assert(source.includes("metrics?.bands.find(item=>item.id===mappedBand)?.count"));
  assert(source.includes('mappedLocation?ratio(mappedLocation.U,mappedBandCalls)'));
  assert(source.includes("'저품질 통화 대비'"));
  assert(source.includes("'양호 통화 대비'"));
  assert(source.includes("'보통 통화 대비'"));
  assert(source.includes('locationRate:mappedLocationRate'));
  assert(source.includes("{entry.locationRateLabel} {entry.locationRate}"));
  assert(source.includes("isLocationCard?styles.locationKpi:''"));
  assert(source.includes("entry.name==='저품질 통화'||isLocationCard?{color:'#cb3546'}:{}"));
  assert(source.includes("icon:MapPin,color:'#328ee3',background:'#e4f1ff'"));
  assert(!css.includes('.locationKpiPoor'));
  assert(!source.includes('data:mappedLocation?.hourly'));
  assert(!source.includes("sub:'GPS + 삼각 측량 근사 합계'"));
  assert(source.includes("'sub' in entry&&entry.sub&&<small>"));
  assert(source.includes("!improvementTwo&&'data' in entry&&entry.data&&<MicroChart"));
  assert(css.includes('.kpis[data-five="true"] .kpiContent{justify-content:flex-start'));
  assert(css.includes('.kpis[data-five="true"] .kpiValueLine>strong{font-size:27px}'));
  assert(css.includes('.locationCoverageRate{'));
  assert(css.includes('.locationKpi .kpiContent'));
  assert(css.includes('.locationKpi .kpiValueLine'));
});
