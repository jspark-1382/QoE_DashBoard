const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const {buildCustomerRoute,groupCustomerRouteLocations,findOverlappingRouteMarkers,summarizeRouteCells}=load('lib/analyst/customer-screening-route.ts');

test('location circles count poor, good and unscored calls without hiding an earlier poor call',()=>{
  const source={dates:['2026-10-26'],customers:[{id:'a',number:'UE-001',calls:[
    [0,36000,2.1,0,'A','C1',37.5,127,'bye-cell'],
    [0,36600,4.1,0,'A','C1',37.5,127,'bye-cell'],
    [0,37200,null,0,'A','C1',37.5,127,'bye-cell'],
    [0,37800,4.0,0,'A','C1',37.5,127,'gnss'],
    [0,38400,3.1,0,'A','C2',37.501,127.001,'gnss'],
    [0,39000,2.4,0,'A','UNKNOWN',null,null,''],
  ]}]};
  const route=buildCustomerRoute(source,'a','2026-10-26','2026-10-26','00:00','23:59');
  const circles=groupCustomerRouteLocations(route.observations);
  assert.deepEqual(circles.map(c=>[c.evidence,c.poorCalls,c.totalCalls,c.endpoint]),[
    ['bye-cell',1,3,true],['gnss',0,1,false],['gnss',0,1,true],
  ]);
  assert.equal(circles.reduce((sum,c)=>sum+c.totalCalls,0),5);
  assert.equal(route.totalCalls,6);
  assert.equal(route.unlocatedCalls,1);
  assert.deepEqual(circles[0].observations.map(p=>p.quality),['poor','good','unscored']);
  assert.deepEqual([circles[0].lat,circles[0].lon],[37.5,127]);
});

test('location circles follow the selected date and time and handle no located calls',()=>{
  const source={dates:['2026-10-26','2026-10-27'],customers:[{id:'a',number:'UE-001',calls:[
    [0,36000,2.1,0,'A','C1',37.5,127,'bye-cell'],
    [1,36000,4.0,0,'A','C1',37.5,127,'bye-cell'],
    [1,39600,2.1,0,'A','C1',37.5,127,'bye-cell'],
  ]}]};
  const route=buildCustomerRoute(source,'a','2026-10-26','2026-10-27','10:00','10:30','2026-10-27');
  const circles=groupCustomerRouteLocations(route.observations);
  assert.equal(circles.length,1);
  assert.deepEqual([circles[0].poorCalls,circles[0].totalCalls,circles[0].endpoint],[0,1,true]);
  assert.deepEqual(groupCustomerRouteLocations([]),[]);
});

test('clicking a circle includes directly overlapping displayed circles, including a hidden smaller circle',()=>{
  const markers=[
    {id:'clicked',x:100,y:100,radius:20},
    {id:'behind',x:104,y:101,radius:18},
    {id:'edge',x:138,y:100,radius:18},
    {id:'far',x:180,y:100,radius:18},
    {id:'other-row',x:100,y:160,radius:18},
  ];
  assert.deepEqual(findOverlappingRouteMarkers(markers,markers[0]).map(p=>p.id),['clicked','behind','edge']);
  assert.deepEqual(findOverlappingRouteMarkers([],markers[0]),[]);
});

test('overlap summaries retain every original Cell ID and count each call once across location groups',()=>{
  const points=[
    {id:'1',cell:'00123',quality:'poor',evidence:'bye-cell',lat:37.5,lon:127},
    {id:'2',cell:'00456',quality:'good',evidence:'bye-cell',lat:37.5,lon:127},
    {id:'3',cell:'00123',quality:'unscored',evidence:'gnss',lat:37.5001,lon:127},
    {id:'4',cell:'',quality:'poor',evidence:'gnss',lat:37.5002,lon:127},
  ];
  const locations=groupCustomerRouteLocations(points);
  assert.deepEqual(summarizeRouteCells([...locations,locations[0]]),[
    {cellId:'00123',poorCalls:1,totalCalls:2},
    {cellId:'',poorCalls:1,totalCalls:1},
    {cellId:'00456',poorCalls:0,totalCalls:1},
  ]);
});
