/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {load}=require('../analyst-ts-loader.cjs');
const {buildFourthHourly,fourthMaskedCustomer,fourthMosBand,fourthBandCalls,fourthBandForMos,fourthPoorRates}=load('lib/analyst/quality-proposal-four.ts');
const {calculateProposalGrades}=load('lib/analyst/quality-proposal-metrics.ts');
const {buildImprovedView}=load('lib/analyst/improved-overview.ts');
const {getOverviewAnalytics}=load('lib/analyst/overview-analytics.ts');
const root=path.resolve(__dirname,'../..');
const read=(relative)=>fs.readFileSync(path.join(root,relative),'utf8');
const overview=JSON.parse(read('public/analyst-overview/MDT/2026-10-30.json'));

test('original overview preserved as 기존안 and former 4th proposal becomes main quality overview',()=>{
  const sha=(file)=>crypto.createHash('sha256').update(read(file)).digest('hex').toUpperCase();
  assert.equal(sha('components/analyst/quality-overview.tsx'),
    'CF7566E1E0BD7372C0296D95BAE565250659EE49394DE60D8917468BCD02AD57');
  assert.equal(sha('components/analyst/quality-overview.module.css'),
    '3610BAF982E4FD67E0C4E54460C9C35C7D71D4FF7FA2028BA0F5DE55CAA2FD9E');
  const main=read('app/page.tsx');
  const shell=read('components/analyst/analyst-dashboard.tsx');
  const topbar=read('components/analyst/quality-proposal-four.tsx');
  assert(main.includes('return <QualityProposalFour variant=')&&main.includes("?'improvement1':'current'"));
  assert(main.includes("view === 'overview' || view === 'contract'"));
  assert(shell.includes('<QualityTopNav'));
  assert(topbar.includes('<QualityTopNav')&&topbar.includes('improvement1')&&topbar.includes('qualityHref'));
  assert(read('app/overview-proposal-4/page.tsx').includes('<QualityProposalFour />'));
  for(const version of [1,2,3]){
    assert(!fs.existsSync(path.join(root,'app/overview-proposal-'+version+'/page.tsx')));
    assert(!shell.includes('href="/overview-proposal-'+version+'"'));
    assert(!topbar.includes('href="/overview-proposal-'+version+'"'));
  }
});

test('new design mirrors the second selected reference composition without fabricated claims',()=>{
  const ui=read('components/analyst/quality-proposal-four.tsx');
  const css=read('components/analyst/quality-proposal-four.module.css');
  const order=['<Topbar ','className={styles.filters}','className={styles.kpis}',
    'className={styles.charts}','<GradeDonut','<HourlyChart','<ExperiencePanel',
    'className={styles.geography}','<AnalystMap','className={styles.rankingList}',
    '<Table calls={dataCalls}'];
  const positions=order.map(key=>ui.indexOf(key));
  assert(positions.every(x=>x>=0),positions.map((x,i)=>[order[i],x]));
  assert(positions.every((x,i)=>i===0||x>positions[i-1]));
  assert(css.includes('.nav{height:57px;background:var(--navy)'));
  assert(css.includes('.kpis{display:grid;grid-template-columns:repeat(4'));
  assert(css.includes('.charts{display:grid;grid-template-columns:'));
  assert(css.includes('.geography{display:grid;grid-template-columns:'));
  assert(ui.includes('clusterOccurrences'),'proposal 4 clusters dense radio estimates');
  assert(ui.includes('CSV 내보내기'));
  assert(ui.includes('RTP Loss (원본)'));
  assert(ui.includes('고객 (익명)'));
  assert(ui.includes('기지국 좌표는 단말 실제 위치가 아닙니다'));
  assert(!ui.includes('전일 대비'),'comparison requires actual previous-day data');
  assert(!ui.includes('전체 통화 대비 지역 불량률'),'partial location cohort has no area denominator');
});

