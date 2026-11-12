// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {buildQualityPresentationCandidates}=load('lib/analyst/quality-candidate-presentation.ts');
const {combineDateOverviews}=load('lib/analyst/date-range.ts');
const {buildCandidateRoughPoints}=load('lib/analyst/quality-candidate-rough-points.ts');
const {matchCandidateRoughPoints}=load('lib/analyst/quality-candidate-rough-membership.ts');
const {selectCandidateStationSites,stationTowerSvg,DEFAULT_STATION_OPTIONS}=load('lib/analyst/station-map-presentation.ts');
const {relatedStationMarkersForMap,detailStationMarkersForMap,countStationMapPositions,overlayGpsMapStations}=load('lib/analyst/quality-map-stations.ts');
const {buildImprovedView}=load('lib/analyst/improved-overview.ts');
const {overlayThreeSiteRough}=load('lib/analyst/three-site-rough.ts');
const dates=[26,27,28,29,30].map(i=>'2026-10-'+i);
const overview=combineDateOverviews(dates.map(d=>historicalJson('../../public/analyst-overview/MDT/'+d+'.json')));
const parts=dates.map(d=>historicalJson('../../public/three-site-rough/'+d+'.json'));
const scope={sourceRevision:overview.sourceRevision,dateStart:dates[0],dateEnd:dates.at(-1),from:'00:00',to:'23:59',policy:'strict-3-site-v1'};
const idx=historicalJson('../../public/quality-improvement-full/index.json');
const ent=idx.entries.find(e=>e.scope.dateStart===scope.dateStart&&e.scope.dateEnd===scope.dateEnd);
assert(ent);
const report=historicalJson('../../public/quality-improvement-full/'+ent.path);
const candidates=buildQualityPresentationCandidates(report,null);
const rough=matchCandidateRoughPoints(candidates,buildCandidateRoughPoints(overview,scope,parts));
const LTE=historicalJson('../../public/station-catalog.json'), NR=historicalJson('../../public/nr-station-catalog.json');
const list=(range='inside',rat='LTE',highlightRelated=true,selectedId=candidates[0].id)=>selectCandidateStationSites(candidates,[LTE,NR],{range,rat,highlightRelated},selectedId,rough);

