/* eslint-disable @typescript-eslint/no-require-imports -- Exercises TypeScript through the shared CJS loader. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const {byeSelectionLabel,byeSelectionDescription}=load('lib/analyst/bye-selection.ts');
const {overlayThreeSiteRough}=load('lib/analyst/three-site-rough.ts');

test('BYE selection labels distinguish MDT evidence from inventory-order fallback',()=>{
  assert.equal(byeSelectionLabel({byeSelectionMethod:'mdt',byeCandidateCount:3}),'MDT 장비 일치 · 후보 3개');
  const selected={byeSelectionMethod:'mdt',byeCandidateCount:3,byeSelectionDeltaSeconds:-0.06};
  assert.match(byeSelectionDescription(selected),/종료 0.1초 후 MDT/);
  assert.match(byeSelectionDescription({byeSelectionMethod:'mdt',byeSelectionDeltaSeconds:4.1}),/종료 4.1초 전 MDT/);
  assert.equal(byeSelectionLabel({byeSelectionMethod:'first',byeCandidateCount:2}),'첫 후보 선택 · 후보 2개');
  assert.match(byeSelectionDescription({byeSelectionMethod:'first',byeCandidateCount:2}),/기지국 목록 순서/);
  assert.equal(byeSelectionLabel({byeSelectionMethod:'unique',byeCandidateCount:1}),'Cell 단일 후보 · 후보 1개');
  assert.equal(byeSelectionLabel({}),'BYE 기지국 참고','legacy data must not imply unique mapping');
});

test('rough overlay preserves selected BYE RU provenance without moving actual GNSS',()=>{
  const fields={byeSelectionMethod:'mdt',byeCandidateCount:3,byeSelectionDeltaSeconds:4.1,byeSelectionMdtRu:'RU-2'};
  const bye={callId:'a',areaId:'dong',lat:37.48,lon:127.06,evidence:'bye-cell',byeCellId:'8',byeRuId:'RU-2',...fields};
  const gnss={callId:'b',areaId:'dong',lat:37.49,lon:127.07,evidence:'gnss',...fields};
  const original={sourceRevision:'r',date:'2026-10-30',calls:[{id:'a',start:'09:00',mos:2},{id:'b',start:'10:00',mos:2}],administrativeDongs:[{id:'dong'}],callLocations:[bye,gnss]};
  const point={...bye,evidence:'estimated',positionQuality:'three-site-rough',estimationMethod:'THREE_SITE_RSRP_CENTROID',representativeBasis:'cdr-end-nearest',usedSiteCount:3,roughSearchRadiusM:700,secondsBeforeEnd:10,usedStations:[{lat:37.48,lon:127.06,ruId:'1',cellId:'1',rsrpDbm:-90},{lat:37.49,lon:127.06,ruId:'2',cellId:'2',rsrpDbm:-95},{lat:37.48,lon:127.07,ruId:'3',cellId:'3',rsrpDbm:-100}]};
  const rough={schemaVersion:'coarse-three-site-v1',sourceRevision:'r',date:'2026-10-30',method:'THREE_SITE_RSRP_CENTROID',notA90PercentAccuracyRegion:true,points:[point,{...point,callId:'b'}]};
  // The new estimate does not carry BYE selection metadata itself.
  for(const key of Object.keys(fields))delete rough.points[0][key];
  const result=overlayThreeSiteRough(original,rough,true);
  const selected=result.callLocations.find(p=>p.callId==='a');
  for(const [key,value] of Object.entries(fields))assert.equal(selected[key],value,key);
  assert.equal(selected.byeStationLat,bye.lat);
  assert.equal(selected.byeStationLon,bye.lon);
  assert.deepEqual(result.callLocations.find(p=>p.callId==='b'),gnss);
});
