const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('default quality route uses the summary service instead of the archival bulk page',()=>{
 const page=fs.readFileSync('app/page.tsx','utf8');
 assert.match(page,/ServerQualityOverview/);
});
test('summary page keeps source catalogs, raw daily overviews and map modules off its initial path',()=>{
 const source=fs.readFileSync('components/analyst/server-quality-overview.tsx','utf8');
 assert(!/loadDataset\(|loadOverview\(|voice-1030\.json|analyst-overview\//.test(source));
 assert.match(source,/loadVoiceMeta/);assert.match(source,/useVoiceResource<VoiceSummary>\('summary'/);
 assert.match(source,/mapRequested/);assert.match(source,/callsOpen/);
 assert.match(source,/useVisibleMap\(!!summary\.data/);
 assert(!source.includes('>지도 보기</button>'));
 assert.match(source,/lazy\(/);
});
test('candidate entry never waits for an unused full quality summary',()=>{
 const source=fs.readFileSync('components/analyst/server-quality-overview.tsx','utf8');
 assert.match(source,/useVoiceResource<VoiceSummary>\('summary',queryArgs,!!meta&&valid&&state\?\.mapMode==='current'\)/);
 assert(source.includes("state&&(state.mapMode==='improvement'||stats)"));
});
test('automatic quality maps leave towers off and request their geometry only on activation',()=>{
 const source=fs.readFileSync('components/analyst/server-quality-overview.tsx','utf8');
 assert.match(source,/\[showMapStations,setShowMapStations\]=useState\(false\)/);
 assert.match(source,/useVoiceResource<VoiceMapStations>\('map-stations',queryArgs,!!meta&&valid&&mapRequested&&showMapStations/);
 assert.match(source,/useVoiceResource<VoiceMap>\('map',\{\.\.\.queryArgs,includeStations:false\}/);
 assert.match(source,/useVisibleMap\(!!summary\.data/);
 const map=fs.readFileSync('components/analyst/server-quality-map.tsx','utf8');
 assert.match(map,/const EMPTY_STATIONS/);
 assert.match(map,/stationsVisible\?\(stationLayer\?\.stations\?\?EMPTY_STATIONS\):EMPTY_STATIONS/);
});
