const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {load}=require('../analyst-ts-loader.cjs');
let fixture,engine,dataset,overview,totalFixtureCalls;
const revision='fixture-voice-revision';
const call=(customer,id,second,mos,extra={})=>({id:customer+':'+id,rawCallId:id,customerId:customer,contractId:customer==='a'?'0000123':null,start:'10:00:00',end:'10:01:00',startSecond:second,startTimestamp:'2026-10-30T10:00:'+String(Math.floor(second)%60).padStart(2,'0')+'+09:00',mos,qoe:mos,sipCause:'A: Normal',locationSource:'unavailable',gridIds:[],site:'',...extra});
before(()=>{
  fs.mkdirSync(path.resolve('outputs','voice-query-tests'),{recursive:true});
  fixture=fs.mkdtempSync(path.resolve('outputs','voice-query-tests','fixture-'));
  const publicDir=path.join(fixture,'public');fs.mkdirSync(path.join(publicDir,'analyst-overview','MDT'),{recursive:true});
  dataset={meta:{revision,dates:['2026-10-30'],poorQoeThreshold:3,qoeBasis:'rtcp-mos-v5',partitioned:true},customers:[{id:'a',sourceContractId:'0000123',displayName:'a',dates:['2026-10-30'],sampleCount:0},{id:'b',displayName:'b',dates:['2026-10-30'],sampleCount:0},{id:'ambiguous',displayName:'ambiguous',dates:['2026-10-30'],sampleCount:0}],days:[{key:'a:2026-10-30',customerId:'a',date:'2026-10-30',dataPath:'voice-1030-data/a.json',sourceContractId:'0000123',samples:[],sampleCount:0}]};
  overview={schemaVersion:'analyst-overview-v1',source:'MDT',sourceRevision:revision,date:'2026-10-30',gridSizeM:60,spatialUnit:'administrative-dong',cells:[],administrativeDongs:[{id:'dong',label:'실제동',lat:37,lon:127,coordinates:[]}],calls:[call('a','low',36000,2),call('a','drop',36001,4,{sipCause:'C^H^J^K'}),call('a','missing',86399.9,null,{start:'23:59:59',startTimestamp:'2026-10-30T23:59:59.900+09:00'}),call('b','healthy',36002,4),call('b','dropMissing',36003,null,{sipCause:'H: Drop'}),call('ambiguous','one',36004,2),call('ambiguous','two',36004,2)],callLocations:[{callId:'a:low',areaId:'dong',lat:37,lon:127,evidence:'gnss',start:'10:00:00',mos:2},{callId:'a:drop',areaId:'dong',lat:37.1,lon:127.1,evidence:'bye-cell',start:'10:00:01',mos:4,byeCellId:'cell',byeRuId:'ru'}]};
  overview.administrativeDongs.push({id:'other',label:'다른동',lat:37.2,lon:127.2,coordinates:[]});
  dataset.customers.push({id:'slow',sourceContractId:'0000000',displayName:'slow',dates:['2026-10-30'],sampleCount:0});
  overview.calls.push(call('slow','poor',36010,2),call('slow','drop',36011,4,{sipCause:'H: Drop'}),call('slow','missing1',36012,null),call('slow','missing2',36013,null));
  overview.calls[3].mos=4.2606020000000004;overview.calls[3].qoe=overview.calls[3].mos;
  overview.callLocations[0].observedAt='2026-10-30T10:00:00+09:00';
  fs.mkdirSync(path.join(publicDir,'three-site-rough'));fs.mkdirSync(path.join(publicDir,'gps-map-stations'));
  const rough={schemaVersion:'coarse-three-site-v1',sourceRevision:revision,date:'2026-10-30',method:'THREE_SITE_RSRP_CENTROID',notA90PercentAccuracyRegion:true,counts:{},points:[{callId:'a:drop',areaId:'other',lat:37.2,lon:127.2,evidence:'estimated',positionQuality:'three-site-rough',estimationMethod:'THREE_SITE_RSRP_CENTROID',representativeBasis:'cdr-end-nearest',usedSiteCount:3,roughSearchRadiusM:1000,secondsBeforeEnd:1,usedStations:[0,1,2].map(i=>({lat:37+i*.01,lon:127,ruId:'ru'+i,cellId:'cell'+i,rsrpDbm:-90}))}]};
  // The same rough candidate must never replace an observed GNSS position.
  rough.points.push({...rough.points[0],callId:'a:low'});
  fs.writeFileSync(path.join(publicDir,'three-site-rough','2026-10-30.json'),JSON.stringify(rough));
  fs.writeFileSync(path.join(publicDir,'gps-map-stations','2026-10-30.json'),JSON.stringify({schemaVersion:'gps-map-stations-v1',sourceRevision:revision,date:'2026-10-30',records:{'a:low':{observedAt:overview.callLocations[0].observedAt,station:{baseStationId:'real-station',cellId:'real-cell',latitude:37.01,longitude:127.01,isVirtual:false}}}}));
  fs.writeFileSync(path.join(publicDir,'voice-1030.json'),JSON.stringify(dataset));fs.writeFileSync(path.join(publicDir,'analyst-overview','MDT','2026-10-30.json'),JSON.stringify(overview));
  dataset.meta.dates.unshift('2026-10-29');
  const previous={...overview,date:'2026-10-29',calls:[call('a','previous-day',36000,2,{startTimestamp:'2026-10-29T10:00:00+09:00'})],callLocations:[{callId:'a:previous-day',areaId:'dong',lat:37,lon:127,evidence:'gnss',start:'10:00:00',mos:2}]};
  totalFixtureCalls=overview.calls.length+previous.calls.length;
  fs.writeFileSync(path.join(publicDir,'voice-1030.json'),JSON.stringify(dataset));
  fs.writeFileSync(path.join(publicDir,'analyst-overview','MDT','2026-10-29.json'),JSON.stringify(previous));
  fs.mkdirSync(path.join(publicDir,'voice-1030-data'));
  const sample = (time, locationSource, gnssMetricId) => {
    const row = new Array(22).fill(null);
    row[1]=time; row[2]=37; row[3]=127; row[8]='LTE'; row[19]='low';
    row[21]={timestamp:'2026-10-30T'+time+'+09:00',locationSource,gnssMetricId,frequency:3743};
    return row;
  };
  const samples=[sample('10:00:01','gnss','38509_77756'),sample('10:00:02','estimated','38509_77756'),sample('10:01:01','gnss','123_456')];
  fs.writeFileSync(path.join(publicDir,'voice-1030-data','a.json'),JSON.stringify({...dataset.days[0],calls:[{id:'low',start:'10:00:00',end:'10:01:00',matchStatus:'MATCHED',hasMdt:true,rsrp:-91,sinr:9,rtp:{txPacketLoss:.75,txJitter:17,rxPacketLoss:.5,rxJitter:11}}],samples}));
  const run=spawnSync('python',['-B','scripts/build_voice_query_db.py','--public-dir',publicDir,'--out-dir',path.join(fixture,'outputs','voice-query-data')],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'});
  assert.equal(run.status,0,'read model builder succeeds: '+run.stderr);
  const index=JSON.parse(fs.readFileSync(path.join(publicDir,'voice-query-index.json'),'utf8'));
  const {createQueryEngine}=require('../voice-query-engine.cjs');engine=createQueryEngine({dbPath:path.resolve(fixture,index.database),root:fixture});
});
after(()=>{engine?.close();if(fixture)fs.rmSync(fixture,{recursive:true,force:true});});
const scope={dateStart:'2026-10-30',dateEnd:'2026-10-30',from:'00:00',to:'23:59'};
test('original call location exposes only GNSS POTs within the selected call and revision',()=>{
  const args={op:'call-observations',sourceRevision:revision,callId:'a:low',callDate:'2026-10-30'};
  const actual=engine.query(args);
  assert.deepEqual(actual.samples,[
    {timestamp:'2026-10-30T10:00:01+09:00',pot:'38509_77756',earfcn:3743,technology:'LTE'},
    {timestamp:'2026-10-30T10:00:02+09:00',pot:null,earfcn:3743,technology:'LTE'},
  ]);
  assert.throws(()=>engine.query({...args,callDate:'2026-10-29'}));
  assert.throws(()=>engine.query({...args,sourceRevision:'stale'}));
});
test('summary matches original grade/hourly/analytics semantics including negative QoE and ambiguous chronology',()=>{
  const summary=engine.query({op:'summary',scope});
  const effective=load(path.resolve('lib/analyst/derived-qoe.ts')).effectiveCallQoe;
  const normalized={...overview,calls:overview.calls.map(c=>({...c,qoe:effective(c)}))};
  assert.deepEqual(summary.grades,load(path.resolve('lib/analyst/quality-proposal-metrics.ts')).calculateProposalGrades(normalized,'00:00','23:59'));
  assert.deepEqual(summary.hourly,load(path.resolve('lib/analyst/quality-proposal-four.ts')).buildFourthHourly(normalized,'00:00','23:59'));
  const expected=load(path.resolve('lib/analyst/overview-analytics.ts')).getOverviewAnalytics(normalized.calls,'qoe',3);for(const row of expected.experience)row.customerIds=[];
  assert.deepEqual(summary.analytics,expected);assert.deepEqual([summary.mapped.G,summary.mapped.T,summary.mapped.U],[1,1,2]);assert.equal(summary.customerCount,4);
  const focused=engine.query({op:'summary',scope:{...scope,district:'dong'}});assert.equal(focused.mapped.U,1);assert.equal(focused.regions.length,2,'region ranks precede district focus');
  assert.equal(engine.query({op:'summary',scope:{...scope,hour:10,band:'good'}}).grades.evaluated,summary.grades.evaluated,'map filters do not alter chart denominators');
});
test('calls paginate the exact original records, distinguish explicit grade and default located poor, and retain final minute',()=>{
  const defaults=engine.query({op:'calls',scope,page:0,pageSize:25});assert.deepEqual(defaults.rows.map(c=>c.id),['a:drop','a:low']);
  const all=engine.query({op:'calls',scope,allCalls:true,page:0,pageSize:25});assert.equal(all.total,overview.calls.length);assert.ok(all.rows.some(c=>c.id==='a:missing'));
  const healthy=engine.query({op:'calls',scope:{...scope,band:'good'},page:0,pageSize:25});assert.deepEqual(healthy.rows.map(c=>c.id),['b:healthy']);
  assert.equal(healthy.rows[0].qoe,4.2606020000000004,'non-Drop original floating-point MOS is preserved verbatim');
  const detail=engine.query({op:'calls',scope:{...scope,customerIds:['a']},allCalls:true,callId:'drop',page:0,pageSize:25});assert.equal(detail.locations[0].byeRuId,'ru');assert.equal(detail.rows[0].mos,4);assert.equal(detail.rows[0].qoe,1.5);
});
test('customer picker keeps original numbers and raw MOS poor criterion, with no opaque number substitution',()=>{
  const rows=engine.query({op:'customers',scope,query:'',filter:'all',page:0}).rows;
  const expected=load(path.resolve('lib/analyst/quality-customer-picker.ts')).buildQualityCustomerRows(dataset,overview,'00:00','23:59');
  assert.deepEqual(rows.map(r=>[r.customerId,r.sourceContractId,r.totalCalls,r.poorCalls,r.locatedCalls]),expected.map(r=>[r.customerId,r.sourceContractId,r.totalCalls,r.poorCalls,r.locatedCalls]));
  assert.equal(engine.query({op:'customers',scope,query:'ambiguous',filter:'all',page:0}).total,0);
  assert.deepEqual(engine.query({op:'customer',customerId:'a'}).dataset.days,dataset.days);
  assert.deepEqual(engine.query({op:'meta'}).dataset.customers,[]);
  const selected=engine.query({op:'customers',scope,query:'',filter:'all',page:0,selectedIds:['a','no-calls'],selectedOnly:true});assert.deepEqual(selected.rows.map(r=>r.customerId),['a']);assert.deepEqual([selected.selection.count,selected.selection.withoutCalls,selected.selection.totalCalls],[2,1,3]);
});
test('screening global report and ranking match existing derived QoE business rules',()=>{
  const response=engine.query({op:'screening',scope,query:'',filter:'all',sort:'poor',page:0});
  const source=engine.screeningSource(scope);
  const expected=load(path.resolve('lib/analyst/customer-screening.ts')).aggregateScreening(source,scope.dateStart,scope.dateEnd,scope.from,scope.to);
  const {rows,...report}=expected;assert.deepEqual(response.report,report);
  assert.deepEqual(response.rows.map(r=>({...r,badCalls:[]})),rows.map(r=>({...r,badCalls:[]})));
  const filtered=engine.query({op:'screening',scope,query:'0000123',filter:'all',sort:'poor',page:0});assert.equal(filtered.total,1);assert.deepEqual(filtered.report,report);
  for(const sort of ['drop','repeat']){
    const ranked=engine.query({op:'screening',scope,query:'',filter:'all',sort,page:0});
    const original=[...rows].sort((a,b)=>sort==='drop'?b.drop-a.drop||b.poor-a.poor||b.dropRate-a.dropRate:b.repeatedDays-a.repeatedDays||b.poor-a.poor||b.sameAreaDays-a.sameAreaDays);
    assert.deepEqual(ranked.rows.map(r=>r.id),original.map(r=>r.id),'original '+sort+' ranking and stable base order');
  }
});
test('queries fail closed for invalid scope, stale revisions and unsafe identifiers',()=>{
  assert.throws(()=>engine.query({op:'summary',sourceRevision:'stale',scope}),/revision/i);
  for(const extra of [{dateStart:'2026-02-30'},{from:'24:00'},{from:'23:59',to:'00:00'},{hour:24},{customerIds:['x'.repeat(501)]},{evidence:'fake'}])assert.throws(()=>engine.query({op:'summary',scope:{...scope,...extra}}),/invalid/i);
  assert.throws(()=>engine.query({op:'unknown',scope}),/operation/i);
  assert.equal(engine.query({op:'customer',contract:"' OR 1=1 --"}).dataset.customers.length,0);
});
test('multi-day scopes count each original call once and repeated days separately from repeated calls',()=>{
  const multi={...scope,dateStart:'2026-10-29'};
  const summary=engine.query({op:'summary',scope:multi});assert.equal(summary.analytics.total,totalFixtureCalls);assert.equal(summary.customerCount,4);assert.deepEqual([summary.mapped.G,summary.mapped.T],[2,1]);
  const screening=engine.query({op:'screening',scope:multi,filter:'all',sort:'poor',page:0});assert.equal(screening.report.repeat,1);assert.equal(screening.report.locationRepeat,1);
  const a=screening.rows.find(row=>row.id==='a');assert.equal(a.repeatedDays,2);assert.deepEqual(a.dailyPoor,[1,2]);
  const one=engine.query({op:'screening',scope,filter:'all',sort:'poor',page:0});assert.equal(one.report.repeat,0);
});
test('screening selection stays inside the currently filtered ranking',()=>{
  const response=engine.query({op:'screening',scope,query:'',filter:'drop',sort:'poor',page:0,selectedId:'ambiguous'});
  assert.equal(response.selected,null);assert.equal(response.rows.length,0);
  const searched=engine.query({op:'screening',scope,query:'0000123',filter:'all',sort:'poor',page:0,selectedId:'slow'});
  assert.equal(searched.selected?.id,'a');
});
test('map and routes preserve original GPS/BYE evidence and CSV streams the full filtered population',()=>{
  const map=engine.query({op:'map',scope});assert.deepEqual(map.overview.callLocations.map(p=>p.callId).sort(),['a:drop','a:low']);
  const gnss=map.overview.callLocations.find(p=>p.callId==='a:low');assert.equal(gnss.lat,37);assert.equal(gnss.gpsStation.baseStationId,'real-station');
  const rough=map.overview.callLocations.find(p=>p.callId==='a:drop');assert.equal(rough.positionQuality,'three-site-rough');assert.equal(rough.byeStationLat,37.1);
  const exact=engine.query({op:'calls',scope,allCalls:true,callId:'drop',page:0,pageSize:25});assert.equal(exact.locations[0].evidence,'bye-cell');assert.equal(exact.roughLocations[0].evidence,'estimated');
  const response=engine.query({op:'screening-map',scope,query:'',filter:'all',sort:'poor'});
  const source=engine.screeningSource(scope),helper=load(path.resolve('lib/analyst/customer-screening-map.ts'));
  assert.deepEqual(response.geography,helper.buildScreeningGeography(source,scope.dateStart,scope.dateEnd,scope.from,scope.to));
  const routes=engine.query({op:'routes',scope,customerIds:['a'],day:'all'}).routes;
  assert.deepEqual(routes,[load(path.resolve('lib/analyst/customer-screening-route.ts')).buildCustomerRoute(source,'a',scope.dateStart,scope.dateEnd,scope.from,scope.to)]);
  const csv=[...engine.exportCsv({sourceRevision:revision,scope:{...scope,band:'poor'}})].join('');assert.equal(csv.split('\r\n').length,8);assert.match(csv,/"a:drop"/);assert.doesNotMatch(csv,/"b:healthy"/);
  assert.match(csv,/"RTP Loss 원본","Jitter 원본","RSRP dBm","SINR dB"/);
  const originalMetrics=csv.split('\r\n').find(line=>line.includes('"a:low"')).split('","');
  assert.deepEqual(originalMetrics.slice(8,12),['0.75','17','-91','9']);
});
test('map omits optional station coordinates until the station layer is requested',()=>{
  const rich=engine.query({op:'map',scope});
  const light=engine.query({op:'map',scope,includeStations:false});
  const stationFields=['gpsStation','usedStations','byeStationLat','byeStationLon'];
  assert.deepEqual(light.overview.calls,rich.overview.calls);
  for(const point of light.overview.callLocations){
    for(const field of stationFields)assert.equal(Object.hasOwn(point,field),false);
    const original=rich.overview.callLocations.find(p=>p.callId===point.callId);
    const expected={...original};for(const field of stationFields)delete expected[field];
    assert.deepEqual(point,expected,'all original handset position and evidence fields remain');
  }
  const layer=engine.query({op:'map-stations',scope});
  const helper=load(path.resolve('lib/analyst/quality-map-stations.ts'));
  assert.deepEqual(layer.stations,helper.relatedStationMarkersForMap(rich.overview.callLocations));
  assert.equal(layer.stationCount,helper.countStationMapPositions(layer.stations));
  assert.equal(light.stationCount,layer.stationCount);
  for(const point of light.overview.callLocations){
    assert.deepEqual({...point,...layer.locations.find(p=>p.callId===point.callId)},rich.overview.callLocations.find(p=>p.callId===point.callId));
  }
  const gnss=engine.query({op:'map-stations',scope:{...scope,evidence:'gnss'}});
  assert.equal(gnss.locations.length,1);assert.equal(gnss.locations[0].callId,'a:low');
  assert.deepEqual(engine.query({op:'map-stations',scope:{...scope,district:'unknown'}}).stations,[]);
});
test('HTTP adapter serves only its API, validates bodies/revisions, and keeps DB outside public',async()=>{
  const http=require('node:http'),{createVoiceQueryHandler}=require('../voice-query-api.cjs');
  const handler=createVoiceQueryHandler({root:fixture,publicDir:path.join(fixture,'public')});
  const server=http.createServer((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{const response=await fetch(base+'/qoe/api/voice/meta'),body=await response.json();assert.equal(body.sourceRevision,revision);assert.equal(body.totalCalls,totalFixtureCalls);assert.deepEqual(body.dataset.days,[]);
    const stale=await fetch(base+'/qoe/api/voice/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'summary',sourceRevision:'stale',scope})});assert.equal(stale.status,409);
    const bad=await fetch(base+'/qoe/api/voice/query',{method:'POST',headers:{'Content-Type':'application/json'},body:'not-json'});assert.equal(bad.status,400);
    const foreign=await fetch(base+'/qoe/api/voice/query',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify({op:'summary',scope})});assert.equal(foreign.status,403);
    const csv=await fetch(base+'/qoe/api/voice/export',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({query:JSON.stringify({sourceRevision:revision,scope})})});assert.equal(csv.status,200);assert.match(await csv.text(),/a:low/);
    assert.equal((await fetch(base+'/other')).status,404);
  }finally{await handler.close();await new Promise(resolve=>server.close(resolve));}
});
