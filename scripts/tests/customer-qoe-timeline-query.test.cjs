/* eslint-disable @typescript-eslint/no-require-imports -- Node SQLite behavior tests use the CommonJS worker loader. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createQueryEngine}=require('../voice-query-engine.cjs');
const {load}=require('../analyst-ts-loader.cjs');

const revision='timeline-fixture-revision',customerId='opaque/customer:01';
const dates=['2026-10-29','2026-10-30'];
const scope={dateStart:dates[0],dateEnd:dates[1],from:'00:00',to:'23:59'};
let directory,engine;
before(()=>{
  fs.mkdirSync(path.resolve('outputs'),{recursive:true});
  directory=fs.mkdtempSync(path.resolve('outputs','customer-timeline-test-'));
  const dbPath=path.join(directory,'fixture.sqlite'),db=new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,json TEXT NOT NULL);
    CREATE TABLE areas(id TEXT PRIMARY KEY,label TEXT,lat REAL,lon REAL,json TEXT);
    CREATE TABLE calls(id TEXT PRIMARY KEY,raw_id TEXT,customer_id TEXT,date TEXT,start_second REAL,qoe REAL,is_drop INTEGER,area TEXT,cell TEXT,json TEXT);
    CREATE TABLE locations(call_id TEXT,kind TEXT,area TEXT,evidence TEXT,lat REAL,lon REAL,PRIMARY KEY(call_id,kind));
    CREATE TABLE cell_sites(cell TEXT PRIMARY KEY,lat REAL,lon REAL);`);
  const meta=db.prepare('INSERT INTO meta VALUES (?,?)');
  for(const [key,value] of Object.entries({dataset:{revision,dates},audit:{calls:1109,customers:2,poor:3,drops:3},overview:{},schema:'voice-query-db-v1'}))meta.run(key,JSON.stringify(value));
  const insert=db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?)');
  const call=(id,raw,date,second,qoe,drop=0,area='',cell='tower')=>insert.run(id,raw,customerId,date,second,qoe,drop,area,cell,JSON.stringify({start:second===36001?'10:00:01.000':'10:00:00',unused:'do not return bulk call JSON'}));
  // Reverse timestamp ties prove the result is ordered by ID, not source insertion.
  call('zeta','zero',dates[0],36001,0,0,'day-dong');
  call('alpha','missing',dates[0],36001,null,0,'day-dong');
  call('unrelated opaque ID','raw:with / opaque?&=',dates[1],36000,-1.25,1,'call-dong');
  call('no-location','raw-unlocated',dates[1],36002,4.2606020000000004);
  call('bye','raw-bye',dates[1],36003,1.5,1);
  call('estimated','raw-estimated',dates[1],36004,2,0,'call-dong');
  call('invalid','raw-invalid',dates[1],36005,null,1,'call-dong');
  for(let i=1100;i>=0;i--)call('bulk-'+String(i).padStart(4,'0'),'bulk/raw/'+i,dates[1],45000+i/100,4);
  insert.run('foreign','foreign','other',dates[1],36000,1,0,'call-dong','tower','{"start":"10:00:00"}');
  const location=db.prepare('INSERT INTO locations VALUES (?,?,?,?,?,?)');
  location.run('unrelated opaque ID','original','gps-dong','gnss',37.123456789,127.987654321);
  location.run('unrelated opaque ID','view','view-dong','estimated',37.8,127.8);
  location.run('bye','original','bye-dong','bye-cell',37.223456789,127.887654321);
  location.run('estimated','original','call-dong','estimated',37.3,127.3);
  location.run('invalid','original','call-dong','gnss',91,127);
  location.run('no-location','original','','gnss',0,0);
  location.run('no-location','view','view-dong','gnss',37.9,127.9);
  location.run('bulk-0000','view','view-dong','gnss',37.9,127.9);
  db.prepare('INSERT INTO cell_sites VALUES (?,?,?)').run('tower',37.5,127.5);
  db.exec('ALTER TABLE calls ADD COLUMN source_clock REAL; UPDATE calls SET source_clock=start_second;');
  const fractional=db.prepare('INSERT INTO calls (id,raw_id,customer_id,date,start_second,qoe,is_drop,area,cell,json,source_clock) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for(const [id,clock] of [['z-earlier',36000.1],['a-later',36000.9],['m-missing',null],['b-inconsistent',36001.2],['n-infinite',Infinity]]){
    fractional.run(id,id,'fractional',dates[1],36000,4,0,'','tower',JSON.stringify({start:'10:00:00'}),clock);
  }
  db.exec(`CREATE TABLE facts AS SELECT c.*,COALESCE(NULLIF(c.area,''),l.area,'') AS screen_area
    FROM calls c LEFT JOIN locations l ON l.call_id=c.id AND l.kind='original';
    CREATE INDEX facts_customer_date ON facts(customer_id,date,start_second);`);
  db.close();engine=createQueryEngine({dbPath});
});
after(()=>{engine?.close();if(directory)fs.rmSync(directory,{recursive:true,force:true});});
const query=(extra={})=>engine.query({op:'customer-qoe-timeline',sourceRevision:revision,customerId,scope,...extra});

test('timeline conserves more than 1000 scoped calls including zero, missing, negative and unlocated QoE',()=>{
  const result=query();
  assert.equal(result.sourceRevision,revision);assert.equal(result.customerId,customerId);
  assert.equal(result.calls.length,1108);
  assert.deepEqual(result.calls.slice(0,3).map(call=>[call.id,call.qoe]),[['alpha',null],['zeta',0],['unrelated opaque ID',-1.25]]);
  assert.equal(result.calls[3].qoe,4.2606020000000004,'stored floating point QoE is not rounded');
  assert.equal(result.calls.at(-1).id,'bulk-1100');
  assert.equal(result.calls.filter(call=>call.location===null).length,1106);
  assert.equal(result.calls.find(call=>call.id==='invalid').drop,true,'unscored Drop remains visible');
});

test('timeline scopes date and inclusive final minute without widening to scope customer IDs',()=>{
  const result=query({scope:{...scope,dateStart:dates[1],from:'10:00',to:'10:00',customerIds:['other',customerId]}});
  assert.deepEqual(result.calls.map(call=>call.id),['unrelated opaque ID','no-location','bye','estimated','invalid']);
  assert.deepEqual(query({scope:{...scope,dateEnd:dates[0],customerIds:['other']}}).calls.map(call=>call.id),['alpha','zeta']);
  assert.deepEqual(query({customerId:'other'}).calls.map(call=>call.id),['foreign']);
  assert.deepEqual(query({customerId:'absent'}).calls,[]);
});

test('timeline matches screening area precedence, original-location fallback and exact cell intersections',()=>{
  assert.deepEqual(query({areaId:'call-dong'}).calls.map(call=>call.id),['unrelated opaque ID','estimated','invalid']);
  assert.deepEqual(query({areaId:'gps-dong'}).calls,[],'call area precedes original GNSS area');
  assert.deepEqual(query({areaId:'bye-dong',cellId:'tower'}).calls.map(call=>call.id),['bye']);
  assert.deepEqual(query({areaId:'bye-dong',cellId:'different'}).calls,[]);
  assert.deepEqual(query({cellId:'different'}).calls,[]);
});

test('timeline orders original fractional clocks before ID and preserves their chart placement with safe fallbacks',()=>{
  const calls=query({customerId:'fractional',scope:{...scope,from:'10:00',to:'10:00'}}).calls;
  assert.deepEqual(calls.map(call=>[call.id,call.startSecond]),[
    ['b-inconsistent',36000],['m-missing',36000],['n-infinite',36000],['z-earlier',36000.1],['a-later',36000.9],
  ]);
  assert.deepEqual(query({customerId:'fractional',scope:{...scope,from:'10:01',to:'10:01'}}).calls,[],
    'date/time membership still uses indexed source start_second');
});

test('timeline retains deterministic indexed clocks in legacy fixtures without source_clock',()=>{
  const legacyPath=path.join(directory,'legacy.sqlite');
  fs.copyFileSync(path.join(directory,'fixture.sqlite'),legacyPath);
  const legacyDb=new DatabaseSync(legacyPath);legacyDb.exec('ALTER TABLE facts DROP COLUMN source_clock; ALTER TABLE calls DROP COLUMN source_clock;');legacyDb.close();
  const legacy=createQueryEngine({dbPath:legacyPath});
  try{
    const result=legacy.query({op:'customer-qoe-timeline',sourceRevision:revision,customerId:'fractional',scope});
    assert.deepEqual(result.calls.map(call=>[call.id,call.startSecond]),[
      ['a-later',36000],['b-inconsistent',36000],['m-missing',36000],['n-infinite',36000],['z-earlier',36000],
    ]);
  }finally{legacy.close();}
});

test('timeline returns compact exact raw IDs and only valid original GNSS or BYE coordinates',()=>{
  const calls=query().calls;
  assert.deepEqual(calls[2],{id:'unrelated opaque ID',rawCallId:'raw:with / opaque?&=',date:dates[1],start:'10:00:00',startSecond:36000,qoe:-1.25,drop:true,cell:'tower',location:{lat:37.123456789,lon:127.987654321,evidence:'gnss'}});
  assert.deepEqual(calls.find(call=>call.id==='bye').location,{lat:37.223456789,lon:127.887654321,evidence:'bye-cell'});
  for(const id of ['no-location','estimated','invalid','bulk-0000'])assert.equal(calls.find(call=>call.id===id).location,null,id+' must not use view positions, unsupported evidence, invalid/zero-pair coordinates or tower substitutes');
  assert.equal(calls[0].start,'10:00:01.000','original start text is preserved');
});

test('timeline rejects empty or unsafe customer IDs and stale sources',()=>{
  for(const invalid of ['', '  ',null,42,'unsafe\nID','x'.repeat(501)])assert.throws(()=>query({customerId:invalid}),/Invalid customerId/);
  assert.throws(()=>query({sourceRevision:'stale'}),/revision/i);
  assert.throws(()=>query({areaId:'unsafe\narea'}),/Invalid areaId/);
  assert.throws(()=>query({cellId:'unsafe\ncell'}),/Invalid cellId/);
});

test('typed timeline adapter uses the compact scoped query and propagates revision and cancellation',async()=>{
  const {loadCustomerQoeTimeline}=load('lib/analyst/customer-qoe-timeline.ts');
  const previous=global.fetch,controller=new AbortController();let request;
  global.fetch=async(url,options)=>{
    request={url,options};
    return {ok:true,json:async()=>engine.query(JSON.parse(options.body))};
  };
  try{
    const result=await loadCustomerQoeTimeline({customerId,sourceRevision:revision,scope,areaId:'bye-dong',cellId:'tower'},controller.signal);
    assert.equal(request.url,'/qoe/api/voice/query');assert.equal(request.options.signal,controller.signal);
    assert.deepEqual(JSON.parse(request.options.body),{customerId,sourceRevision:revision,scope,areaId:'bye-dong',cellId:'tower',op:'customer-qoe-timeline'});
    assert.deepEqual(result.calls.map(call=>call.id),['bye']);
    controller.abort();await assert.rejects(loadCustomerQoeTimeline({customerId,sourceRevision:revision,scope},controller.signal),{name:'AbortError'});
  }finally{global.fetch=previous;}
});
