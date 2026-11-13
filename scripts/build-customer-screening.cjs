/* 고객 선별 전용 원본 개요 집계. 다른 탭의 산출물을 수정하지 않습니다. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SOURCE = path.resolve(process.env.QOE_PUBLIC_DIR || path.join(ROOT, 'public'));
const OUTPUT = path.join(SOURCE, 'customer-screening-data', '2026-10-26_2026-10-30.json');
const BOUNDARY_OUTPUT = path.join(SOURCE, 'customer-screening-data', 'administrative-boundaries-v1.json');
const DROP_RX = /(?:^|[\^\s\/;,])H\s*(?::\s*Drop\b|(?=\^|$))|(?:^|[\s:;\/])Drop\b/i;
const isDrop = value => DROP_RX.test(String(value ?? '').trim());
const rounded = v => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
function callScore(call) {
  const mos = call.mos;
  if (typeof mos !== 'number' || !Number.isFinite(mos) || mos < 1 || mos > 5) return null;
  return rounded(mos - (isDrop(call.sipCause) ? 2.5 : 0));
}
function build() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SOURCE, 'voice-1030.json'), 'utf8'));
  if (manifest.meta.qoeBasis !== 'rtcp-mos-v5') throw Error('RTCP MOS(v5) 원본이 아닙니다.');
  const dates = [...manifest.meta.dates].sort();
  const identities = new Map(manifest.customers.map(row => [row.id, row.sourceContractId || row.id]));
  const people = new Map();
  const areas = new Map();
  const boundaries = new Map();
  const cellSites = new Map();
  let calls = 0, poor = 0, drops = 0, locatedPoor = 0;
  dates.forEach((date, dayIndex) => {
    const sourcePath = path.join(SOURCE, 'analyst-overview', 'MDT', date + '.json');
    const overview = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    if (overview.sourceRevision !== manifest.meta.revision || overview.source !== 'MDT' || overview.date !== date)
      throw Error(date + ' 개요와 원본 리비전 불일치');
    for (const area of overview.administrativeDongs ?? []) {
      if (!areas.has(area.id)) areas.set(area.id, [area.label,rounded(area.lat),rounded(area.lon)]);
      if (!boundaries.has(area.id) && area.coordinates?.length)
        boundaries.set(area.id, {type:'Feature',properties:{id:area.id,label:area.label},geometry:{type:'MultiPolygon',coordinates:area.coordinates}});
    }
    const locations = new Map((overview.callLocations || []).map(loc => [loc.callId, loc]));
    for (const site of overview.callLocations || []) {
      if(site.evidence==='bye-cell'&&site.byeCellId&&Number.isFinite(site.lat)&&Number.isFinite(site.lon) &&
        !cellSites.has(String(site.byeCellId))){
        cellSites.set(String(site.byeCellId),[rounded(site.lat),rounded(site.lon)]);
      }
    }
    for (const call of overview.calls) {
      if (!call.customerId || !call.id) continue;
      if (!Number.isFinite(call.startSecond)) continue;
      const row = people.get(call.customerId) ?? {id:call.customerId,number:identities.get(call.customerId)||call.contractId||call.customerId,calls:[]};
      const score = callScore(call), drop = isDrop(call.sipCause);
      const low = score != null && score < 3;
      // Preserve BYE-time position evidence for all calls so one customer's
      // observations can be shown chronologically without fabricating a trajectory.
      const loc = locations.get(call.id) ?? null;
      const validLocation = Boolean(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) &&
        Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180 &&
        ['gnss','estimated','bye-cell'].includes(loc.evidence));
      // Compact: [dateIndex,startSec,QoE,Drop,area,BYEcell,lat,lon,evidence,rawId,endSec].
      // lat/lon are GNSS observations or BYE-site reference; never equate the two.
      // MOS 없는 Drop은 Drop만 계산하며 임의의 QoE를 생성하지 않습니다.
      const endParts=typeof call.end==='string'&&/^\d{2}:\d{2}:\d{2}$/.test(call.end)?call.end.split(':').map(Number):null;
      const endSecond=endParts?endParts[0]*3600+endParts[1]*60+endParts[2]:null;
      row.calls.push([dayIndex,call.startSecond,score,drop?1:0,
        call.gridIds?.[0] ?? loc?.areaId ?? '',call.endCellId || '',
        validLocation ? rounded(loc.lat) : null, validLocation ? rounded(loc.lon) : null,
        validLocation ? loc.evidence : '',low ? (call.rawCallId ?? call.id.slice(call.customerId.length+1)) : '',
        endSecond
      ]);
      people.set(call.customerId,row);
      calls++; if(drop)drops++; if(low){poor++;if(validLocation)locatedPoor++;}
    }
    console.log(date, 'calls',overview.calls.length, 'customers so far',people.size);
  });
  const payload = {
    schemaVersion:'customer-screening-v1',
    sourceRevision:manifest.meta.revision,
    source:'MDT · SIP CDR / RTCP MOS(v5) / BYE 근거',
    dates, thresholds:{poor:3,good:3.5,concentratedRate:0.5,concentratedCount:10,minEvaluatedForRate:5,repeatDays:2,dropCount:3,dropRate:0.1},
    areas:Object.fromEntries(areas),cellSites:Object.fromEntries(cellSites),
    customers:[...people.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    audit:{calls,poor,drops,locatedPoor,customers:people.size}
  };
  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
  fs.writeFileSync(OUTPUT,JSON.stringify(payload));
  // 원본 행정동경계 SHP 기반 overview의 다각형을 그대로 전달. 임의 버블/좌표 추정 없음.
  fs.writeFileSync(BOUNDARY_OUTPUT,JSON.stringify({schemaVersion:'customer-screening-boundaries-v1',sourceRevision:manifest.meta.revision,type:'FeatureCollection',features:[...boundaries.values()]}));
  console.log('OUTPUT',OUTPUT,'bytes',fs.statSync(OUTPUT).size,JSON.stringify(payload.audit));
}
if (require.main === module) build();
module.exports = {callScore,isDrop,build};
