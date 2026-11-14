/* eslint-disable @typescript-eslint/no-require-imports -- Existing test loader imports TypeScript modules through CommonJS. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const {clusterCustomerRouteLocations,routeMarkerRadius,separateRouteLocations}=load('lib/analyst/customer-route-clusters.ts');

function location(id,{poor=0,total=1,evidence='bye-cell',endpoint=false}={}) {
  return {lat:37.5+Number(id)*.00001,lon:127,evidence,poorCalls:poor,totalCalls:total,endpoint,
    observations:Array.from({length:total},(_,i)=>({id:id+':'+i,quality:i<poor?'poor':i===total-1?'unscored':'good'}))};
}
const project=(locations,positions,scale=1)=>{
  const coordinates=new Map(locations.map((item,index)=>[item,positions[index]]));
  return item=>({x:coordinates.get(item)[0]*scale,y:coordinates.get(item)[1]*scale});
};
const memberIds=clusters=>clusters.map(c=>c.locations.map(l=>l.observations[0].id).sort());

test('nearby circles become one bubble and separate when their projected zoom distance increases',()=>{
  const points=[location('1'),location('2')];
  const at14=clusterCustomerRouteLocations(points,project(points,[[0,0],[20,0]]),14);
  const at17=clusterCustomerRouteLocations(points,project(points,[[0,0],[20,0]],8),17);
  assert.equal(at14.length,1);
  assert.equal(at14[0].locations.length,2);
  assert.equal(at17.length,2);
});

test('at maximum zoom even identical coordinates remain independently accessible',()=>{
  const points=[location('1',{evidence:'gnss'}),location('2')];
  const same=()=>({x:20,y:20});
  assert.equal(clusterCustomerRouteLocations(points,same,18).length,1);
  const separate=clusterCustomerRouteLocations(points,same,19);
  assert.equal(separate.length,2);
  assert.deepEqual(separate.map(c=>c.locations.length),[1,1]);
  assert.equal(clusterCustomerRouteLocations(points,same,17,17).length,2);
});

test('cluster totals, unscored calls, endpoint and source identities stay intact without mutating data',()=>{
  const points=[location('1',{poor:2,total:4,evidence:'gnss',endpoint:true}),location('2',{total:3})];
  const snapshot=JSON.stringify(points);
  const [bubble]=clusterCustomerRouteLocations(points,project(points,[[0,0],[10,0]]),14);
  assert.deepEqual([bubble.poorCalls,bubble.totalCalls,bubble.endpoint],[2,7,true]);
  assert.deepEqual(bubble.locations.map(l=>l.evidence),['gnss','bye-cell']);
  assert.equal(bubble.locations[0],points[0]);
  assert.equal(bubble.locations[1].observations,points[1].observations);
  assert.equal(JSON.stringify(points),snapshot);
  assert.equal(bubble.lat,(points[0].lat+points[1].lat)/2);
  assert.equal(bubble.lon,127);
});

test('collision threshold includes six pixels of label spacing with a precise outer boundary',()=>{
  const points=[location('1'),location('2')];
  const boundary=2*routeMarkerRadius('0/1')+6;
  assert.equal(clusterCustomerRouteLocations(points,project(points,[[0,0],[boundary,0]]),14).length,1);
  assert.equal(clusterCustomerRouteLocations(points,project(points,[[0,0],[boundary+.01,0]]),14).length,2);
});

test('merged bubble growth is rechecked against previously non-overlapping circles',()=>{
  const points=[location('1'),location('2'),location('3')];
  const [bubble]=clusterCustomerRouteLocations(points,project(points,[[0,0],[0,2],[48,1]]),14);
  assert.equal(bubble.locations.length,3);
  assert.equal(bubble.totalCalls,3);
});

test('an overlap chain does not automatically collapse distant ends into one large cluster',()=>{
  const points=[location('1'),location('2'),location('3'),location('4')];
  const bubbles=clusterCustomerRouteLocations(points,project(points,[[0,0],[35,0],[70,0],[105,0]]),14);
  assert.deepEqual(bubbles.map(c=>c.locations.length),[2,2]);
  assert.equal(bubbles.reduce((sum,c)=>sum+c.totalCalls,0),4);
});

test('group membership is deterministic under input reordering and negative projected coordinates',()=>{
  const points=[location('1'),location('2'),location('3'),location('4')];
  const projection=project(points,[[-105,-30],[-70,-30],[-35,-30],[0,-30]]);
  const expected=memberIds(clusterCustomerRouteLocations(points,projection,14));
  assert.deepEqual(memberIds(clusterCustomerRouteLocations([...points].reverse(),projection,14)),expected);
  assert.deepEqual(memberIds(clusterCustomerRouteLocations([points[2],points[0],points[3],points[1]],projection,14)),expected);
});

test('empty, single and repeated references neither invent nor double-count locations',()=>{
  assert.deepEqual(clusterCustomerRouteLocations([],()=>({x:0,y:0}),14),[]);
  const item=location('1',{poor:1,total:2});
  const [bubble]=clusterCustomerRouteLocations([item,item],()=>({x:0,y:0}),14);
  assert.equal(bubble.locations.length,1);
  assert.deepEqual([bubble.poorCalls,bubble.totalCalls],[1,2]);
  assert.equal(bubble.locations[0],item);
});

test('radius preserves existing singles and reserves space for a cluster label and place count',()=>{
  assert.equal(routeMarkerRadius('0/1'),18);
  assert.equal(routeMarkerRadius('3/115'),22.5);
  assert.equal(routeMarkerRadius('0/2',true),26);
  assert(routeMarkerRadius('300/123456',true)>26);
});

test('a non-finite projection fails explicitly rather than silently losing calls',()=>{
  assert.throws(()=>clusterCustomerRouteLocations([location('1')],()=>({x:NaN,y:1}),14),/projection must be finite/);
});

const assertSeparated=placements=>{
  for(let i=0;i<placements.length;i++)for(let j=i+1;j<placements.length;j++){
    const a=placements[i],b=placements[j];
    const min=routeMarkerRadius(a.location.poorCalls+'/'+a.location.totalCalls)+
      routeMarkerRadius(b.location.poorCalls+'/'+b.location.totalCalls)+6;
    assert(Math.hypot(a.x-b.x,a.y-b.y)>=min-1e-6,'displayed circles must not overlap: '+a.location.observations[0].id+'/'+b.location.observations[0].id);
  }
};

test('maximum-zoom packing prevents new overlaps between separate fan-out groups',()=>{
  const points=[location('1'),location('2'),location('3'),location('4')];
  const positions=[[0,0],[35,0],[70,0],[105,0]];
  const placed=separateRouteLocations(points,project(points,positions));
  assert.equal(placed.length,4);
  assertSeparated(placed);
  assert.deepEqual([placed[0].x,placed[0].y],[0,0]);
  assert.deepEqual([placed[2].x,placed[2].y],[70,0]);
});

test('packing retains already separated source positions exactly',()=>{
  const points=[location('1'),location('2')];
  const placed=separateRouteLocations(points,project(points,[[-100,-100],[100,100]]));
  assert.deepEqual(placed.map(p=>[p.x,p.y]),[[-100,-100],[100,100]]);
  assert.equal(placed[0].location,points[0]);
});

test('dense mixed-size packing is deterministic, complete and leaves source coordinates untouched',()=>{
  const points=Array.from({length:40},(_,i)=>location(String(i+1),{poor:i%3===0?1:0,total:i%5===0?1000:1,evidence:i%2?'gnss':'bye-cell'}));
  const original=JSON.stringify(points);
  const projection=project(points,points.map((_,i)=>[(i%4)*4,Math.floor(i/4)*4]));
  const placed=separateRouteLocations(points,projection);
  const reversed=separateRouteLocations([...points].reverse(),projection);
  assertSeparated(placed);
  assert.equal(placed.length,points.length);
  assert.deepEqual(placed,reversed);
  assert.equal(JSON.stringify(points),original);
  assert.deepEqual(placed.map(p=>p.location),points);
});

test('empty and repeated maximum-zoom locations retain one original reference',()=>{
  assert.deepEqual(separateRouteLocations([],()=>({x:0,y:0})),[]);
  const item=location('1');
  assert.deepEqual(separateRouteLocations([item,item],()=>({x:7,y:3})),[{location:item,x:7,y:3}]);
  assert.throws(()=>separateRouteLocations([item],()=>({x:Infinity,y:0})),/projection must be finite/);
});
