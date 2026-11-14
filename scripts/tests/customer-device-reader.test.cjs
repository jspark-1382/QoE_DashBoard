/* eslint-disable @typescript-eslint/no-require-imports -- Node SQLite test fixtures. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const readerPath=path.resolve('scripts/customer-device-reader.cjs');
const {createCustomerDeviceReader}=fs.existsSync(readerPath)?require(readerPath):{};

function fixture(){
  const root=fs.mkdtempSync(path.resolve('outputs','device-reader-test-'));
  const publicDir=path.join(root,'public');
  const directory=path.join(root,'outputs','customer-device-data');
  fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(publicDir);
  const filename=path.join(directory,'fixture.sqlite');
  const db=new DatabaseSync(filename);
  db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,json TEXT);CREATE TABLE customer_devices(customer_id TEXT,date TEXT,minute INTEGER,model TEXT,PRIMARY KEY(customer_id,date,minute,model)) WITHOUT ROWID');
  db.prepare('INSERT INTO meta VALUES (?,?)').run('schema',JSON.stringify('customer-device-db-v1'));
  db.prepare('INSERT INTO meta VALUES (?,?)').run('sourceRevision',JSON.stringify('source-a'));
  const insert=db.prepare('INSERT INTO customer_devices VALUES (?,?,?,?)');
  insert.run('a','2026-10-26',600,'SM-S916N');
  insert.run('a','2026-10-26',601,'iPhone');
  insert.run('a','2026-10-26',602,'SM-S916N');
  insert.run('a','2026-10-27',540,'iPhone');
  insert.run('b','2026-10-27',540,'PEER-DEVICE');
  db.close();
  const index={schemaVersion:'customer-device-index-v1',sourceRevision:'source-a',database:'outputs/customer-device-data/fixture.sqlite'};
  const writeIndex=value=>fs.writeFileSync(path.join(publicDir,'customer-device-index.json'),JSON.stringify(value));
  writeIndex(index);
  return {root,publicDir,filename,index,writeIndex,close(){fs.rmSync(root,{recursive:true,force:true});}};
}
const all={dateStart:'2026-10-26',dateEnd:'2026-10-27',min:0,max:86400};

test('device models belong to the selected customer and are ordered by latest observation',()=>{
  assert.equal(typeof createCustomerDeviceReader,'function');
  const f=fixture();const reader=createCustomerDeviceReader({...f,sourceRevision:'source-a'});
  try{
    assert.deepEqual(reader.modelsFor('a',all),['iPhone','SM-S916N']);
    assert.deepEqual(reader.modelsFor('b',all),['PEER-DEVICE']);
    assert.deepEqual(reader.modelsFor('missing',all),[]);
  }finally{reader.close();f.close();}
});
test('date and inclusive-from exclusive-to minute boundaries match the screening filter',()=>{
  assert.equal(typeof createCustomerDeviceReader,'function');
  const f=fixture();const reader=createCustomerDeviceReader({...f,sourceRevision:'source-a'});
  try{
    assert.deepEqual(reader.modelsFor('a',{...all,dateEnd:'2026-10-26',min:36000,max:36060}),['SM-S916N']);
    assert.deepEqual(reader.modelsFor('a',{...all,dateEnd:'2026-10-26',min:36060,max:36120}),['iPhone']);
    assert.deepEqual(reader.modelsFor('a',{...all,dateStart:'2026-10-27',min:36000,max:86400}),[]);
  }finally{reader.close();f.close();}
});
test('missing, stale, malformed or out-of-directory catalogs fall back without breaking screening',()=>{
  assert.equal(typeof createCustomerDeviceReader,'function');
  const f=fixture();
  try{
    for(const index of [null,{...f.index,sourceRevision:'stale'},{...f.index,database:'../outside.sqlite'},{...f.index,database:'outputs/voice-query-data/main.sqlite'},{...f.index,schemaVersion:'bad'}]){
      if(index)f.writeIndex(index);else fs.rmSync(path.join(f.publicDir,'customer-device-index.json'));
      const reader=createCustomerDeviceReader({...f,sourceRevision:'source-a'});
      try{assert.deepEqual(reader.modelsFor('a',all),[]);}finally{reader.close();}
    }
    f.writeIndex(f.index);
    const db=new DatabaseSync(f.filename);db.prepare('UPDATE meta SET json=? WHERE key=?').run(JSON.stringify('stale'),'sourceRevision');db.close();
    const reader=createCustomerDeviceReader({...f,sourceRevision:'source-a'});
    try{assert.deepEqual(reader.modelsFor('a',all),[]);}finally{reader.close();}
  }finally{f.close();}
});
