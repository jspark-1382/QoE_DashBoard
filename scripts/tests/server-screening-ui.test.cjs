const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const path='lib/analyst/screening-query.ts';
const helper=fs.existsSync(path)?load(path):{};

test('screening requests page 25 rows while preserving full-population scope and filters',()=>{
  assert.equal(typeof helper.screeningQueryRequest,'function','server screening request adapter exists');
  const scope={dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'};
  const result=helper.screeningQueryRequest(scope,{query:'00012',filter:'repeat',sort:'drop',page:3,selectedId:'opaque',areaId:'adm:1',cellId:''});
  assert.deepEqual(result,{scope,query:'00012',filter:'repeat',sort:'drop',page:3,pageSize:25,selectedId:'opaque',areaId:'adm:1',cellId:''});
  assert.equal(result.scope.customerIds,undefined);
});

test('routes are requested only for an explicitly opened selected or top-ten map',()=>{
  assert.equal(typeof helper.screeningRouteIds,'function','lazy route selection exists');
  const rows=Array.from({length:12},(_,i)=>({id:'c'+i,poor:i===3?0:1}));
  assert.deepEqual(helper.screeningRouteIds(false,'top10','',rows),[]);
  assert.deepEqual(helper.screeningRouteIds(true,'dong','c1',rows),[]);
  assert.deepEqual(helper.screeningRouteIds(true,'route','c11',rows),['c11']);
  assert.deepEqual(helper.screeningRouteIds(true,'top10','',rows),['c0','c1','c2','c4','c5','c6','c7','c8','c9']);
});

test('top-ten route projection retains displayed ranks with missing or zero-poor customers',()=>{
  assert.equal(typeof helper.screeningTopRoutes,'function','top-ten route adapter exists');
  const routes=[{customerId:'third',observations:[]},{customerId:'first',observations:[]}];
  const ranked=[{id:'first',poor:1},{id:'normal',poor:0},{id:'third',poor:2}];
  assert.deepEqual(helper.screeningTopRoutes(ranked,routes).map(r=>[r.rank,r.route.customerId,r.color]),[[1,'first','#dc3557'],[3,'third','#059669']]);
});

test('screening loads the map automatically only after the summary and visible map area',()=>{
  const text=fs.readFileSync('components/analyst/customer-screening-dashboard.tsx','utf8');
  assert.doesNotMatch(text,/fetch\(['"]\/qoe\/customer-screening-data\/2026/);
  assert.doesNotMatch(text,/aggregateScreening\(|buildScreeningGeography\(|buildCustomerRoute\(/);
  assert.match(text,/mapEnabled\s*&&\s*geography\s*&&/);
  assert.match(text,/useVisibleMap<HTMLDivElement>\(!!report&&!queryLoading/);
  assert(!text.includes('>지도 보기</button>'));
  assert.match(text,/lazy\(\(\)=>import\('\.\/customer-screening-map'\)/);
  assert.match(text,/data\?\.report/);
  assert.match(text,/data\?\.affectedCallTotal/);
  assert.match(text,/data\?\.total/);
  assert.doesNotMatch(text,/ranking\.slice\(0,200\)/);
});

test('screening opening and reset select the top-ten map and retain automatic loading',()=>{
  const text=fs.readFileSync('components/analyst/customer-screening-dashboard.tsx','utf8');
  assert.match(text,/useState<ScreeningMapView>\('top10'\)/);
  const reset=text.slice(text.indexOf('const reset='),text.indexOf('const reset=')+650);
  assert.match(reset,/setMapView\('top10'\)/);
  assert.match(reset,/setMapEnabled\(false\)/);
  assert.match(text,/<CustomerScreeningPreview row=\{selected\}/);
});

test('MDT contract uses a scoped catalog and selected-call locations while archival loading stays separate',()=>{
  const text=fs.readFileSync('components/analyst/analyst-dashboard.tsx','utf8');
  assert.match(text,/serverContract/);
  assert.match(text,/voiceQuery<[^>]*>\('customer'/);
  assert.match(text,/resolved\.view === 'overview'\s*&&\s*resolved\.date/);
  assert.doesNotMatch(text,/resolved\.view === 'overview' \|\| \(resolved\.view === 'contract' && resolved\.source === 'MDT'\)/);
  assert.match(text,/allCalls:\s*true/);
  assert.match(text,/callId:\s*activeCall\.id/);
  assert.match(text,/pageSize:\s*25/);
});
