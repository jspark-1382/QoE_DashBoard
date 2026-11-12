// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {buildTopCustomerMap,groupTopCustomers,topCustomerBubbleDiameter,buildTopCustomerRoutes,TOP_CUSTOMER_ROUTE_ZOOM}=load('lib/analyst/customer-screening-top-ten.ts');
const {aggregateScreening}=load('lib/analyst/customer-screening.ts');
const call=(lat,lon,evidence='gnss',date='2026-10-30')=>({lat,lon,evidence,date,second:36000,qoe:2});
const row=(id,poor,badCalls)=>({id,number:'UE-'+id,poor,badCalls});

test('TOP 10 preserves list ranks, never fills missing locations with lower-ranked customers',()=>{
 const rows=Array.from({length:12},(_,i)=>row(String(i),12-i,[call(37.48+i/1000,127.05)]));
 rows[2].badCalls=[call(null,null)];
 const result=buildTopCustomerMap(rows);
 assert.equal(result.total,10);assert.equal(result.unlocated,1);
 assert.deepEqual(result.points.map(p=>p.rank),[1,2,4,5,6,7,8,9,10]);
 assert(!result.points.some(p=>p.id==='10'||p.id==='11'));
 assert.equal(result.points[0].poor,12);
});

test('representative position is a recorded poor-call position, with frequency and evidence preserved',()=>{
 const source=row('a',5,[call(37.48,127.05,'bye-cell'),call(37.48,127.05,'bye-cell'),
   call(37.49,127.06),call(37.49,127.06),call(NaN,127.1)]);
 const before=JSON.stringify(source);
 const result=buildTopCustomerMap([source]);
 assert.deepEqual([result.points[0].lat,result.points[0].lon,result.points[0].evidence],[37.49,127.06,'gnss']);
 assert.equal(result.points[0].locationCalls,2);
 assert.equal(JSON.stringify(source),before);
 assert.equal(buildTopCustomerMap([row('bad',2,[call(0,0),call(91,127)])]).unlocated,1);
 assert.equal(buildTopCustomerMap([row('good',0,[])]).total,0);
});

test('zoom clusters conserve customer membership and co-located customers remain selectable together',()=>{
 const points=buildTopCustomerMap([row('a',8,[call(37.48,127.05)]),
   row('b',5,[call(37.4801,127.0501)]),row('c',3,[call(37.48,127.05)])]).points;
 const project=(p)=>({x:(p.lon-127)*1000,y:(p.lat-37)*1000});
 const overview=groupTopCustomers(points,13,project);
 assert.equal(overview.length,1);
 assert.equal(overview[0].customers.length,3);
 assert.equal(overview[0].poor,16);
 const detailed=groupTopCustomers(points,17,project);
 assert.equal(detailed.length,2);
 assert.deepEqual(detailed.flatMap(g=>g.customers.map(p=>p.id)).sort(),['a','b','c']);
 assert.equal(detailed.find(g=>g.customers.length===2).customers[0].rank,1);
});

test('bubble size responds to zoom and poor call volume within readable bounds',()=>{
 assert(topCustomerBubbleDiameter(12,15)>topCustomerBubbleDiameter(12,13));
 assert(topCustomerBubbleDiameter(12,11)<topCustomerBubbleDiameter(12,13));
 assert(topCustomerBubbleDiameter(12,13)>topCustomerBubbleDiameter(3,13));
 assert(topCustomerBubbleDiameter(10000,19)<=76);
 assert(topCustomerBubbleDiameter(1,1)>=32);
});

test('ten nearby customers across a bucket boundary form one 10-person bubble when zoomed out',()=>{
 const points=buildTopCustomerMap(Array.from({length:10},(_,i)=>row(String(i),10-i,[call(37.48,127.05+i*.0001)]))).points;
 const groups=groupTopCustomers(points,9,p=>({x:55+p.rank*.2,y:50}));
 assert.equal(groups.length,1,'pixel bucket edges must not leave an isolated ninth/tenth customer');
 assert.equal(groups[0].customers.length,10);
 assert.deepEqual(groups[0].customers.map(p=>p.rank),[1,2,3,4,5,6,7,8,9,10]);
});

test('maximum zoom enables all ten color-separated customer call routes with intact provenance',()=>{
 const source=JSON.parse(historicalRead('public/customer-screening-data/2026-10-26_2026-10-30.json'));
 const report=aggregateScreening(source,source.dates[0],source.dates.at(-1),'00:00','23:59');
 const routes=buildTopCustomerRoutes(source,report.rows,source.dates[0],source.dates.at(-1),'00:00','23:59');
 assert.equal(TOP_CUSTOMER_ROUTE_ZOOM,19);
 assert.equal(routes.length,10);
 assert.equal(new Set(routes.map(r=>r.color)).size,10);
 assert.deepEqual(routes.map(r=>r.route.customerId),report.rows.slice(0,10).map(r=>r.id));
 for(const {rank,route} of routes){
   assert.equal(route.totalCalls,report.rows[rank-1].total);
   assert(route.observations.length>0);
   assert.equal(route.gnssCount+route.cellReferenceCount+route.unlocatedCalls,route.totalCalls);
   assert(route.segments.every(s=>route.observations[s.from].day===route.observations[s.to].day));
 }
});

test('real TOP 10 matches filtered ranking and representatives exist in original call evidence',()=>{
 const source=JSON.parse(historicalRead('public/customer-screening-data/2026-10-26_2026-10-30.json'));
 for(const [start,end,from,to] of [[source.dates[0],source.dates.at(-1),'00:00','23:59'],
   [source.dates.at(-1),source.dates.at(-1),'09:00','18:00']]){
   const report=aggregateScreening(source,start,end,from,to);
   const result=buildTopCustomerMap(report.rows);
   assert.equal(result.points.length+result.unlocated,result.total);
   for(const point of result.points){
     const original=report.rows[point.rank-1];
     assert.equal(original.id,point.id);
     assert.equal(original.poor,point.poor);
     assert(original.badCalls.some(p=>p.lat===point.lat&&p.lon===point.lon&&p.evidence===point.evidence));
   }
 }
});
