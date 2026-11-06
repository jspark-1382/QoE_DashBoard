/* eslint-disable @typescript-eslint/no-require-imports */
// Validates the published 2026-10-30 administrative-dong SHP overlay and joins.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const publicRoot = process.env.QOE_PUBLIC_DIR ? path.resolve(process.env.QOE_PUBLIC_DIR) : path.join(root,'public');
const source = path.join(publicRoot, 'voice-1030.json');
const overviewPath = path.join(publicRoot, 'analyst-overview/MDT/2026-10-30.json');

test('SHP-based administrative-dong overlay is complete, projected, and GNSS provenance is preserved', () => {
  const dataset = JSON.parse(fs.readFileSync(source, 'utf8'));
  const overview = JSON.parse(fs.readFileSync(overviewPath, 'utf8'));
  assert.equal(overview.sourceRevision, dataset.meta.revision);
  assert.equal(overview.spatialUnit, 'administrative-dong');
  assert.equal(overview.representativeLocationBasis, 'cdr-end-nearest-or-bye-cell-site');
  assert.equal(overview.representativeMaxAgeSeconds, 180);
  assert.equal(overview.representativeAfterEndToleranceSeconds, 1);
  assert.equal(overview.boundarySource, 'BND_ADM_DONG_PG.shp');
  assert.match(overview.boundaryBaseDate, /^20\d{6}$/);
  assert(overview.administrativeDongs.length > 0);
  assert(overview.cells.length > 0);
  const regions = new Map(overview.administrativeDongs.map((region) => [region.id,region]));
  for(const region of regions.values()){
    assert.match(region.id, /^adm:\d{8}$/);
    assert(region.label && !region.label.startsWith('grid60:'));
    assert(Number.isFinite(region.lat) && Number.isFinite(region.lon));
    assert(region.lat > 33 && region.lat < 39.8 && region.lon > 124 && region.lon < 132);
    assert(region.coordinates.length >= 1);
    for(const multi of region.coordinates){
      assert(multi.length >= 1);
      for(const ring of multi) {
        assert(ring.length >= 4);
        assert.deepEqual(ring[0],ring.at(-1));
        for(const [lon,lat] of ring){
          assert(lon >= 124 && lon <= 132 && lat >= 33 && lat <= 39.8,
            'WGS84 geometry must be [longitude, latitude] in Korea');
        }
      }
    }
  }
  const callsById = new Map(overview.calls.map((call) => [call.id,call]));
  let located = 0, verified = 0, estimated = 0, byeSites = 0;
  for(const call of callsById.values()){
    assert(!call.gridIds.some((key) => key.startsWith('grid60:')));
    for(const key of call.gridIds) assert(regions.has(key), 'call points to a real ADM_CD boundary');
    assert(call.gridIds.length <= 1, 'BYE-nearest coordinate assigns at most one dong per call');
    if(call.gridIds.length){
      located++;
      if(call.spatialEvidence === 'gnss') verified++;
      else if(call.spatialEvidence === 'estimated') estimated++;
      else if(call.spatialEvidence === 'bye-cell') byeSites++;
      else assert.fail('located call must identify measured or estimated evidence');
    } else assert.equal(call.spatialEvidence,'unavailable');
  }
  for(const cell of overview.cells){
    assert(regions.has(cell.id));
    assert.equal(cell.gnssCalls+cell.estimatedCalls+(cell.byeCellCalls??0),cell.callIds.length);
    for(const id of cell.callIds) {
      const call = callsById.get(id);
      assert(call);
      assert(call.gridIds.includes(cell.id));
    }
  }
  // Every pin must point to a real source call and to its actual SHP dong.
  // Never substitute a district centroid for the original matched coordinate.
  assert(Array.isArray(overview.callLocations));
  assert.equal(overview.callLocations.length, located,
    'exactly one representative marker per located call');
  const locatedMarkerCalls = new Set();
  for(const marker of overview.callLocations){
    const call=callsById.get(marker.callId);
    assert(call, 'individual occurrence marker must retain original call identity');
    assert(call.gridIds.includes(marker.areaId),'marker is in a real matched dong');
    assert(regions.has(marker.areaId));
    assert.equal(marker.evidence,call.spatialEvidence);
    // Representative location is selected irrespective of MOS.
    assert.equal(marker.mos,call.mos,'MOS score must remain the original CDR value');
    if(marker.evidence==='bye-cell'){
      assert.equal(marker.representativeBasis,'bye-cell-site');
      assert.equal(marker.positionQuality,'bye-cell-site');
      assert(marker.byeCellId && marker.byeRuId);
      assert.equal(marker.byeCellId,call.endCellId);
      assert.equal(marker.observedAt,null);
      assert.equal(marker.secondsBeforeEnd,null);
      assert.equal(marker.usedSiteCount,null);
      assert.match(marker.byeInventory,marker.byeTechnology==='NR'?/수도권_5G_\d{6}/:/수도권_LTE_\d{6}/);
    }else{
      assert.equal(marker.representativeBasis,'cdr-end-nearest');
      assert(typeof marker.observedAt==='string');
      assert(typeof marker.cdrEndAt==='string');
      assert(marker.secondsBeforeEnd >= -1 && marker.secondsBeforeEnd <= overview.representativeMaxAgeSeconds);
      assert(Math.abs(
        (Date.parse(marker.cdrEndAt)-Date.parse(marker.observedAt))/1000-marker.secondsBeforeEnd
      )<.002,'published sample-to-CDR-end lag must be accurate');
    }
    assert.equal(marker.start,call.start);
    assert(marker.lat >= 33 && marker.lat <= 39.8 && marker.lon >= 124 && marker.lon <= 132);
    const district=regions.get(marker.areaId);
    assert.notEqual(marker.lat,district.lat,'never use district representative centroid as occurrence position');
    locatedMarkerCalls.add(marker.callId);
  }
  assert.equal(locatedMarkerCalls.size,located);
  assert.equal(locatedMarkerCalls.size,overview.administrativeMappingAudit.distinctMarkerCallIds);
  assert.equal(overview.callLocations.length,overview.administrativeMappingAudit.visibleCallMarkers);
  const gaepo1=overview.callLocations.filter((marker)=> marker.areaId==='adm:11230680');
  assert(gaepo1.length > 0,'Gaepo 1-dong must have actual poor-MOS call occurrence points');
  const a = overview.administrativeMappingAudit;
  assert.equal(located, a.locatedCalls);
  assert.equal(verified,a.locatedGnssCalls);
  assert.equal(estimated,a.locatedEstimatedCalls);
  assert.equal(byeSites,a.locatedByeCellCalls);
  assert.equal(verified+estimated+byeSites,located);
  assert.equal(a.assignedSamples+(a.ambiguousBoundarySamples??0)+(a.outsideBoundarySamples??0),
    a.selectedEndLocations+a.selectedByeCellSites,'every selected primary or BYE Cell point is assigned or excluded by SHP');
  assert.equal(a.freshEligibleSamples+a.staleAtEndSamples+
    (a.observationsAfterEndExcluded??0)+(a.missingEndOrSampleTime??0),
    a.verifiedSamples+(a.estimatedSamples??0),
    'all eligible input coordinate samples are evaluated for end-time freshness');
  assert.equal(a.positionCandidateCalls,a.selectedEndLocations+a.callsWithStaleOrNoEndPosition);
  assert.equal(a.visibleCallMarkers,a.locatedCalls);
  assert.equal(new Set(overview.callLocations.map(p=>p.callId)).size,located);
  assert.equal(a.selectedEndLocations,a.locatedGnssCalls+a.locatedEstimatedCalls);
  assert.equal(a.selectedByeCellSites,a.locatedByeCellCalls);
  assert.equal(a.noUniqueByeCellFallbackCalls,a.unlocatedCalls);
  const inventoryNames=[['LTE','station-catalog.json'],
    ...(dataset.meta.byeStationInventories?.some(item=>item.technology==='NR')?[['NR','nr-station-catalog.json']]:[])];
  const candidates=new Map();
  for(const [technology,filename] of inventoryNames){
    const inventory=JSON.parse(fs.readFileSync(path.join(publicRoot,filename),'utf8'));
    for(const [ru,cell,,lat,lon] of inventory.rows){
      const sites=candidates.get(cell)??new Set();
      sites.add(JSON.stringify([technology,ru,lat,lon]));candidates.set(cell,sites);
    }
  }
  const requested=new Set(overview.calls.map(call=>call.endCellId));
  assert.equal(a.byeCatalog_ambiguousCells,[...requested].filter(cell=>(candidates.get(cell)?.size??0)>1).length);
  const quality = overview.callLocations.reduce((result,point)=>{
    result[point.positionQuality]=(result[point.positionQuality]??0)+1;
    if(point.evidence==='estimated'){
      assert(point.modelUncertaintyM==null||point.modelUncertaintyM>=0);
      assert(point.usedSiteCount>=3,'radio UE position requires 3+ independent sites');
      assert.equal(point.estimationMethod,'MULTILATERATION');
      assert.equal(point.positionQuality,'trilateration-reviewable');
    }else if(point.evidence==='gnss'){
      const expected=point.secondsBeforeEnd>60?'gnss-last-known':'gnss-observed';
      assert.equal(point.positionQuality,expected);
      assert.equal(point.referenceBasis,expected==='gnss-last-known'?'last-known-gnss':'direct-gnss');
      assert(point.possibleRadiusM>=250);
      if(point.byeCellId){
        assert(point.byeRuId && Number.isFinite(point.byeStationLat) && Number.isFinite(point.byeStationLon));
        assert.equal(point.byeCellId,callsById.get(point.callId).endCellId);
      }
    }else{
      assert.equal(point.evidence,'bye-cell');
      assert.equal(point.positionQuality,'bye-cell-site');
    }
    return result;
  },{});
  assert.deepEqual(quality,{
    ...((a.locatedByeCellCalls??0)>0?{'bye-cell-site':a.locatedByeCellCalls}:{}),
    ...((a.locatedGnssCalls??0)>(a.locatedGnssLastKnownCalls??0)
      ? {'gnss-observed':a.locatedGnssCalls-(a.locatedGnssLastKnownCalls??0)}:{}),
    ...((a.locatedGnssLastKnownCalls??0)>0?{'gnss-last-known':a.locatedGnssLastKnownCalls}:{}),
    ...((a.locatedEstimatedCalls??0)>0?{'trilateration-reviewable':a.locatedEstimatedCalls}:{}),
  });
  assert.equal(a['selectedQuality_trilateration-reviewable']??0,a.locatedEstimatedCalls);
  assert.equal(a['selectedQuality_bye-cell-site'],a.locatedByeCellCalls);
  assert.equal(located+a.unlocatedCalls,overview.calls.length);
  assert.equal(overview.calls.length,37731);
  assert(regions.has('adm:11230710'), 'Gaepo 4-dong polygon from real Seoul SHP should exist');
});