test('MOS grade, hourly totals and weighted hourly mean are sourced from real 10/30 CDR',()=>{
  const grades=calculateProposalGrades(overview,'00:00','23:59');
  const hourly=buildFourthHourly(overview,'00:00','23:59');
  assert.equal(hourly.length,24);
  assert.deepEqual(grades.bands.map(b=>b.count),[288,442,25958]);
  assert.equal(grades.unavailable,11043);
  assert.equal(hourly.reduce((sum,h)=>sum+h.total,0),37731);
  assert.equal(hourly.reduce((sum,h)=>sum+h.poor,0),288);
  assert.equal(hourly.reduce((sum,h)=>sum+h.evaluated,0),26688);
  for(const h of hourly){
    assert.equal(h.evaluated,h.poor+h.other);
    assert(h.mean===null||(h.mean>=1&&h.mean<=5));
  }
  const overallMean=hourly.reduce((sum,h)=>sum+(h.mean??0)*h.evaluated,0)/26688;
  assert(Math.abs(overallMean-grades.mean)<1e-8);
  assert(Math.abs(overallMean-4.11)<.02);
});

test('time filter changes actual hourly counts, cohorts and map but not overall truth of source',()=>{
  const full=buildFourthHourly(overview,'00:00','23:59');
  const chosen=full.find(x=>x.total>0);
  const hour=String(chosen.hour).padStart(2,'0');
  const one=buildFourthHourly(overview,hour+':00',hour+':59');
  assert.equal(one.reduce((sum,x)=>sum+x.total,0),chosen.total);
  assert.equal(one.reduce((sum,x)=>sum+x.poor,0),chosen.poor);
  assert.equal(buildFourthHourly(overview,'20:00','08:00').reduce((sum,x)=>sum+x.total,0),0);
  const all=buildImprovedView(overview,{from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all'});
  assert.equal(all.locatedPoorCalls,overview.callLocations.filter(p=>p.mos!=null&&p.mos<3).length);
  const gd=buildImprovedView(overview,{from:'00:00',to:'23:59',hour:null,districtId:'adm:11230680',evidence:'gnss'});
  assert(gd.locations.every(p=>p.areaId==='adm:11230680'&&p.evidence==='gnss'));
  assert.equal(gd.globalSummary.total,all.globalSummary.total);
  const people=getOverviewAnalytics(overview.calls,'mos',3).experience;
  assert.deepEqual(people.map(x=>x.count),[267,18,15]);
});

test('opaque customer labels never imply a real phone number',()=>{
  const id='mdt-005889d546180cadc904eb6c';
  assert.equal(fourthMaskedCustomer(id),'고객 ··'+id.slice(-5).toUpperCase());
  assert.equal(fourthMosBand({mos:2.5}),'불량');
  assert.equal(fourthMosBand({mos:3.2}),'보통');
  assert.equal(fourthMosBand({mos:4.2}),'양호');
  assert.equal(fourthMosBand({mos:null}),'미평가');
});


test('score distribution clicks investigate all source CDR calls, not only the location-linked low-MOS rows',()=>{
 const all=overview.calls;
 const poor=fourthBandCalls(all,'poor'),fair=fourthBandCalls(all,'fair'),good=fourthBandCalls(all,'good');
 assert.deepEqual([poor.length,fair.length,good.length],[288,442,25958]);
 assert.equal(poor.length+fair.length+good.length,26688);
 assert(poor.some(call=>!overview.callLocations.some(p=>p.callId===call.id)),
  'selected low MOS must retain unlocated CDR calls');
 assert.equal(fourthBandCalls(all,null).length,37731);
 assert(poor.every(call=>fourthBandForMos(call.mos)==='poor'));
 assert(fair.every(call=>fourthBandForMos(call.mos)==='fair'));
 assert(good.every(call=>fourthBandForMos(call.mos)==='good'));
 assert.equal(fourthBandForMos(null),null);
 assert.equal(fourthBandForMos(Number.NaN),null);
 assert.equal(fourthBandForMos(5.2),null);
 assert.equal(fourthBandForMos(1),'poor');
 assert.equal(fourthBandForMos(3),'fair');
 assert.equal(fourthBandForMos(3.5),'good');
});

test('grade selection respects hour/customer/region evidence, without mapping non-poor CDR to low-MOS geo sample',()=>{
 const poorHour=overview.calls.filter(call=>Math.floor(call.startSecond/3600)===15);
 const poor=fourthBandCalls(poorHour,'poor');
 assert(poor.every(call=>Math.floor(call.startSecond/3600)===15));
 const focus=overview.callLocations.find(loc=>loc.evidence==='gnss');
 assert(focus,'GNSS evidence must exist for testing scope');
 const all=fourthBandCalls(overview.calls,'poor',{
   districtId:focus.areaId,evidence:'gnss',locations:overview.callLocations,
 });
 const sourceIds=new Set(overview.callLocations.filter(loc=>loc.areaId===focus.areaId&&loc.evidence==='gnss')
   .map(loc=>loc.callId));
 assert(all.every(call=>sourceIds.has(call.id)));
 const good=fourthBandCalls(overview.calls,'good',{
   districtId:focus.areaId,evidence:'gnss',locations:overview.callLocations,
 });
 assert(good.every(call=>sourceIds.has(call.id) && call.mos>=3.5),
   'good MOS uses only the call own GNSS location, never a poor-MOS neighbor');
});

test('total CDR low-quality percentage is separately presented beside evaluated MOS percentage',()=>{
 const rate=fourthPoorRates(288,37731,26688);
 assert.equal(rate.total.toFixed(1),'0.8');
 assert.equal(rate.evaluated.toFixed(1),'1.1');
 assert.deepEqual(fourthPoorRates(0,0,0),{total:null,evaluated:null});
 const ui=read('components/analyst/quality-proposal-four.tsx');
 const css=read('components/analyst/quality-proposal-four.module.css');
 assert(ui.includes("grades={distributionMode==='drop'?(dropGrades??metrics):metrics}"));
 assert(ui.includes('onModeChange={chooseDistributionMode}'));
 assert(ui.includes('aria-pressed={selected===entry.id}'));
 assert(ui.includes('onClick={()=>choose(entry.id)}'));
 assert(ui.includes('onClick={fromRing}'));
 assert(ui.includes('fourthBandCalls(model.visibleHours,selectedBand'));
 assert(ui.includes('setSelectedBand(null)'),'clear all releases grade filter');
 assert(ui.includes("selectedBand&&distributionMode==='mos'&&<button className={styles.filterApplied}"));
 assert(ui.includes('QoE 대비 {entry.mosRate}'));
 assert(ui.includes('mosRate:poorRates?.evaluated'));
 assert(ui.includes('sub:`전체 대비 ${poorRates?.total'));
 assert(ui.includes('title="유효 QoE 평가 통화 대비"'));
 assert(css.includes('.gradeItem[aria-pressed="true"]'));
 assert(css.includes('.donutSelect{'));
 assert(css.includes('.poorTotalRate{'));
 assert(ui.includes("band:selectedBand??'poor'"),
  'map must use each selected CDR MOS grade, never reuse low-MOS positions');
});


test('map popup opens selected CDR immediately and table retains accessible call modal',()=>{
 const ui=read('components/analyst/quality-proposal-four.tsx');
 const css=read('components/analyst/quality-proposal-four.module.css');
 assert(ui.includes('const shown=pinned'));
 assert(ui.includes('first.filter(call=>call.id!==selected)'));
 assert(ui.includes('data-call-id={call.id}'));
 assert(ui.includes('onCallLocationSelect={selectCall}'));
 assert(ui.includes('onSelect={selectTableCall}'));
 assert(ui.includes('setChosenCall(id);setDeep(false);setDialogOpen(true);setSearch'));
 assert(!ui.slice(ui.indexOf('const selectCall='),ui.indexOf('const selectTableCall=')).includes('scrollIntoView'));
 assert(ui.includes('setChosenCall(id);setDeep(false);setDialogOpen(true)'));
 assert(ui.includes('id="qoe-call-analysis-dialog"'));
 assert(ui.includes('aria-modal="true"'));
 assert(ui.includes("event.key==='Escape'"));
 assert(ui.includes('dialogCloseRef.current?.focus()'));
 assert(ui.includes('className={styles.pinnedNotice}'));
 assert(css.includes('.analysisModal{'));
 assert(css.includes('.modalBackdrop{'));
});

test('customer-call analysis shows LTE towers even without GNSS; BYE-only call uses validated RU site',()=>{
 const contract=read('components/analyst/contract-workspace.tsx');
 const map=read('components/analyst/analyst-map.tsx');
 const shell=read('components/analyst/analyst-dashboard.tsx');
 assert(contract.includes('[stations, setStations] = useState(true)'));
 assert(contract.includes('const stationMarkers=cdrOnly?(byeStation?[byeStation]:[]):['));
 assert(contract.includes('...callStations'));
 assert(contract.includes('byeStation.byeRuId')===false,'station identifiers are sourced from validated typed inventory, not arbitrary props');
 assert(contract.includes('byeEntry.evidence'));
 assert(contract.includes('stationPciRows.map'));
 assert(contract.includes('aria-label="선택 통화 PCI 비교"'));
 assert(contract.includes('stations={stationMarkers}'));
 assert(contract.includes('기지국 연결·PCI'));
 assert(map.includes('const stationFitKey=focusKey'));
 assert(map.includes('visibleStationBounds.length'));
 assert(map.includes('map.fitBounds(L.latLngBounds(positions)'));
 assert(shell.includes('byeLocation={overview.data?.callLocations?.find'));
 assert(shell.includes("resolved.view === 'contract' && resolved.source === 'MDT'"));
 const manifest=JSON.parse(read('public/voice-1030.json'));
 const entry=manifest.days.find(day=>day.customerId==='mdt-54f36ba5c24410cc2b256068'&&day.date==='2026-10-30');
 assert(entry,'example customer from supplied browser screenshot');
 const detail=JSON.parse(read('public/'+entry.dataPath));
 const call=detail.calls.find(c=>c.start==='21:37:36'&&c.end==='21:39:37');
 assert(call);
 const {selectExactCallStations}=load('lib/analyst/pci-evidence.ts');
 const observations=detail.samples.filter(s=>s[19]===call.id).map(s=>({baseStationId:s[21]?.baseStationId,cellId:s[21]?.cellId}));
 const stations=selectExactCallStations(detail.baseStations,observations);
 assert.equal(stations.length,5,'5 station coordinates exist in source, UI must show them');
 assert(stations.every(s=>Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)));
});


test('selected-call dialog draws exactly its linked CDR-end coordinate, not an area centroid or unrelated call',()=>{
 const ui=read('components/analyst/quality-proposal-four.tsx');
 const map=read('components/analyst/analyst-map.tsx');
 const css=read('components/analyst/quality-proposal-four.module.css');
 assert(ui.includes("const selectedLocation=selected?tableLocations.get(selected.id):undefined;"));
 assert(ui.includes('className={styles.dialogLocation}'));
 assert(ui.includes('aria-label="선택 통화 종료 대표 위치 지도"'));
 assert(ui.includes('callLocations={[selectedLocation]}'));
 assert(ui.includes("key={'dialog-'+selected.id}"));
 assert(ui.includes("focusKey={'proposal-four-call-dialog-'+selected.id}"));
 assert(ui.includes('lat:selectedLocation.lat,lon:selectedLocation.lon'));
 assert(ui.includes("selectedLocation.evidence==='bye-cell'"));
 assert(ui.includes("selectedLocation.evidence==='estimated'"));
 assert(ui.includes('selectedLocation.byeCellId'));
 assert(ui.includes('selectedLocation.byeRuId'));
 assert(ui.includes('위치를 임의로 생성하지 않았습니다'));
 assert(ui.includes('실제 위치 오차가 검증된 값은 아닙니다'));
 assert(ui.includes('QoE 저하 순간의 위치를 뜻하지 않습니다'));
 assert(map.includes('if (administrativeDongs.length || callLocations.length)'));
 assert(map.includes('!callLocations.length &&'),'linked single call must not show misleading empty-map overlay');
 assert(map.includes('if(canSelectCallLocation) for (const entry'));
 assert(css.includes('.dialogLocationMap{height:225px;'));
 const sources=new Set(overview.callLocations.map(p=>p.evidence));
 assert(sources.has('bye-cell')&&sources.has('gnss'));
 assert([...sources].every(source=>['bye-cell','estimated','gnss'].includes(source)),
  'a withheld radio candidate must never create an estimated map marker');
 const known=new Set(overview.calls.map(c=>c.id));
 assert(overview.callLocations.every(p=>known.has(p.callId)));
});
