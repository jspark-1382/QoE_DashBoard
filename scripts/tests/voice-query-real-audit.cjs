/* Explicit real-source audit; intentionally separate from the tiny fixture suite. */
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const index=JSON.parse(fs.readFileSync('public/voice-query-index.json','utf8'));
const db=new DatabaseSync(index.database,{readOnly:true});
const meta=JSON.parse(db.prepare("SELECT json FROM meta WHERE key='dataset'").get().json);
assert.equal(meta.revision,'da0b8405340fe0ea2459');
assert.deepEqual([index.audit.calls,index.audit.customers,index.audit.evaluated,index.audit.poor,index.audit.drops,index.audit.affected],[1490033,268182,1088738,9315,2609,7562]);
assert.deepEqual([index.audit.mapped.gnss,index.audit.mapped.estimated],[673,426]);
db.close();
if(process.env.QOE_QUERY_PROFILE){const original=DatabaseSync.prototype.prepare;DatabaseSync.prototype.prepare=function(sql){const statement=original.call(this,sql);for(const method of ['all','get','run']){const invoke=statement[method].bind(statement);statement[method]=(...args)=>{const started=performance.now(),result=invoke(...args),ms=performance.now()-started;if(ms>100)console.log('SQL',Math.round(ms),sql.replace(/\s+/g,' ').slice(0,250));return result;};}return statement;};}
const {createQueryEngine}=require('../voice-query-engine.cjs');
const engine=createQueryEngine({dbPath:path.resolve(index.database)});
for(const [op,extra] of [['meta',{}],['summary',{}],['customers',{page:0,query:'',filter:'all'}],['screening',{page:0,query:'',filter:'all',sort:'poor'}],['calls',{page:0,pageSize:12}],['map',{}]]){
  const started=performance.now(),result=engine.query({op,scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'},...extra});
  console.log(JSON.stringify({op,ms:Math.round(performance.now()-started),bytes:Buffer.byteLength(JSON.stringify(result)),total:result.total,rows:result.rows?.length,analytics:result.analytics&&{total:result.analytics.total,evaluated:result.analytics.evaluated,experience:result.analytics.experience.map(x=>[x.id,x.count])},mapped:result.mapped,report:result.report,mapCalls:result.overview?.calls.length,rss:Math.round(process.memoryUsage().rss/1048576)}));
  if(op==='map'){
    const {load}=require('../analyst-ts-loader.cjs'),helper=load(path.resolve('lib/analyst/quality-map-stations.ts'));
    assert.equal(helper.countStationMapPositions(helper.relatedStationMarkersForMap(result.overview.callLocations)),449,'same-call related map station positions');
  }
}
engine.close();
const verification=new DatabaseSync(index.database,{readOnly:true});
assert.equal(verification.prepare("SELECT COUNT(*) AS n FROM calls WHERE qoe IS NOT json_extract(json,'$.qoe')").get().n,0,'every stored score matches its original published record');
assert.equal(verification.prepare('PRAGMA quick_check').get().quick_check,'ok');verification.close();
console.log('Real source conservation, every published score and map station audit passed.');