test('published NR BYE sites retain exact source RAT, cell, registered coordinate and provenance',()=>{
  const dataset=JSON.parse(fs.readFileSync(source,'utf8'));
  const overview=JSON.parse(fs.readFileSync(overviewPath,'utf8'));
  const declared=dataset.meta.byeStationInventories;
  assert(declared?.some(item=>item.technology==='NR'),'NR inventory participates in the source revision');
  const registry=new Map();
  for(const [technology,filename] of [['LTE','station-catalog.json'],['NR','nr-station-catalog.json']]){
    const catalog=JSON.parse(fs.readFileSync(path.join(publicRoot,filename),'utf8'));
    const inventory=declared.find(item=>item.technology===technology);
    assert.equal(catalog.source.file,inventory.file);assert.equal(catalog.source.sha256,inventory.sha256);
    for(const [ru,cell,pci,lat,lon] of catalog.rows)registry.set(JSON.stringify([technology,ru,cell]),{pci,lat,lon,inventory});
  }
  const calls=new Map(overview.calls.map(call=>[call.id,call]));
  const nr=overview.callLocations.filter(point=>point.evidence==='bye-cell'&&point.byeTechnology==='NR');
  assert(nr.length>0,'5G BYE is present in the quality overview, beyond the station search page');
  for(const point of overview.callLocations.filter(point=>point.evidence==='bye-cell')){
    const call=calls.get(point.callId);
    assert.equal(point.byeCellId,call.endCellId);
    if(call.endRat)assert.equal(point.byeTechnology,call.endRat);
    const exact=registry.get(JSON.stringify([point.byeTechnology,point.byeRuId,point.byeCellId]));
    assert(exact,'BYE must retain the complete technology/RU/Cell identity');
    assert.equal(point.lat,exact.lat);assert.equal(point.lon,exact.lon);
    assert.equal(point.byePci,exact.pci);
    assert.equal(point.byeInventorySha256,exact.inventory.sha256);
    assert.equal(point.byeInventory,exact.inventory.file);
  }
});
