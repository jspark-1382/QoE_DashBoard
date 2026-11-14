/* Optional, revision-bound device evidence; the original voice database stays read-only. */
/* eslint-disable @typescript-eslint/no-require-imports -- Loaded by local SQLite query workers. */
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

function createCustomerDeviceReader({root,publicDir=path.join(root,'public'),sourceRevision}){
  let initialized=false,closed=false,db=null,models=null;
  function open(){
    if(initialized||closed)return;
    initialized=true;
    let candidate=null;
    try{
      const index=JSON.parse(fs.readFileSync(path.join(publicDir,'customer-device-index.json'),'utf8'));
      if(index.schemaVersion!=='customer-device-index-v1'||index.sourceRevision!==sourceRevision||typeof index.database!=='string'||path.isAbsolute(index.database))return;
      const allowed=fs.realpathSync(path.join(root,'outputs','customer-device-data'));
      const filename=fs.realpathSync(path.resolve(root,index.database));
      if(!filename.startsWith(allowed+path.sep)||path.extname(filename)!=='.sqlite')return;
      candidate=new DatabaseSync(filename,{readOnly:true});
      candidate.exec('PRAGMA trusted_schema=OFF');
      const meta=candidate.prepare('SELECT json FROM meta WHERE key=?');
      if(JSON.parse(meta.get('schema')?.json??'null')!=='customer-device-db-v1'||JSON.parse(meta.get('sourceRevision')?.json??'null')!==sourceRevision)throw Error('Device catalog revision differs');
      models=candidate.prepare(`SELECT model,MAX(date||printf('%04d',minute)) AS lastSeen
        FROM customer_devices WHERE customer_id=? AND date>=? AND date<=? AND minute>=? AND minute<?
        GROUP BY model ORDER BY lastSeen DESC,model`);
      db=candidate;candidate=null;
    }catch{
      // Device metadata is supplementary; missing evidence never hides the dashboard.
      models=null;
    }finally{candidate?.close();}
  }
  return {
    modelsFor(customerId,scope){
      if(closed)return [];
      open();
      return models?models.all(customerId,scope.dateStart,scope.dateEnd,Math.floor(scope.min/60),Math.floor(scope.max/60))
        .map(row=>row.model).filter(model=>typeof model==='string'&&model.trim()):[];
    },
    close(){closed=true;models=null;db?.close();db=null;},
  };
}
module.exports={createCustomerDeviceReader};
