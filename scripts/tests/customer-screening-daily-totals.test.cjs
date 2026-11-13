const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {load}=require('../analyst-ts-loader.cjs');
const {createScreeningQueries}=require('../voice-query-screening.cjs');
const {aggregateScreening}=load('lib/analyst/customer-screening.ts');
const dates=['2026-10-28','2026-10-29','2026-10-30'];
const source={schemaVersion:'customer-screening-v1',sourceRevision:'daily-totals-fixture',source:'MDT',dates,
  areas:{dong:['실제동',37,127],other:['다른동',38,128]},
  thresholds:{poor:3,good:3.5,concentratedRate:.5,concentratedCount:10,minEvaluatedForRate:5,repeatDays:2,dropCount:3,dropRate:.1},
  customers:[{id:'a',number:'00123',calls:[
    [0,36000,2,0,'dong','cell',37,127,'gnss','poor'],
    [0,36001,4,0,'dong','cell',37,127,'gnss','good'],
    [0,36002,null,0,'dong','cell',37,127,'gnss','unscored'],
    [0,35999,2,0,'dong','cell',37,127,'gnss','before-time'],
    [0,36100,2,0,'other','otherCell',38,128,'gnss','other-area'],
    [2,36000,null,1,'dong','cell',37,127,'bye-cell','unscored-drop'],
  ]}],audit:{calls:6,poor:3,drops:1,locatedPoor:3,customers:1}};
const scope={dateStart:dates[0],dateEnd:dates[2],from:'10:00',to:'10:00',min:36000,max:36060};
const options={filter:'all',sort:'poor',query:'',page:0,selectedId:'a'};

test('local daily totals count every scoped call including unscored calls and retain empty dates',()=>{
  const all=aggregateScreening(source,dates[0],dates[2],'10:00','10:00').rows[0];
  assert.deepEqual(all.dailyTotal,[3,0,1]);
  assert.deepEqual(all.dailyPoor,[1,0,0]);
  assert.equal(all.total,4);
  assert.equal(all.eligible,2);
  const narrowed=aggregateScreening(source,dates[2],dates[2],'10:00','10:00').rows[0];
  assert.deepEqual(narrowed.dailyTotal,[0,0,1]);
  assert.equal(narrowed.eligible,0);
});

test('server daily totals match full scope and focused area/cell counts without filtering out unscored calls',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`CREATE TABLE customers(id TEXT PRIMARY KEY,number TEXT);
      CREATE TABLE calls(id TEXT PRIMARY KEY,raw_id TEXT,customer_id TEXT,date TEXT,start_second REAL,qoe REAL,is_drop INTEGER,area TEXT,cell TEXT,end_second REAL);
      CREATE TABLE locations(call_id TEXT,kind TEXT,area TEXT,evidence TEXT,lat REAL,lon REAL,PRIMARY KEY(call_id,kind));`);
    db.prepare('INSERT INTO customers VALUES (?,?)').run('a','00123');
    for(const [day,second,qoe,drop,area,cell,lat,lon,evidence,raw] of source.customers[0].calls){
      db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?)').run('a:'+raw,raw,'a',dates[day],second,qoe,drop,area,cell,second+30);
      db.prepare('INSERT INTO locations VALUES (?,?,?,?,?,?)').run('a:'+raw,'original',area,evidence,lat,lon);
    }
    db.exec("CREATE TABLE facts AS SELECT *,COALESCE(area,'') AS screen_area FROM calls;CREATE INDEX facts_customer_date ON facts(customer_id,date,start_second)");
    const plain=row=>row?{...row}:row;
    const base=s=>({where:['c.date>=?','c.date<=?','c.start_second>=?','c.start_second<?'],args:[s.dateStart,s.dateEnd,s.min,s.max]});
    const helper=createScreeningQueries({db,all:(sql,args=[])=>db.prepare(sql).all(...args).map(plain),one:(sql,args=[])=>plain(db.prepare(sql).get(...args)),
      base,dates,areas:source.areas,sourceMeta:source,rounded:value=>value,text:value=>value,pageOf:()=>0});
    const all=helper.screening(scope,options);
    assert.deepEqual(all.selected.dailyTotal,[3,0,1]);
    assert.deepEqual(all.selected.dailyPoor,[1,0,0]);
    assert.equal(all.selected.total,4);
    const narrowed=helper.screening({...scope,dateStart:dates[2]},options);
    assert.deepEqual(narrowed.selected.dailyTotal,[0,0,1]);
    assert.equal(narrowed.selected.total,1);
    const extended={...scope,to:'10:01',max:36120};
    assert.deepEqual(helper.screening(extended,options).selected.dailyTotal,[4,0,1]);
    for(const focus of [{areaId:'dong'},{cellId:'cell'}]){
      const focused=helper.screening(extended,{...options,...focus});
      assert.deepEqual(focused.selected.dailyTotal,[3,0,1]);
      assert.equal(focused.selected.total,4);
      assert.deepEqual(focused.rows[0].dailyTotal,[4,0,1],'global ranking retains global totals');
    }
  }finally{db.close();}
});
