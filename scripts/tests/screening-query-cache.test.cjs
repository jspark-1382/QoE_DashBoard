const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {load}=require('../analyst-ts-loader.cjs');
const {createScreeningQueries}=require('../voice-query-screening.cjs');
const dates=['2026-10-29','2026-10-30'];
const full={dateStart:dates[0],dateEnd:dates[1],from:'00:00',to:'23:59',min:0,max:86400};
const options={filter:'all',sort:'poor',query:'',page:0};
function fixture(){
  const directory=fs.mkdtempSync(path.resolve('outputs','screening-cache-test-'));
  const file=path.join(directory,'fixture.sqlite'),db=new DatabaseSync(file);
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,json TEXT);
    CREATE TABLE customers(id TEXT PRIMARY KEY,number TEXT);
    CREATE TABLE calls(id TEXT PRIMARY KEY,raw_id TEXT,customer_id TEXT,date TEXT,start_second REAL,qoe REAL,is_drop INTEGER,area TEXT,cell TEXT,end_second REAL);
    CREATE TABLE locations(call_id TEXT,kind TEXT,area TEXT,evidence TEXT,lat REAL,lon REAL,PRIMARY KEY(call_id,kind));
    CREATE TABLE cell_sites(cell TEXT,lat REAL,lon REAL);`);
  db.prepare('INSERT INTO customers VALUES (?,?)').run('a','00123');db.prepare('INSERT INTO customers VALUES (?,?)').run('b','00456');
  const insert=db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?)');
  insert.run('a:one','one','a',dates[0],36000,2,0,'dong','cell',36060);
  insert.run('a:two','two','a',dates[1],36001,1.5,1,'dong','cell',36061);
  insert.run('b:good','good','b',dates[1],36002,4,0,'other','otherCell',36062);
  insert.run('b:missing','missing','b',dates[1],36003,null,1,'other','otherCell',36063);
  db.prepare('INSERT INTO locations VALUES (?,?,?,?,?,?)').run('a:one','original','dong','gnss',37,127);
  db.prepare('INSERT INTO locations VALUES (?,?,?,?,?,?)').run('a:two','original','dong','bye-cell',37.1,127.1);
  db.prepare('INSERT INTO cell_sites VALUES (?,?,?)').run('cell',37.1,127.1);
  db.exec(`CREATE TABLE facts AS SELECT *,COALESCE(area,'') AS screen_area FROM calls;
    CREATE INDEX facts_customer_date ON facts(customer_id,date,start_second);`);
  return {db,file,close(){db.close();fs.rmSync(directory,{recursive:true,force:true});}};
}
function helpers(db){
  const queries=[],plain=row=>row?{...row}:row;
  const all=(sql,args=[])=>{queries.push(sql);return db.prepare(sql).all(...args).map(plain);};
  const one=(sql,args=[])=>{queries.push(sql);return plain(db.prepare(sql).get(...args));};
  const original=db.prepare.bind(db);db.prepare=sql=>{queries.push(sql);return original(sql);};
  const areas={dong:['실제동',37,127],other:['다른동',37.1,127.1]};
  const sourceMeta={schemaVersion:'customer-screening-v1',sourceRevision:'fixture',source:'MDT',dates,areas,customers:[],thresholds:{poor:3,good:3.5,concentratedRate:.5,concentratedCount:10,minEvaluatedForRate:5,repeatDays:2,dropCount:3,dropRate:.1}};
  const base=s=>({where:['c.date>=?','c.date<=?','c.start_second>=?','c.start_second<?'],args:[s.dateStart,s.dateEnd,s.min,s.max]});
  const helper=createScreeningQueries({db,all,one,base,dates,areas,sourceMeta,rounded:value=>value==null?null:Math.round(value*1e6)/1e6,text:value=>value,pageOf:(page,pages)=>Math.max(0,Math.min(page??0,Math.max(0,pages-1)))});
  return {helper,queries,sourceMeta};
}
test('screening uses compact original projections and preserves exact business totals',()=>{
  const f=fixture();try{
    const {helper,queries}=helpers(f.db),source=helper.source(full);
    const expected=load(path.resolve('lib/analyst/customer-screening.ts')).aggregateScreening(source,full.dateStart,full.dateEnd,full.from,full.to);
    const actual=helper.screening(full,options);const {rows,...report}=expected;
    assert.deepEqual(actual.report,report);assert.deepEqual(actual.rows,rows.map(row=>({...row,badCalls:[]})));
    assert.ok(queries.some(sql=>sql.includes('FROM facts c NOT INDEXED LEFT JOIN locations')));
  }finally{f.close();}
});
test('map mode/ranking changes reuse geography without rereading every source call',()=>{
  const f=fixture();try{
    const {helper,queries}=helpers(f.db);const first=helper.map(full,options),count=queries.filter(sql=>sql.includes('SELECT c.customer_id,c.date,c.start_second')).length;
    const second=helper.map(full,{...options,sort:'repeat'});
    assert.deepEqual(first.geography,second.geography);
    assert.equal(queries.filter(sql=>sql.includes('SELECT c.customer_id,c.date,c.start_second')).length,count);
    assert.deepEqual([first.geography.gnssPoorCalls,first.geography.byeCellPoorCalls],[1,1]);
  }finally{f.close();}
});
test('switching a focused region back to global counts keeps both scope aggregates',()=>{
  const f=fixture();try{
    const {helper,queries}=helpers(f.db);const first=helper.screening(full,options);
    const originalPrepare=f.db.prepare.bind(f.db);let builds=0;f.db.prepare=sql=>{if(sql.startsWith('CREATE TEMP TABLE'))builds++;return originalPrepare(sql);};
    const focused=helper.screening(full,{...options,areaId:'dong'});
    const restored=helper.screening(full,options);
    assert.equal(builds,1);assert.deepEqual(first.report,focused.report);assert.deepEqual(first.report,restored.report);
    assert.equal(focused.selected.id,'a');assert.equal(restored.rows.length,2);
  }finally{f.close();}
});
test('persisted full-scope rows and report bypass the cold population aggregation',()=>{
  const f=fixture();try{
    const first=helpers(f.db).helper.screening(full,options);
    f.db.exec('CREATE TABLE screen_default_rows AS SELECT * FROM temp.screen_rows');
    f.db.prepare('INSERT INTO meta VALUES (?,?)').run('screening-default-report',JSON.stringify({report:first.report,affectedCallTotal:first.affectedCallTotal}));
    const reopened=new DatabaseSync(f.file,{readOnly:true});try{
      const {helper,queries}=helpers(reopened),actual=helper.screening(full,options);
      assert.deepEqual(actual,first);assert.ok(!queries.some(sql=>sql.startsWith('CREATE TEMP TABLE')));
    }finally{reopened.close();}
  }finally{f.close();}
});
test('switching screening map presentation does not request or remount unchanged geography',()=>{
  const source=fs.readFileSync('components/analyst/customer-screening-dashboard.tsx','utf8');
  const effect=source.slice(source.indexOf('    if(!mapEnabled)return;'),source.indexOf('  const routeIds='));
  assert.doesNotMatch(effect,/mapView/);
  assert.match(effect,/previous\.geography/);
  assert.match(effect,/mapDataScope\.current!==scopeKey/);
});
test('focused region and cell comparisons retain the stable global poor-rate tiebreak',()=>{
  const f=fixture();try{
    // Equal poor counts/days: a has 2/20 poor, b has 2/2 poor. The original
    // ranking places b first before applying the stable region/cell focus sort.
    f.db.exec("DELETE FROM calls WHERE customer_id='b'");
    const insert=f.db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?)');
    for(let index=0;index<18;index++)insert.run('a:healthy'+index,'healthy'+index,'a',dates[1],36100+index,4,0,'dong','cell',36160+index);
    insert.run('b:first','first','b',dates[0],36010,2,0,'dong','cell',36070);
    insert.run('b:second','second','b',dates[1],36011,2,0,'dong','cell',36071);
    f.db.exec("DROP TABLE facts;CREATE TABLE facts AS SELECT *,COALESCE(area,'') AS screen_area FROM calls;CREATE INDEX facts_customer_date ON facts(customer_id,date,start_second)");
    const {helper}=helpers(f.db);
    for(const focus of [{areaId:'dong'},{cellId:'cell'}]){
      const response=helper.screening(full,{...options,...focus,selectedId:'not-in-scope'});
      assert.deepEqual(response.comparable.map(row=>row.id),['b','a']);
      assert.equal(response.selected.id,'b');
      assert.deepEqual(response.comparable.map(row=>row.poorRate),[1,.1]);
    }
  }finally{f.close();}
});
