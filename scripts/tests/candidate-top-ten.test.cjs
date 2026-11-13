/* eslint-disable @typescript-eslint/no-require-imports -- Shared Node test harness. */
const {test,afterEach}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const api=load('lib/analyst/candidate-top-ten.ts');
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;});
const scopeFor=revision=>({sourceRevision:revision,dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59',policy:'strict-3-site-v1'});
const response=value=>({ok:true,status:200,json:async()=>value});
const customer=(id,rank=1)=>({id,number:'00'+id,poor:11-rank,rank});
const mapPoint=(person,lat,lon,evidence='bye-cell')=>({...person,lat,lon,evidence,locationCalls:1});
const locations=(scope,points)=>({sourceRevision:scope.sourceRevision,topCustomers:{total:points.length,unlocated:0,points}});
function isLocationRequest(url,options){
 if(!options?.body)return false;
 assert.equal(String(url),'/qoe/api/voice/query');assert.equal(JSON.parse(options.body).op,'screening-map');return true;
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function candidateFixture(revision,count=1,mode='all'){
 const scope=scopeFor(revision),locationMode='gps-mdt-rough-unvalidated-v1';
 const candidates=Array.from({length:count},(_,index)=>({id:'candidate-'+index,label:'Candidate '+index,
  poorCustomerCount:1,poorCallCount:1,poorDateCount:1,medoid:{lat:37.5,lon:127,kind:'gnss'},displayRadiusM:100,
  rangeReviewRequired:false,rank:index+1,validationStatus:'unvalidated',validationNewCustomers:0,
  detailPath:revision+'/candidate-'+index+'.json'}));
 const summary={schemaVersion:'quality-candidate-summary-v1',scope,scopeKey:revision+'-scope',locationMode,
  discoveryDates:['2026-10-26'],validationDates:['2026-10-30'],candidates,auditReference:'audit',observationPath:'observations.json'};
 const call=(id,customerId,date='2026-10-26')=>({date,callId:id,rawCallId:id,customerId,startedAt:null,mos:2,
  mdtLinkStatus:'unique',sourceRevision:revision,sourceFile:'fixture.json'});
 const point=(c,role='discovery-member',kind='gnss')=>({callId:c.callId,customerId:c.customerId,date:c.date,
  mos:c.mos,lat:37.5,lon:127,kind,role});
 const details=candidates.map((card,index)=>{
  const member=call('member-'+index,'other-'+index);
  return {schemaVersion:'quality-candidate-detail-v1',scope,scopeKey:summary.scopeKey,locationMode,
   candidate:{id:card.id,memberCallIds:[member.callId],customerIds:[member.customerId],poorCustomerCount:1,
    poorCallCount:1,poorDateCount:1,gnssCount:1,medoid:card.medoid,maxCenterDistanceM:0,maxPairDistanceM:0,
    displayRadiusM:100,rangeReviewRequired:false,rank:card.rank,validationNewCustomerIds:[],validationExistingCustomerIds:[],
    validationStatus:'unvalidated',nearbyPoints:[point(member)]},calls:[member],decisions:[]};
 });
 const base=mode==='all'?'/qoe/quality-improvement-mixed-full/':'/qoe/quality-improvement-mixed-evaluation/';
 const byUrl=new Map(candidates.map((card,index)=>[base+card.detailPath,details[index]]));
 return {summary,details,byUrl,call,point,locations:locations(scope,[mapPoint(customer('00123'),35,129)])};
}

test('customer ranking uses the exact first ten global poor rows, preserving gaps and leading zeros',async()=>{
 const scope=scopeFor('top-ten-ranks'),requests=[];
 const topRows=Array.from({length:12},(_,index)=>({id:'00'+index,number:'000'+index,poor:20-index}));
 topRows[2].poor=0;
 global.fetch=async(url,options)=>{requests.push({url:String(url),body:JSON.parse(options.body)});
  return response({sourceRevision:scope.sourceRevision,topRows,rows:[{id:'wrong-page-row',number:'wrong',poor:99}]});};
 const result=await api.loadCandidateTopTenCustomers(scope);
 assert.deepEqual(result.map(c=>[c.id,c.number,c.rank]),[
  ['000','0000',1],['001','0001',2],['003','0003',4],['004','0004',5],['005','0005',6],
  ['006','0006',7],['007','0007',8],['008','0008',9],['009','0009',10]]);
 assert.equal(result[0].poor,20);
 assert.deepEqual(requests,[{url:'/qoe/api/voice/query',body:{sourceRevision:'top-ten-ranks',
  scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'},query:'',filter:'all',sort:'poor',page:0,op:'screening'}}]);
});

test('ranking cache shares callers but separates every scope field and source revision',async()=>{
 const scope=scopeFor('top-ten-scope-cache');let requests=0;
 global.fetch=async(_url,options)=>{requests++;const body=JSON.parse(options.body);await turn();
  return response({sourceRevision:body.sourceRevision,topRows:[{id:'0001',number:'00123',poor:2}]});};
 const [first,peer]=await Promise.all([api.loadCandidateTopTenCustomers(scope),api.loadCandidateTopTenCustomers({...scope})]);
 assert.equal(first,peer);assert.equal(await api.loadCandidateTopTenCustomers({...scope}),first);
 assert.equal(requests,1);
 for(const patch of [{dateStart:'2026-10-27'},{dateEnd:'2026-10-29'},{from:'01:00'},{to:'22:59'},{policy:'other-policy'},{sourceRevision:'top-ten-scope-next'}])
  await api.loadCandidateTopTenCustomers({...scope,...patch});
 assert.equal(requests,7);
});

test('stale screening revisions fail and a successful retry is not poisoned by the failure',async()=>{
 const scope=scopeFor('top-ten-stale');let requests=0;
 global.fetch=async()=>response({sourceRevision:++requests===1?'old':scope.sourceRevision,topRows:[{id:'001',number:'00123',poor:2}]});
 await assert.rejects(api.loadCandidateTopTenCustomers(scope),/버전/);
 assert.deepEqual(await api.loadCandidateTopTenCustomers(scope),[{id:'001',number:'00123',poor:2,rank:1}]);
 assert.equal(requests,2);
});

test('alternative membership compares exact discovery customer IDs and ignores separate validation points',()=>{
 const customers=[customer('00123')],candidate={members:[{customerId:'123'},{customerId:'other'}],validationPoints:[{customerId:'00123'}]};
 assert.equal(api.candidateHasTopTenCustomer(candidate.members,customers),false);
 assert.equal(api.candidateHasTopTenCustomer([{customerId:'00123'}],customers),true);
 assert.equal(api.candidateHasTopTenCustomer([{customerId:'00123-extra'}],customers),false);
 assert.equal(api.candidateHasTopTenCustomer([],customers),false);
});

test('candidate customers retain TOP10 ranks and exact IDs with unique member-call counts',()=>{
 const customers=[customer('002',5),customer('001',1),customer('003',9)];
 const members=[{customerId:'002'},{customerId:'001',callId:'first'},{customerId:'001',callId:'first'},
  {customerId:'001',callId:'second'},{customerId:'002'},{customerId:'1',callId:'alias'},
  {customerId:'001-extra',callId:'suffix'}];
 assert.deepEqual(api.candidateTopTenMembers(members,customers),[
  {id:'001',number:'00001',poor:10,rank:1,memberCalls:2},
  {id:'002',number:'00002',poor:6,rank:5,memberCalls:2},
 ]);
 assert.deepEqual(api.candidateTopTenMembers([],customers),[]);
});

test('reference positions include TOP6 and TOP7 inside their actual displayed circles without inventing member calls',()=>{
 const customers=[customer('UE18645',6),customer('567561269',7),customer('actual',3)];
 const points=[mapPoint(customers[0],37.488055,127.051311),mapPoint(customers[1],37.506985,127.060854)];
 assert.deepEqual(api.includeCandidateTopTenLocations([{...customers[2],memberCalls:2}],customers,points,
  {lat:37.48745440999706,lon:127.0499110200019,radiusM:480}),[
  {...customers[2],memberCalls:2},{...customers[0],memberCalls:0,withinRange:true},
 ]);
 assert.deepEqual(api.includeCandidateTopTenLocations([],customers,points,
  {lat:37.50198125999255,lon:127.05699205000191,radiusM:850}),[
  {...customers[1],memberCalls:0,withinRange:true},
 ]);
});

test('spatial union includes the spherical boundary, preserves actual members and deduplicates overlaps',()=>{
 const customers=[customer('inside',2),customer('boundary',1),customer('outside',3),customer('missing',4)];
 const points=[mapPoint(customers[0],.5,0,'gnss'),mapPoint(customers[1],1,0),mapPoint(customers[2],1.001,0),mapPoint(customer('unknown'),.1,0)];
 const result=api.includeCandidateTopTenLocations([{...customers[0],memberCalls:3},{...customers[3],memberCalls:1}],customers,points,
  {lat:0,lon:0,radiusM:111194.92664455874});
 assert.deepEqual(result,[{...customers[1],memberCalls:0,withinRange:true},{...customers[0],memberCalls:3,withinRange:true},{...customers[3],memberCalls:1}]);
 assert.equal(result.filter(row=>row.id==='inside').length,1);
});

test('spatial union rejects invalid positions, unknown evidence and unavailable circle radii while retaining actual calls',()=>{
 const customers=[customer('invalid',1),customer('wrong-evidence',2),customer('actual',3)];
 const points=[mapPoint(customers[0],NaN,127),mapPoint(customers[0],91,127),mapPoint(customers[1],37.5,127,'estimated')];
 const actual=[{...customers[2],memberCalls:4}];
 assert.deepEqual(api.includeCandidateTopTenLocations(actual,customers,points,{lat:37.5,lon:127,radiusM:100}),actual);
 for(const circle of [{lat:37.5,lon:127,radiusM:null},{lat:37.5,lon:127,radiusM:-1},{lat:NaN,lon:127,radiusM:100}])
  assert.deepEqual(api.includeCandidateTopTenLocations(actual,customers,[mapPoint(customers[0],37.5,127)],circle),actual);
});

test('location loader pins default ranking and scope, shares requests, and rejects stale revisions',async()=>{
 const scope=scopeFor('top-ten-location-loader'),point=mapPoint(customer('00123'),37.5,127),requests=[];
 global.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push({url:String(url),body});return response(locations(scope,[point]));};
 const [first,peer]=await Promise.all([api.loadCandidateTopTenLocations(scope),api.loadCandidateTopTenLocations({...scope})]);
 assert.equal(first,peer);assert.deepEqual(first,{total:1,unlocated:0,points:[point]});
 assert.deepEqual(requests,[{url:'/qoe/api/voice/query',body:{sourceRevision:scope.sourceRevision,scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'},query:'',filter:'all',sort:'poor',op:'screening-map'}}]);
 await assert.rejects(api.loadCandidateTopTenLocations({...scope,sourceRevision:'new-location-revision'}),/버전/);
});

test('DBSCAN unions reference locations with discovery customers and keys the result by current circle geometry',async()=>{
 const f=candidateFixture('top-ten-dbscan-spatial',2),people=[customer('spatial-only',1),customer('actual',2)];
 f.locations=locations(f.summary.scope,[mapPoint(people[0],37.5,127),mapPoint(people[1],37.5,127)]);
 f.details[0].calls[0].customerId='actual';f.details[0].candidate.nearbyPoints[0].customerId='actual';
 f.summary.candidates[1].medoid={lat:35,lon:129};let maps=0,details=0;
 global.fetch=async(url,options)=>{if(options?.body){maps++;return response(f.locations);}details++;return response(f.byUrl.get(String(url)));};
 assert.deepEqual(await api.loadDbscanTopTenMatches(f.summary,people,'all'),[
  {candidateId:'candidate-0',customers:[{...people[0],memberCalls:0,withinRange:true},{...people[1],memberCalls:1,withinRange:true}]},
 ]);
 const moved={...f.summary,candidates:f.summary.candidates.map(card=>({...card,medoid:{lat:35,lon:129}}))};
 assert.deepEqual(await api.loadDbscanTopTenMatches(moved,people,'all'),[{candidateId:'candidate-0',customers:[{...people[1],memberCalls:1}]}]);
 assert.equal(maps,1);assert.equal(details,2);
});

test('failed TOP10 location lookup rejects the whole candidate result instead of silently excluding spatial customers',async()=>{
 const f=candidateFixture('top-ten-dbscan-location-failure',6);
 global.fetch=async(url,options)=>options?.body?{ok:false,status:503,json:async()=>({error:'location query unavailable'})}:response(f.byUrl.get(String(url)));
 await assert.rejects(api.loadDbscanTopTenMatches(f.summary,[customer('00123')],'all'),/location query unavailable/);
});

test('six candidate regions can contain all ten distinct TOP10 customers',()=>{
 const customers=Array.from({length:10},(_,i)=>customer('00'+(i+1),i+1));
 const matches=[
  {candidateId:'a',customers:[{...customers[0],memberCalls:1},{...customers[1],memberCalls:2}]},
  {candidateId:'b',customers:[{...customers[2],memberCalls:1},{...customers[3],memberCalls:1}]},
  {candidateId:'c',customers:[{...customers[4],memberCalls:1},{...customers[5],memberCalls:1}]},
  {candidateId:'d',customers:[{...customers[6],memberCalls:1},{...customers[7],memberCalls:1}]},
  {candidateId:'e',customers:[{...customers[8],memberCalls:1}]},
  {candidateId:'f',customers:[{...customers[9],memberCalls:1},{...customers[0],memberCalls:3}]},
 ];
 const coverage=api.summarizeCandidateTopTenCoverage(customers,matches);
 assert.deepEqual(coverage.included.map(c=>c.id),['001','002','003','004','005','006','007','008','009','0010']);
 assert.deepEqual(coverage.unmatched,[]);
 assert.equal(coverage.included.length,10);
});

test('coverage distinguishes candidate count from unique customers and preserves unmatched ranks',()=>{
 const customers=[customer('003',3),customer('001',1),customer('002',2),customer('004',4)];
 const matches=[
  {candidateId:'a',customers:[{...customers[1],memberCalls:2}]},
  {candidateId:'b',customers:[{...customers[1],memberCalls:3}]},
  {candidateId:'c',customers:[{...customers[0],memberCalls:1},{...customer('1'),memberCalls:4}]},
 ];
 const coverage=api.summarizeCandidateTopTenCoverage(customers,matches);
 assert.deepEqual(coverage.included,[{id:'001',number:'00001',poor:10,rank:1},{id:'003',number:'00003',poor:8,rank:3}]);
 assert.deepEqual(coverage.unmatched,[{id:'002',number:'00002',poor:9,rank:2},{id:'004',number:'00004',poor:7,rank:4}]);
 assert.deepEqual(api.summarizeCandidateTopTenCoverage(customers,[]).included,[]);
});

test('DBSCAN matches expose each discovery customer and count only unique candidate member calls',async()=>{
 const f=candidateFixture('top-ten-dbscan-enriched',4),customers=[customer('002',2),customer('001',1),customer('003',3)];
 const first=f.call('first','002'),second=f.call('second','002'),third=f.call('third','001');
 f.details[0].calls=[first,second,third,{...first}];
 f.details[0].candidate.memberCallIds=['first','second','third'];
 f.details[0].candidate.nearbyPoints=[f.point(first),f.point(second),f.point(third)];
 const validation=f.call('validation','003','2026-10-30'),nearby=f.call('nearby','003');
 f.details[1].calls.push(validation);f.details[1].candidate.nearbyPoints.push(f.point(validation,'validation-new'));
 f.details[2].calls.push(nearby);f.details[2].candidate.nearbyPoints.push(f.point(nearby,'discovery-nearby'));
 f.details[3].calls[0].customerId='001';f.details[3].candidate.nearbyPoints[0].customerId='001';
 let requests=0;
 global.fetch=async(url,options)=>{if(isLocationRequest(url,options))return response(f.locations);requests++;return response(f.byUrl.get(String(url)));};
 const matches=await api.loadDbscanTopTenMatches(f.summary,customers,'all');
 assert.deepEqual(matches,[
  {candidateId:'candidate-0',customers:[{id:'001',number:'00001',poor:10,rank:1,memberCalls:1},
   {id:'002',number:'00002',poor:9,rank:2,memberCalls:2}]},
  {candidateId:'candidate-3',customers:[{id:'001',number:'00001',poor:10,rank:1,memberCalls:1}]},
 ]);
 assert.deepEqual(await api.loadDbscanTopTenCandidateIds(f.summary,customers,'all'),['candidate-0','candidate-3']);
 assert.equal(requests,4,'the IDs wrapper reuses validated enriched matches');
 assert.equal(await api.loadDbscanTopTenMatches(f.summary,customers,'all'),matches);
 const coverage=api.summarizeCandidateTopTenCoverage(customers,matches);
 assert.deepEqual(coverage.included.map(c=>c.id),['001','002']);assert.deepEqual(coverage.unmatched.map(c=>c.id),['003']);
});

test('DBSCAN enriched cache retains current customer number, poor count and rank with identical IDs',async()=>{
 const f=candidateFixture('top-ten-dbscan-customer-fields');f.details[0].calls[0].customerId='001';
 f.details[0].candidate.nearbyPoints[0].customerId='001';let requests=0;
 global.fetch=async(url,options)=>{if(isLocationRequest(url,options))return response(f.locations);requests++;return response(f.details[0]);};
 assert.equal((await api.loadDbscanTopTenMatches(f.summary,[customer('001')],'all'))[0].customers[0].rank,1);
 assert.deepEqual(await api.loadDbscanTopTenMatches(f.summary,[{id:'001',number:'000-new',poor:3,rank:7}],'all'),[
  {candidateId:'candidate-0',customers:[{id:'001',number:'000-new',poor:3,rank:7,memberCalls:1}]},
 ]);
 assert.equal(requests,1,'changing presentation fields reuses the source detail, not stale membership presentation');
});

test('DBSCAN scans all validated discovery memberships with at most four loads and caches the completed result',async()=>{
 const f=candidateFixture('top-ten-dbscan-all',30);let active=0,maximum=0,requests=0;
 // Card aggregates, validation customers and coincident geography do not establish discovery membership.
 f.details[0].candidate.customerIds=['00123'];
 const validation=f.call('validation-only','00123','2026-10-30');
 f.details[1].calls.push(validation);f.details[1].candidate.nearbyPoints.push(f.point(validation,'validation-new'));
 const nearby=f.call('nearby-only','00123');
 f.details[2].calls.push(nearby);f.details[2].candidate.nearbyPoints.push(f.point(nearby,'discovery-nearby'));
 f.details[3].calls[0].customerId='123';f.details[3].candidate.nearbyPoints[0].customerId='123';
 // Lower-ranked and unranked rough members remain eligible even when no selected-detail rows exist.
 for(const index of [27,29]){
  f.details[index].calls[0].customerId='00123';f.details[index].candidate.nearbyPoints[0].customerId='00123';
 }
 f.summary.candidates[29].rank=null;f.details[29].candidate.rank=null;
 f.details[29].candidate.nearbyPoints[0].kind='rough';
 global.fetch=async(url,options)=>{if(isLocationRequest(url,options))return response(f.locations);requests++;active++;maximum=Math.max(maximum,active);await turn();active--;
  assert(f.byUrl.has(String(url)),'the existing mixed/full detail loader must select the correct source');
  return response(f.byUrl.get(String(url)));};
 const result=await api.loadDbscanTopTenCandidateIds(f.summary,[customer('00123')],'all');
 assert.deepEqual(result,['candidate-27','candidate-29']);
 assert.equal(requests,30);assert.equal(maximum,4);
 assert.equal(await api.loadDbscanTopTenCandidateIds(f.summary,[customer('00123')],'all'),result);
 assert.equal(requests,30,'the aggregate result survives eviction from the 24-entry detail cache');
});

test('DBSCAN result cache separates customer IDs and analysis modes',async()=>{
 const f=candidateFixture('top-ten-dbscan-cache');f.details[0].calls[0].customerId='001';
 f.details[0].candidate.nearbyPoints[0].customerId='001';let requests=0;
 global.fetch=async(url,options)=>{if(isLocationRequest(url,options))return response(f.locations);requests++;return response(f.details[0]);};
 assert.deepEqual(await api.loadDbscanTopTenCandidateIds(f.summary,[customer('001')],'all'),['candidate-0']);
 assert.deepEqual(await api.loadDbscanTopTenCandidateIds(f.summary,[customer('1')],'all'),[]);
 assert.equal(requests,1,'a new exact-customer query reuses its validated detail');
 assert.deepEqual(await api.loadDbscanTopTenCandidateIds(f.summary,[customer('001')],'evaluation'),['candidate-0']);
 assert.equal(requests,2);
});

test('one invalid DBSCAN detail rejects the entire result and can be retried',async()=>{
 const f=candidateFixture('top-ten-dbscan-invalid',6);let invalid=true;
 global.fetch=async(url,options)=>{
  if(isLocationRequest(url,options))return response(f.locations);
  const detail=f.byUrl.get(String(url));assert(detail);
  return response(invalid&&detail.candidate.id==='candidate-4'?{...detail,scopeKey:'wrong-scope'}:detail);
 };
 await assert.rejects(api.loadDbscanTopTenCandidateIds(f.summary,[customer('001')],'all'),error=>error.code==='invalid-data');
 invalid=false;
 assert.deepEqual(await api.loadDbscanTopTenCandidateIds(f.summary,[customer('001')],'all'),[]);
});

test('a failed DBSCAN detail never resolves as a partial no-match result',async()=>{
 const f=candidateFixture('top-ten-dbscan-unavailable',6);
 global.fetch=async(url,options)=>isLocationRequest(url,options)?response(f.locations):String(url).endsWith('candidate-4.json')?{ok:false,status:503,json:async()=>({})}:response(f.byUrl.get(String(url)));
 await assert.rejects(api.loadDbscanTopTenCandidateIds(f.summary,[customer('001')],'all'),error=>error.code==='unavailable');
});

test('one cancelled DBSCAN consumer cannot cancel a shared survivor',async()=>{
 const f=candidateFixture('top-ten-dbscan-abort',6),controller=new AbortController();let release;
 const pending=new Promise(resolve=>{release=resolve;}),signals=[];
 global.fetch=async(url,options)=>{signals.push(options.signal);await pending;return response(isLocationRequest(url,options)?f.locations:f.byUrl.get(String(url)));};
 const stopped=api.loadDbscanTopTenCandidateIds(f.summary,[customer('001')],'all',controller.signal);
 const survivor=api.loadDbscanTopTenCandidateIds(f.summary,[customer('001')],'all');
 await turn();controller.abort();
 await assert.rejects(stopped,error=>error.name==='AbortError');
 release();assert.deepEqual(await survivor,[]);
 assert.equal(signals.length,7);assert(signals.every(signal=>!signal.aborted));
});

test('cancelling the only DBSCAN consumer stops the batch before loading later candidates',async()=>{
 const f=candidateFixture('top-ten-dbscan-stop',8),controller=new AbortController();let requests=0;
 global.fetch=async(_url,options)=>{requests++;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));};
 const stopped=api.loadDbscanTopTenCandidateIds(f.summary,[customer('001')],'all',controller.signal);
 await turn();controller.abort();
 await assert.rejects(stopped,error=>error.name==='AbortError');await turn();
 assert.equal(requests,5,'four validated detail loads plus one independently cancellable location lookup');
});