test('real 8-candidate LTE and NR sites are grouped by coordinate, not by every RU cell',()=>{
 const sites=list();
 assert(sites.length>0&&sites.length<100);
 assert(sites.every(p=>p.technology==='LTE'&&p.cells.length>0));
 assert.equal(new Set(sites.map(p=>p.id)).size,sites.length);
 assert.equal(sites.filter(p=>p.matchedCandidateIds.includes(candidates[0].id)).length,6);
 assert.equal(sites.filter(p=>p.matchedCandidateIds.includes(candidates[1].id)).length,11);
 assert.equal(sites.filter(p=>p.matchedCandidateIds.includes(candidates[5].id)).length,0);
 const nr=list('inside','NR',false);
 assert.equal(nr.filter(p=>p.matchedCandidateIds.includes(candidates[0].id)).length,4);
 assert(nr.every(p=>p.technology==='NR'));
 const both=list('inside','all');
 assert(both.some(p=>p.technology==='LTE')&&both.some(p=>p.technology==='NR'));
});
test('inside and 500m options obey candidate geometry and off hides all stations',()=>{
 const inside=list('inside','LTE',false),near=list('near','LTE',false);
 assert(near.length>inside.length);
 assert.deepEqual(list('off','all'),[]);
 assert(near.every(s=>s.matchedCandidateIds.length>0));
 assert(inside.every(s=>s.matchedCandidateIds.length>0));
});
test('selected rough point highlights 3 input sites even if their towers lie beyond candidate circle',()=>{
 const sites=list();
 const linked=sites.filter(s=>s.linkedToSelected);
 assert(linked.length>=3);
 assert(linked.every(s=>s.technology==='LTE'));
 assert(linked.every(s=>s.cells.some(c=>c.related&&c.rsrpDbm!=null)));
 const without=list('inside','LTE',false);
 assert.equal(without.some(s=>s.linkedToSelected),false);
 assert(without.length<=sites.length);
});
test('overview keeps low-QoE GPS/rough 237 and includes their related towers, never standalone BYE locations',()=>{
 const composite={...parts[0],date:overview.date,points:parts.flatMap(p=>p.points)};
 const ov=overlayThreeSiteRough(overview,composite,true);
 const view=buildImprovedView(ov,{from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all',band:'poor'});
 const stationRows=relatedStationMarkersForMap(view.locations);
 assert.equal(view.locations.filter(x=>x.evidence==='gnss').length,131);
 assert.equal(view.locations.filter(x=>x.evidence==='estimated').length,106);
 assert(stationRows.length>0);
 assert(stationRows.some(s=>s.mapRelations.includes('triangulation-input')));
 const gps=view.locations.filter(p=>p.evidence==='gnss');
 const gpsStations=relatedStationMarkersForMap(gps);
 assert(gpsStations.length>0,'GPS calls must contribute connected stations');
 assert(gpsStations.every(s=>s.mapRelations.includes('gps-call-bye')));
 const onlyBye=view.locations.filter(p=>p.evidence==='bye-cell');
 assert.deepEqual(relatedStationMarkersForMap(onlyBye),[]);
 const p=view.locations.find(p=>p.positionQuality==='three-site-rough');
 assert(p);
 assert.equal(detailStationMarkersForMap(p).filter(s=>s.inventorySource.includes('MDT')).length,3);
});

test('GPS observation stations take priority, fallback towers keep BYE provenance, and map counts unique positions',()=>{
 const station={baseStationId:'gps-ru',cellId:'gps-cell',latitude:37.5,longitude:127.05,
   frequency:1550,technology:'LTE',isVirtual:false,pci:123,inventorySource:'LTE registry'};
 const gps={callId:'gps',areaId:'dong',lat:37.501,lon:127.051,evidence:'gnss',start:'12:00',mos:2,
   observedAt:'2026-10-30T03:00:00Z',gpsStation:station,
   byeRuId:'bye-ru',byeCellId:'bye-cell',byeStationLat:37.6,byeStationLon:127.1,byeTechnology:'NR',byePci:12};
 const rough={...gps,callId:'rough',evidence:'estimated',gpsStation:undefined,
   usedStations:[{ruId:'rough-ru',cellId:'rough-cell',lat:37.5,lon:127.05,rsrpDbm:-100}]};
 const rows=relatedStationMarkersForMap([gps,rough,gps]);
 assert.equal(rows.length,2,'deduplicate a repeated station/cell');
 assert.equal(countStationMapPositions(rows),1,'co-located cells draw one tower icon');
 assert(rows.some(s=>s.baseStationId==='gps-ru'&&s.mapRelations.includes('gps-observation')));
 assert(!rows.some(s=>s.baseStationId==='bye-ru'),'do not replace known GPS-time station with BYE');
 const fallback=relatedStationMarkersForMap([{...gps,gpsStation:undefined}]);
 assert.equal(fallback[0].technology,'NR');
 assert.equal(fallback[0].pci,12);
 assert.deepEqual(fallback[0].mapRelations,['gps-call-bye']);
 assert.deepEqual(relatedStationMarkersForMap([{...gps,evidence:'bye-cell',gpsStation:undefined}]),[]);
 assert.deepEqual(relatedStationMarkersForMap([{...gps,gpsStation:undefined,byeStationLat:NaN}]),[]);
});

test('GPS station sidecar must match source revision, date, call and exact observation time',()=>{
 const gps={callId:'gps',evidence:'gnss',observedAt:'2026-10-30T03:00:00Z'};
 const original={date:'2026-10-30',sourceRevision:'rev',callLocations:[gps]};
 const station={baseStationId:'ru',cellId:'cell',latitude:37.5,longitude:127.05,frequency:null,isVirtual:false};
 const sidecar={schemaVersion:'gps-map-stations-v1',date:original.date,sourceRevision:'rev',
   records:{gps:{observedAt:'2026-10-30T12:00:00+09:00',station}}};
 assert.equal(overlayGpsMapStations(original,sidecar).callLocations[0].gpsStation.baseStationId,'ru');
 assert.equal(original.callLocations[0].gpsStation,undefined,'overlay must preserve source records');
 for(const changed of [{sourceRevision:'stale'},{date:'2026-10-29'},
   {records:{gps:{observedAt:'2026-10-30T03:00:01Z',station}}},
   {records:{gps:{observedAt:gps.observedAt,station:{...station,latitude:NaN}}}}])
   assert.equal(overlayGpsMapStations(original,{...sidecar,...changed}).callLocations[0].gpsStation,undefined);
});

test('generated GPS stations reconcile to exact original MDT rows without changing positions or metrics',()=>{
 const manifest=historicalJson('../../public/voice-1030.json');
 const partitions=new Map();
 for(const date of dates){
   const source=historicalJson('../../public/analyst-overview/MDT/'+date+'.json');
   const sidecar=historicalJson('../../public/gps-map-stations/'+date+'.json');
   const enriched=overlayGpsMapStations(source,sidecar);
   const calls=new Map(source.calls.map(c=>[c.id,c]));
   const entries=new Map(manifest.days.filter(d=>d.date===date).map(d=>[d.customerId,d]));
   assert.equal(enriched.calls,source.calls);
   assert.equal(enriched.callLocations.length,source.callLocations.length);
   assert.equal(Object.keys(sidecar.records).length,sidecar.stats.matched);
   assert.equal(sidecar.stats.matched+sidecar.stats.missing,sidecar.stats.gps);
   for(const p of enriched.callLocations){
     if(!p.gpsStation)continue;
     const original=source.callLocations.find(old=>old.callId===p.callId);
     assert.equal(p.lat,original.lat);assert.equal(p.lon,original.lon);
     const call=calls.get(p.callId),entry=entries.get(call.customerId);
     let partition=partitions.get(entry.dataPath);
     if(!partition){partition=historicalJson('../../public/'+entry.dataPath);partitions.set(entry.dataPath,partition);}
     const row=partition.samples.find(r=>r[19]===call.rawCallId&&Date.parse(r[21]?.timestamp)===Date.parse(p.observedAt));
     assert(row,'GPS station must belong to the same call and exact observation time');
     assert.equal(p.gpsStation.baseStationId,row[21].baseStationId);
     assert.equal(p.gpsStation.cellId,row[21].cellId);
     assert(partition.baseStations.some(s=>s.baseStationId===p.gpsStation.baseStationId&&
       s.cellId===p.gpsStation.cellId&&s.latitude===p.gpsStation.latitude&&s.longitude===p.gpsStation.longitude));
   }
 }
});
test('station icon is visually distinct, reusable across candidate, customer and PCI catalog maps',()=>{
 for(const type of ['standard','selected','linked','nearby']){
  const svg=stationTowerSvg(type);
  assert(svg.startsWith('<svg'));
  assert(svg.includes('<rect')&&svg.includes('<path'));
  assert(!svg.includes('<script'));
 }
 const catalogMap=historicalRead('components/analyst/analyst-map.tsx','utf8');
 assert(catalogMap.includes("stationTowerSvg(isByeSite?'linked':'standard'"));
 const candidateMap=historicalRead('components/analyst/improvement-candidate-map.tsx','utf8');
 assert(candidateMap.includes('stationTowerSvg(variant,23)'));
 assert(candidateMap.includes('data-station-site'));
 assert(candidateMap.includes('MDT RSRP'));
 assert(candidateMap.includes('기지국 등록 위치는 단말 위치'));
});
test('all three quality-map surfaces include correct tower overlays and explicit toggles',()=>{
 const quality=historicalRead('components/analyst/quality-proposal-four.tsx','utf8');
 const customer=historicalRead('components/analyst/contract-workspace.tsx','utf8');
 const panel=historicalRead('components/analyst/quality-improvement-candidate-panel.tsx','utf8');
 const dbscan=historicalRead('components/analyst/quality-two-candidate-workspace.tsx','utf8');
 const alt=historicalRead('components/analyst/quality-model-alternative-workspace.tsx','utf8');
 assert(quality.includes('stations={currentStations}'));
 assert(quality.includes('stations={detailStationMarkersForMap(selectedLocation)}'));
 assert(quality.includes('showStations={showMapStations&&improvementTwo&&currentStations.length>0}'));
 assert(customer.includes('showStations={stations}'));
 assert(panel.includes('stationLayer={stationLayer}'));
 assert(dbscan.includes('StationLayerControls layer={stationLayer}'));
 assert(alt.includes('StationLayerControls layer={stationLayer}'));
 const altCss=historicalRead('components/analyst/quality-model-alternative.module.css','utf8');
 assert(altCss.includes('.mapView{display:flex;flex-direction:column;min-height:0;overflow:hidden}'));
 assert(altCss.includes('.mapView>div:last-child{height:auto;min-height:0;flex:1 1 0}'));
});
